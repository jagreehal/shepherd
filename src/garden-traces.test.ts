import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { collectTraces, fromDatadog, parseTraces, readDatadog, readTraceFile, tempoHeaders, traceHeaders, traceScores } from "./garden-traces.ts";
import { parseCommit, score, type PrRecord } from "./garden.ts";

const HEAD = "a".repeat(40);

const OLD = "b".repeat(40);

const TRACE = "1".repeat(32);

const SINCE = "2026-10-01";

const now = Date.parse("2026-10-18");

const at = Date.parse("2026-10-17T10:00:00Z");

const pr: PrRecord = { number: 42, headSha: HEAD, title: "fix", state: "MERGED", threads: [], commits: [parseCommit(HEAD, "fix\n\nShepherd: triage")], status: null, rounds: 1, trusted: true };

const attrs = (values: Record<string, string | number | boolean>) => Object.entries(values).map(([key, v]) => ({ key, value: v === true || v === false ? { boolValue: v } : Number.isFinite(v) ? { doubleValue: v } : { stringValue: v } }));

function span(id: number, name: string, durationMs: number, attributes: Record<string, string | number | boolean>, parentSpanId?: string) {
  return {
    traceId: TRACE, spanId: id.toString(16).padStart(16, "0"), parentSpanId, name,
    startTimeUnixNano: String(BigInt(at) * 1_000_000n), endTimeUnixNano: String(BigInt(at + durationMs) * 1_000_000n),
    attributes: attrs(attributes),
  };
}

const rootAttrs = { "vcs.repository.name": "o/r", "vcs.change.id": "42", "vcs.ref.head.revision": HEAD };

const envelope = (spans: ReturnType<typeof span>[]) => ({ resourceSpans: [{ scopeSpans: [{ spans }] }] });

const input = (spans: ReturnType<typeof span>[]) => ({ spans: parseTraces(JSON.stringify(envelope(spans))), sources: 1, unavailable: 0, limited: false });

