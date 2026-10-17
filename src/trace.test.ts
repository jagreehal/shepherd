import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { flush, iterationAttributes, recordEvent, stageAttributes, stagesFrom } from "./trace.ts";

const at = (s: number) => new Date(Date.UTC(2026, 9, 16, 10, 0, s));

const file = () => path.join(mkdtempSync(path.join(tmpdir(), "shepherd-trace-")), "trace-42.jsonl");

describe("iteration trace", () => {
  test("each start pairs with the next end of its stage and round", () => {
    const f = file();

    recordEvent(f, { stage: "swarm", phase: "start", round: 1, head_sha: "abc1234" }, at(0));
    recordEvent(f, { stage: "swarm", phase: "end", round: 1, outcome: "ok" }, at(30));
    recordEvent(f, { stage: "triage", phase: "start", round: 1 }, at(31));
    recordEvent(f, { stage: "triage", phase: "end", round: 1, outcome: "failed", retries: 2 }, at(50));
    recordEvent(f, { stage: "stamp", phase: "start" }, at(51));

    const { start, stages } = stagesFrom(readFileSync(f, "utf8"), at(90));

    expect(start).toBe(at(0).toISOString());
    expect(stages).toEqual([
      { stage: "swarm", round: 1, start: at(0).toISOString(), end: at(30).toISOString(), outcome: "ok", retries: 0, head_sha: "abc1234" },
      { stage: "triage", round: 1, start: at(31).toISOString(), end: at(50).toISOString(), outcome: "failed", retries: 2, head_sha: undefined },
      { stage: "stamp", round: undefined, start: at(51).toISOString(), end: at(90).toISOString(), outcome: "unfinished", retries: 0, head_sha: undefined },
    ]);
  });

  test("an end without the start's round still closes that start", () => {
    const f = file();

    recordEvent(f, { stage: "swarm", phase: "start", round: 1 }, at(0));
    recordEvent(f, { stage: "swarm", phase: "end", outcome: "ok" }, at(30));

    expect(stagesFrom(readFileSync(f, "utf8"), at(40)).stages).toEqual([
      { stage: "swarm", round: 1, start: at(0).toISOString(), end: at(30).toISOString(), outcome: "ok", retries: 0, head_sha: undefined },
    ]);
  });

  test("an unknown stage is refused when recorded, and a bad line is dropped when read", () => {
    expect(() => recordEvent(file(), { stage: "deploy", phase: "start" })).toThrow();
    expect(stagesFrom('not json\n{"at":"x","stage":"swarm","phase":"end"}\n', at(0)).stages).toEqual([]);
  });

  test("attributes carry the keys that join shepherd's spans to stamp's and to CI", () => {
    const stages = stagesFrom([JSON.stringify({ at: at(0).toISOString(), stage: "triage", phase: "start", round: 2 }), JSON.stringify({ at: at(9).toISOString(), stage: "triage", phase: "end", round: 2, retries: 1 })].join("\n"), at(10)).stages;

    expect(iterationAttributes({ repo: "o/r", pr: 42, headSha: "abc1234", baseSha: "def5678", outcome: "converged", ciRun: 99, ciAttempt: 2, links: [] }, stages)).toEqual({
      "vcs.repository.name": "o/r",
      "vcs.change.id": "42",
      "vcs.ref.head.revision": "abc1234",
      "vcs.ref.base.revision": "def5678",
      "cicd.pipeline.run.id": "99",
      "shepherd.ci.attempt": 2,
      "shepherd.outcome": "converged",
      "shepherd.rounds": 2,
      "shepherd.retries": 1,
    });
    expect(stageAttributes(stages[0]!)).toEqual({ "shepherd.stage": "triage", "shepherd.outcome": "ok", "shepherd.retries": 1, "shepherd.round": 2, "vcs.ref.head.revision": undefined });
  });

  test("flush without an endpoint exports nothing and clears the record", async () => {
    const f = file();
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    recordEvent(f, { stage: "checks", phase: "start" }, at(0));
    recordEvent(f, { stage: "checks", phase: "end" }, at(5));

    const result = await flush(f, { repo: "o/r", pr: 42, headSha: "abc1234", baseSha: undefined, outcome: "converged", ciRun: undefined, ciAttempt: undefined, links: [] }, at(6));

    if (endpoint !== undefined) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;

    expect(result).toMatchObject({ exported: false, stages: [{ stage: "checks", outcome: "ok" }] });
    expect(existsSync(f)).toBe(false);
  });

  test("flush clears the record and reports the error when the collector is unreachable", async () => {
    const f = file();

    recordEvent(f, { stage: "checks", phase: "start" }, at(0));

    // A child process, so autotel's global tracer provider never touches the other tests.
    const script = `
      const { flush } = await import(${JSON.stringify(path.join(import.meta.dir, "trace.ts"))});
      const r = await flush(${JSON.stringify(f)}, { repo: "o/r", pr: 42, headSha: "abc1234", baseSha: undefined, outcome: "converged", ciRun: undefined, ciAttempt: undefined, links: [] });
      console.log(JSON.stringify({ exported: r.exported, error: Boolean(r.error) }));`;

    const child = Bun.spawnSync(["bun", "-e", script], { cwd: path.join(import.meta.dir, ".."), env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1", OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" } });

    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString().trim().split("\n").at(-1)!)).toEqual({ exported: false, error: true });
    expect(existsSync(f)).toBe(false);
  }, 20_000);

  test("flush exports one iteration span, a child per step, and links to other traces", async () => {
    const bodies: string[] = [];

    const server = createServer((req, res) => {
      let body = "";

      req.on("data", (d) => (body += d));
      req.on("end", () => {
        bodies.push(body);
        res.end("{}");
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const { port } = z.object({ port: z.number() }).parse(server.address());
    const f = file();
    const stampTrace = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

    recordEvent(f, { stage: "swarm", phase: "start", round: 1 }, at(0));
    recordEvent(f, { stage: "swarm", phase: "end", round: 1 }, at(20));
    recordEvent(f, { stage: "ci-repair", phase: "start" }, at(21));
    recordEvent(f, { stage: "ci-repair", phase: "end", outcome: "failed" }, at(40));

    // A child process, so autotel's global tracer provider never touches the other tests.
    const script = `
      const { flush } = await import(${JSON.stringify(path.join(import.meta.dir, "trace.ts"))});
      await flush(${JSON.stringify(f)}, { repo: "o/r", pr: 42, headSha: "abc1234", baseSha: undefined, outcome: "round-cap", ciRun: undefined, ciAttempt: undefined, links: [${JSON.stringify(stampTrace)}, "not-a-traceparent"] });`;

    const child = spawn("bun", ["-e", script], { cwd: path.join(import.meta.dir, ".."), env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" } });

    await new Promise((resolve) => child.on("exit", resolve));
    server.close();

    const Span = z.object({ name: z.string(), spanId: z.string(), parentSpanId: z.string().optional(), links: z.array(z.object({ traceId: z.string() })).optional(), status: z.object({ code: z.number().optional() }).optional() });
    const Traces = z.object({ resourceSpans: z.array(z.object({ scopeSpans: z.array(z.object({ spans: z.array(Span) })) })) });
    const spans = bodies.flatMap((b) => Traces.parse(JSON.parse(b)).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
    const root = spans.find((s) => s.name === "shepherd.iteration");

    expect(root?.links?.map((l) => l.traceId)).toEqual(["0af7651916cd43dd8448eb211c80319c"]);
    expect(spans.flatMap((s) => (s.parentSpanId === root?.spanId ? [s.name] : []))).toEqual(["shepherd.swarm", "shepherd.ci-repair"]);
    expect(spans.find((s) => s.name === "shepherd.ci-repair")?.status?.code).toBe(2);
    expect(existsSync(f)).toBe(false);
  });
});
