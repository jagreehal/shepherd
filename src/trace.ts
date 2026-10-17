// Iteration traces. The agent drives shepherd's steps, so this CLI cannot watch them run. The skill marks each
// step's start and end with `shepherd trace event`, which takes the time from this machine, and
// `shepherd trace flush` turns the record into one `shepherd.iteration` span with a child span per step.
// Spans export through autotel only when OTEL_EXPORTER_OTLP_ENDPOINT is set. Model usage inside a step is the
// harness's to report: these spans time the steps and record their outcomes, nothing inside them.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stateDir } from "./local.ts";

// `stamp` is the wait for stamp's verdict.
export const STAGES = ["checks", "swarm", "verify", "triage", "simplify", "ci-repair", "stamp"] as const;

const Event = z.object({
  at: z.string(),
  stage: z.enum(STAGES),
  phase: z.enum(["start", "end"]),
  round: z.number().int().positive().optional(),
  outcome: z.enum(["ok", "failed", "skipped"]).optional(),
  retries: z.number().int().nonnegative().optional(),
  head_sha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
});

export type TraceEvent = z.infer<typeof Event>;

export type Stage = {
  stage: TraceEvent["stage"];
  round: number | undefined;
  start: string;
  end: string;
  outcome: "ok" | "failed" | "skipped" | "unfinished";
  retries: number;
  head_sha: string | undefined;
};

/** The record for one PR's current iteration, inside the git directory like shepherd's other state. */
export const traceFile = (repoRoot: string, pr: number) => path.join(stateDir(repoRoot), `trace-${pr}.jsonl`);

/** A step event as the CLI receives it, before validation. */
export type EventInput = { stage: string; phase: string; round?: number | undefined; outcome?: string | undefined; retries?: number | undefined; head_sha?: string | undefined };

/** Append one step event, stamped now. Throws on an unknown stage or a malformed field. */
export function recordEvent(file: string, event: EventInput, now = new Date()): TraceEvent {
  const parsed = Event.safeParse({ ...event, at: now.toISOString() });

  if (!parsed.success) throw new Error(`trace event: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);

  const e = parsed.data;

  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(e) + "\n");

  return e;
}

const parseLine = (line: string): TraceEvent[] => {
  try {
    const parsed = Event.safeParse(JSON.parse(line));

    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
};

/** The steps of one iteration, and when its first event happened. */
export type StageRecord = { start: string | null; stages: Stage[] };

/**
 * Steps from the record: each start pairs with the next end of the same stage and round, or of the same stage
 * when the end's round differs from every open start's. A start with no end closes at `now` as unfinished; an
 * end with no start, or a line that does not parse, is dropped.
 */
export function stagesFrom(text: string, now: Date): StageRecord {
  const events = text.split("\n").filter((l) => l.trim()).flatMap(parseLine);
  const open = new Map<string, TraceEvent>();
  const stages: Stage[] = [];

  for (const e of events) {
    const exact = `${e.stage}#${e.round ?? 0}`;
    const key = e.phase === "end" && !open.has(exact) ? ([...open.keys()].filter((k) => k.startsWith(`${e.stage}#`)).at(-1) ?? exact) : exact;
    const started = open.get(key);

    if (e.phase === "start") open.set(key, e);
    else if (started) {
      open.delete(key);
      stages.push({ stage: e.stage, round: started.round ?? e.round, start: started.at, end: e.at, outcome: e.outcome ?? "ok", retries: e.retries ?? 0, head_sha: e.head_sha ?? started.head_sha });
    }
  }

  for (const s of open.values()) stages.push({ stage: s.stage, round: s.round, start: s.at, end: now.toISOString(), outcome: "unfinished", retries: s.retries ?? 0, head_sha: s.head_sha });

  return { start: events[0]?.at ?? null, stages: stages.sort((a, b) => a.start.localeCompare(b.start)) };
}

/** What ties an iteration to the PR, the CI run and other traces: stamp's review, a CI run's trace. */
export type Iteration = {
  repo: string;
  pr: number;
  headSha: string;
  baseSha: string | undefined;
  outcome: string;
  ciRun: number | undefined;
  ciAttempt: number | undefined;
  // W3C traceparent values; each becomes a span link, so separate processes join without one long trace.
  links: string[];
};

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The iteration span's attributes, named like stamp's so one query finds both. An absent value stays undefined. */
export const iterationAttributes = (it: Iteration, stages: Stage[]) => ({
  "vcs.repository.name": it.repo,
  "vcs.change.id": String(it.pr),
  "vcs.ref.head.revision": it.headSha,
  "vcs.ref.base.revision": it.baseSha,
  "cicd.pipeline.run.id": it.ciRun === undefined ? undefined : String(it.ciRun),
  "shepherd.ci.attempt": it.ciAttempt,
  "shepherd.outcome": it.outcome,
  "shepherd.rounds": Math.max(0, ...stages.map((s) => s.round ?? 0)),
  "shepherd.retries": stages.reduce((n, s) => n + s.retries, 0),
});

export const stageAttributes = (s: Stage) => ({
  "shepherd.stage": s.stage,
  "shepherd.outcome": s.outcome,
  "shepherd.retries": s.retries,
  "shepherd.round": s.round,
  "vcs.ref.head.revision": s.head_sha,
});

// OpenTelemetry rejects an undefined attribute value, so absent ones are left off.
const defined = (attrs: ReturnType<typeof iterationAttributes> | ReturnType<typeof stageAttributes>) => Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));

/** Export the iteration and its steps through autotel. The SDK loads only here, so an unset endpoint costs nothing. */
async function exportSpans(start: string, it: Iteration, stages: Stage[], now: Date): Promise<void> {
  const { init, shutdown, getTracer, runWithSpan, SpanStatusCode } = await import("autotel");

  init({ service: process.env.OTEL_SERVICE_NAME || "shepherd" });

  const tracer = getTracer("shepherd");

  const links = it.links.flatMap((l) => {
    const m = TRACEPARENT.exec(l);

    return m ? [{ context: { traceId: m[1]!, spanId: m[2]!, traceFlags: parseInt(m[3]!, 16) } }] : [];
  });

  const root = tracer.startSpan("shepherd.iteration", { startTime: new Date(start), links, attributes: defined(iterationAttributes(it, stages)) });

  for (const s of stages) {
    const span = runWithSpan(root, () => tracer.startSpan(`shepherd.${s.stage}`, { startTime: new Date(s.start), attributes: defined(stageAttributes(s)) }));

    if (s.outcome === "failed" || s.outcome === "unfinished") span.setStatus({ code: SpanStatusCode.ERROR });
    span.end(new Date(s.end));
  }

  root.end(now);
  await shutdown();
}

/**
 * Close the iteration: read its record, export it when an endpoint is set, and clear the record for the next one.
 * The record clears whether or not the export reaches the collector, and the result carries the export's error.
 */
export async function flush(file: string, it: Iteration, now = new Date()): Promise<{ stages: Stage[]; exported: boolean; error?: string }> {
  const { start, stages } = stagesFrom(existsSync(file) ? readFileSync(file, "utf8") : "", now);

  try {
    if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT || !start) return { stages, exported: false };

    await exportSpans(start, it, stages, now);

    return { stages, exported: true };
  } catch (e) {
    return { stages, exported: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    rmSync(file, { force: true });
  }
}