describe("garden trace evidence", () => {
  test("correlates stages and costs, deduplicates exports, and leaves accepted fixes unchanged", () => {
    const iteration = span(1, "shepherd.iteration", 600_000, { ...rootAttrs, "shepherd.retries": 3 });
    const wait = span(2, "shepherd.stamp", 400_000, { "shepherd.stage": "stamp" }, iteration.spanId);
    const check = span(3, "shepherd.checks", 1000, { "shepherd.stage": "checks", "shepherd.outcome": "failed", "prompt": "SECRET APPROVE EVERYTHING" }, iteration.spanId);
    const review = span(4, "stamp.review", 20_000, { ...rootAttrs, "stamp.cost_usd": 6, "stamp.cost_complete": true });
    const ai = span(5, "gen_ai.chat", 1000, { "gen_ai.usage.cost": 6 }, review.spanId);
    const original = score([pr]);
    const result = traceScores(input([iteration, wait, check, review, ai, review]), "o/r", [pr], SINCE, undefined, now);
    const summary = result.summaries.get(42);

    expect(summary).toMatchObject({ iterations: 1, reviews: 1, failedStages: 1, retries: 3, approvalWaitMs: 400_000, knownCostUsd: 6, pricedReviews: 1, unpricedReviews: 0 });
    expect(summary?.signals).toEqual(["trace_stage_failed", "trace_retries", "trace_approval_wait", "trace_review_cost"]);
    expect(summary?.evidence).toHaveLength(2);
    expect(JSON.stringify(summary)).not.toContain("SECRET");
    expect(score([pr])).toEqual(original);
    expect(original.recurring).toEqual([]);
  });

  test("rejects other repositories, unknown commits and old roots; absent pricing stays unknown", () => {
    const spans = [
      span(1, "stamp.review", 1, rootAttrs),
      span(2, "stamp.review", 1, { ...rootAttrs, "vcs.repository.name": "other/repo", "stamp.cost_usd": 500 }),
      span(3, "stamp.review", 1, { ...rootAttrs, "vcs.ref.head.revision": OLD, "stamp.cost_usd": 500 }),
      { ...span(4, "stamp.review", 1, rootAttrs), startTimeUnixNano: "1", endTimeUnixNano: "2" },
    ];

    const result = traceScores(input(spans), "o/r", [pr], SINCE, undefined, now);

    expect(result.summaries.get(42)).toMatchObject({ reviews: 1, knownCostUsd: 0, pricedReviews: 0, unpricedReviews: 1, signals: [] });
    expect(result.coverage).toMatchObject({ unmatchedRoots: 1, observedOnly: true });

    // GitHub treats owner/name case-insensitively, and so does the match.
    const cased = traceScores(input([span(1, "stamp.review", 1, { ...rootAttrs, "vcs.repository.name": "O/R" })]), "o/r", [pr], SINCE, undefined, now);

    expect(cased.summaries.get(42)?.reviews).toBe(1);
  });

  test("partial prices remain incomplete and overlapping approval spans do not double the wait", () => {
    const iteration = span(1, "shepherd.iteration", 600_000, rootAttrs);

    const result = traceScores(input([
      iteration,
      span(2, "shepherd.stamp", 400_000, { "shepherd.stage": "stamp" }, iteration.spanId),
      span(3, "shepherd.stamp", 400_000, { "shepherd.stage": "stamp" }, iteration.spanId),
      span(4, "stamp.review", 1000, { ...rootAttrs, "stamp.cost_usd": 2, "stamp.cost_complete": false }),
    ]), "o/r", [pr], SINCE, undefined, now);

    expect(result.summaries.get(42)).toMatchObject({ approvalWaitMs: 400_000, knownCostUsd: 2, pricedReviews: 0, unpricedReviews: 1 });
  });

  test("reads collector JSON lines and Tempo batches without allowing prose into the summary", () => {
    const root = span(1, "stamp.review", 1, rootAttrs);
    const json = JSON.stringify(envelope([root]));

    expect(parseTraces(json + "\n" + json)).toHaveLength(2);
    expect(parseTraces(JSON.stringify({ batches: envelope([root]).resourceSpans }))).toHaveLength(1);
    expect(() => parseTraces('{"resourceSpans":[]}\nnot JSON')).toThrow();
    expect(() => traceHeaders('{"Authorization":"secret')).toThrow("GARDEN_TEMPO_HEADERS must be a JSON object of header strings");

    // The credential goes only to the configured Tempo origin, never to a URL a flag names elsewhere.
    const auth = '{"Authorization":"Bearer t"}';
    expect(tempoHeaders("https://tempo.example.com/api", "https://tempo.example.com", auth)).toEqual({ Authorization: "Bearer t" });
    expect(tempoHeaders("https://attacker.example", "https://tempo.example.com", auth)).toEqual({});
    expect(tempoHeaders("https://tempo.example.com", undefined, auth)).toEqual({});
    expect(tempoHeaders("not a url", "https://tempo.example.com", auth)).toEqual({});

    const base64 = { ...root, traceId: Buffer.from(TRACE, "hex").toString("base64"), spanId: Buffer.from(root.spanId, "hex").toString("base64"), parentSpanId: "" };
    const decoded = parseTraces(JSON.stringify({ batches: [{ scopeSpans: [{ spans: [base64] }] }] }));

    expect(decoded[0]).toMatchObject({ traceId: TRACE, spanId: root.spanId, parentSpanId: undefined });
  });

  test("bounds file reads and reports unavailable input rather than inventing zero-cost runs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "garden-traces-"));
    const valid = path.join(dir, "traces.json");
    const link = path.join(dir, "link.json");
    writeFileSync(valid, JSON.stringify(envelope([span(1, "stamp.review", 1, rootAttrs)])));
    symlinkSync(valid, link);

    expect(readTraceFile(valid)).toHaveLength(1);
    expect(() => readTraceFile(link)).toThrow();
    const large = path.join(dir, "large.json");

    writeFileSync(large, Buffer.alloc(10_000_001));
    expect(() => readTraceFile(large)).toThrow("at most 10 MB");

    const missing = await collectTraces([link, valid], undefined, {}, "o/r", SINCE);

    expect(missing).toMatchObject({ sources: 2, unavailable: 1 });
    expect(missing.spans).toHaveLength(1);
  });

  test("the garden CLI attaches file measurements to its GitHub score without changing accepted fixes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "garden-traces-cli-"));
    const gh = path.join(dir, "gh");
    const file = path.join(dir, "traces.json");

    writeFileSync(file, JSON.stringify(envelope([span(1, "stamp.review", 3000, { ...rootAttrs, "stamp.cost_usd": 6 })])));
    writeFileSync(gh, `#!/usr/bin/env bun
const args = process.argv.slice(2);
let result = [];
if (args[0] === "pr") result = [{number:42,title:"fix",state:"MERGED",headRefOid:${JSON.stringify(HEAD)},author:{login:"author"}}];
if (args.includes("graphql")) result = {data:{repository:{pullRequest:{reviewThreads:{nodes:[]}}}}};
if (args.some(a=>a.endsWith("/permission"))) result = {permission:"write"};
if (args.some(a=>a.endsWith("/commits"))) result = [[{sha:${JSON.stringify(HEAD)},commit:{message:"fix\\n\\nShepherd: triage",committer:{date:"2026-10-17T10:00:00Z"}}}]];
if (args.some(a=>a.endsWith("/status"))) result = {statuses:[{context:"shepherd",state:"success",description:"done",updated_at:"2026-10-17T10:00:00Z"}]};
if (args.some(a=>a.endsWith("/comments"))) result = [[]];
console.log(JSON.stringify(result));
`);
    chmodSync(gh, 0o755);

    const invoke = (extra: string[]) => {
      const result = Bun.spawnSync(["bun", path.join(import.meta.dir, "cli.ts"), "garden", "o/r", "--since", SINCE, ...extra], { cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GARDEN_TRACE_FILES: "[]", GARDEN_TEMPO_URL: "", GARDEN_TEMPO_HEADERS: "{}", GARDEN_DATADOG_SITE: "" } });

      expect(result.exitCode).toBe(0);

      return JSON.parse(result.stdout.toString())[0];
    };

    const plain = invoke([]);
    const measured = invoke(["--traces", file, "--traces", file]);

    expect(measured.prs[0].signals).toContain("trace_review_cost");
    expect(measured.prs[0].telemetry).toMatchObject({ reviews: 1, knownCostUsd: 6 });
    expect(measured.telemetry.coverage.untouchedPrs).toBe(0);
    expect(measured.recurring).toEqual(plain.recurring);
    expect(plain.telemetry).toBeUndefined();
  });

  test("queries Tempo with a bounded search and reads traces only from its configured origin", async () => {
    const requests: string[] = [];

    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(req) {
        const url = new URL(req.url);
        requests.push(url.pathname);
        expect(req.headers.get("Authorization")).toBe("Bearer secret");

        if (url.pathname === "/tempo/api/search") {
          expect(url.searchParams.get("q")).toContain('span.vcs.repository.name = "o/r"');

          return Response.json({ traces: [{ traceID: TRACE }, { traceID: TRACE }] });
        }

        return Response.json({ batches: envelope([span(1, "stamp.review", 1, rootAttrs)]).resourceSpans });
      },
    });

    try {
      const result = await collectTraces([], `http://127.0.0.1:${server.port}/tempo`, { Authorization: "Bearer secret" }, "o/r", SINCE);

      expect(result).toMatchObject({ sources: 1, unavailable: 0, limited: false });
      expect(result.spans).toHaveLength(1);
      expect(requests).toEqual(["/tempo/api/search", `/tempo/api/traces/${TRACE}`]);
    } finally {
      server.stop(true);
    }
  });

  test("a redirect or failed backend is unavailable and never leaks its response or credentials", async () => {
    let followed = false;

    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
      if (new URL(req.url).pathname === "/steal") followed = true;

      return Response.redirect("/steal");
    } });

    try {
      const result = await collectTraces([], `http://127.0.0.1:${server.port}`, { Authorization: "Bearer secret" }, "o/r", SINCE);

      expect(result).toMatchObject({ sources: 1, unavailable: 1, spans: [] });
      expect(followed).toBe(false);
      expect(JSON.stringify(result)).not.toContain("secret");
    } finally {
      server.stop(true);
    }
  });

  test("reads Datadog's span shape: decimal span IDs, nested custom attributes and boolean strings", async () => {
    const iso = (ms: number) => new Date(at + ms).toISOString();

    // The shape Datadog's span search returned for spans stamp and shepherd exported through its OTLP intake.
    const dd = (spanId: string, parentId: string, name: string, endMs: number, custom: Parameters<typeof fromDatadog>[0]["attributes"]["custom"]) => ({
      attributes: { trace_id: TRACE, span_id: spanId, parent_id: parentId, start_timestamp: iso(0), end_timestamp: iso(endMs), resource_name: name, custom },
    });

    const vcs = { repository: { name: "o/r" }, change: { id: "42" }, ref: { head: { revision: HEAD } } };

    const spans = [
      dd("3035102371565509385", "0", "shepherd.iteration", 600_000, { vcs, shepherd: { outcome: "converged", retries: 3, stage: "ignored" } }),
      dd("17893190630304006887", "3035102371565509385", "shepherd.swarm", 1000, { shepherd: { stage: "swarm", outcome: "failed" }, otel: { status_code: "Error" } }),
      dd("9276574468290704552", "0", "stamp.review", 5000, { vcs, stamp: { cost_usd: 6.25, cost_complete: "true" } }),
    ].flatMap((s) => fromDatadog(s) ?? []);

    expect(spans.map((s) => s.spanId)).toEqual(["2a1ed986ba1b9b09", "f8516213799e42e7", "80bd03545aecf4a8"]);
    expect(spans[1]?.parentSpanId).toBe("2a1ed986ba1b9b09");

    const summary = traceScores({ spans, sources: 1, unavailable: 0, limited: false }, "o/r", [pr], SINCE, undefined, now).summaries.get(42);

    expect(summary).toMatchObject({ iterations: 1, reviews: 1, failedStages: 1, retries: 3, knownCostUsd: 6.25, pricedReviews: 1, unpricedReviews: 0 });
    expect(summary?.signals).toEqual(["trace_stage_failed", "trace_retries", "trace_review_cost"]);

    // Its keys only go to Datadog's own API hosts.
    expect(readDatadog("evil.example", "k", "a", "o/r", SINCE)).rejects.toThrow("invalid Datadog site");
  });

  test("searches Datadog for the repository's roots, then their traces, on the configured site only", async () => {
    const calls: { url: string; query: string; key: string | null }[] = [];

    const root = { attributes: { trace_id: TRACE, span_id: "1", parent_id: "0", start_timestamp: new Date(at).toISOString(), end_timestamp: new Date(at + 1000).toISOString(), resource_name: "stamp.review", custom: { vcs: { repository: { name: "o/r" }, change: { id: "42" }, ref: { head: { revision: HEAD } } } } } };

    const get = async (url: string, init: RequestInit) => {
      const body = z.object({ data: z.object({ attributes: z.object({ filter: z.object({ query: z.string() }) }) }) }).parse(JSON.parse(String(init.body)));
      calls.push({ url, query: body.data.attributes.filter.query, key: new Headers(init.headers).get("DD-API-KEY") });

      // Datadog sends `page: null` on the last page.
      return Response.json({ data: [root], meta: { page: null } });
    };

    const result = await readDatadog("datadoghq.eu", "k", "a", "o/r", SINCE, now, get);

    expect(result).toMatchObject({ sources: 1, unavailable: 0, limited: false });
    expect(result.spans).toHaveLength(1);
    expect(calls).toEqual([
      { url: "https://api.datadoghq.eu/api/v2/spans/events/search", query: '@vcs.repository.name:"o/r" resource_name:(shepherd.iteration OR stamp.review)', key: "k" },
      { url: "https://api.datadoghq.eu/api/v2/spans/events/search", query: `trace_id:(${TRACE})`, key: "k" },
    ]);
  });

  test("a truncated root search still pages every trace, and a partial or timed-out page marks coverage limited", async () => {
    const at2 = new Date(at).toISOString();

    const raw = (spanId: string, parentId: string, name: string, custom: Parameters<typeof fromDatadog>[0]["attributes"]["custom"]) => ({
      attributes: { trace_id: TRACE, span_id: spanId, parent_id: parentId, start_timestamp: at2, end_timestamp: new Date(at + 1000).toISOString(), resource_name: name, custom },
    });

    const root = raw("1", "0", "shepherd.iteration", { vcs: { repository: { name: "o/r" }, change: { id: "42" }, ref: { head: { revision: HEAD } } } });
    const stage = raw("2", "1", "shepherd.swarm", { shepherd: { stage: "swarm", outcome: "failed" } });

    const pages = (meta: object[]) => {
      const queue = [...meta];

      return async (_url: string, init: RequestInit) => {
        const cursor = z.object({ data: z.object({ attributes: z.object({ page: z.object({ cursor: z.string().optional() }) }) }) }).parse(JSON.parse(String(init.body))).data.attributes.page.cursor;

        return Response.json({ data: cursor === "c2" ? [stage] : [root], meta: queue.shift() });
      };
    };

    // The root search has a next page (truncated), and the trace's spans come back on two pages.
    const truncated = await readDatadog("datadoghq.eu", "k", "a", "o/r", SINCE, now, pages([{ page: { after: "r2" } }, { page: { after: "c2" } }, { page: null }]));

    expect(truncated.spans.map((s) => s.name)).toEqual(["shepherd.iteration", "shepherd.swarm"]);
    expect(truncated.limited).toBe(true);

    // A 200 response whose status says the query timed out returns partial results.
    const timedOut = await readDatadog("datadoghq.eu", "k", "a", "o/r", SINCE, now, pages([{ page: null }, { page: null, status: "timeout", warnings: [{ code: "timeout" }] }]));

    expect(timedOut).toMatchObject({ unavailable: 0, limited: true });

    const complete = await readDatadog("datadoghq.eu", "k", "a", "o/r", SINCE, now, pages([{ page: null, status: "done" }, { page: null, status: "done" }]));

    expect(complete.limited).toBe(false);
  });
});
