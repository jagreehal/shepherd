// Optional measurements for garden. Only known span names and numeric measurements leave this module;
// prompts, tool arguments, logs and arbitrary span attributes never become gardener instructions.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { z } from "zod";
import type { PrRecord } from "./garden.ts";
import { STAGES } from "./trace.ts";

const MAX_BYTES = 10_000_000;

const MAX_TRACES = 100;

const MAX_SPANS = 50_000;

const MAX_MEASUREMENTS = 50_000_000;

const KEYS = new Set(["vcs.repository.name", "vcs.change.id", "vcs.ref.head.revision", "shepherd.retries", "shepherd.stage", "shepherd.outcome", "stamp.cost_usd", "stamp.cost_complete"]);

const Id = z.string().transform((s) => /^[0-9a-f]{1,32}$/.test(s) ? s.padStart(32, "0") : /^[A-Za-z0-9+/]{22}==$/.test(s) ? Buffer.from(s, "base64").toString("hex") : s)
  .pipe(z.string().regex(/^[0-9a-f]{32}$/).refine((s) => /[1-9a-f]/.test(s)));

const SpanId = z.string().transform((s) => /^[A-Za-z0-9+/]{11}=$/.test(s) ? Buffer.from(s, "base64").toString("hex") : s).pipe(z.string().regex(/^[0-9a-f]{16}$/));

const Integer = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative().safe()]);

const Attribute = z.object({ key: z.string(), value: z.object({ stringValue: z.string().optional(), intValue: Integer.optional(), doubleValue: z.number().finite().optional(), boolValue: z.boolean().optional() }) });

const Span = z.object({
  name: z.string(), traceId: Id, spanId: SpanId, parentSpanId: z.union([SpanId, z.literal("")]).optional().transform((s) => s || undefined),
  startTimeUnixNano: Integer, endTimeUnixNano: Integer,
  attributes: z.array(Attribute).default([]),
  status: z.object({ code: z.union([z.number(), z.string()]).optional() }).optional(),
}).transform((s) => ({ ...s, attributes: s.attributes.filter((a) => KEYS.has(a.key)) }));

const Resource = z.object({ scopeSpans: z.array(z.object({ spans: z.array(Span) })).default([]) });

// Tempo calls resourceSpans `batches`; collector file exports use resourceSpans, one JSON object per line.
const Envelope = z.object({ resourceSpans: z.array(Resource).optional(), batches: z.array(Resource).optional() })
  .refine((e) => e.resourceSpans !== undefined || e.batches !== undefined);

type Span = z.infer<typeof Span>;

export type TraceInput = { spans: Span[]; sources: number; unavailable: number; limited: boolean; bytes?: number };

export const traceLimits = { retries: 3, waitMs: 300_000, costUsd: 5 };

export type TraceLimits = typeof traceLimits;

export function traceHeaders(raw: string): Record<string, string> {
  try {
    return z.record(z.string(), z.string()).parse(JSON.parse(raw));
  } catch {
    throw new Error("GARDEN_TEMPO_HEADERS must be a JSON object of header strings");
  }
}

/**
 * The credential headers for one Tempo endpoint. GARDEN_TEMPO_HEADERS belongs to GARDEN_TEMPO_URL, so an
 * endpoint on any other origin, such as a `--tempo-url` pointing elsewhere, gets no headers.
 */
export function tempoHeaders(endpoint: string | undefined, configured: string | undefined, raw: string | undefined): Record<string, string> {
  if (!endpoint || !configured || !raw) return {};

  const origin = (u: string) => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  };

  return origin(endpoint) !== null && origin(endpoint) === origin(configured) ? traceHeaders(raw) : {};
}

export type TraceSignal = "trace_stage_failed" | "trace_retries" | "trace_approval_wait" | "trace_review_cost";

/** Decode OTLP JSON or a collector's JSON-lines file. A malformed source contributes no measurements. */
export function parseTraces(text: string): Span[] {
  let envelopes: z.infer<typeof Envelope>[];

  try {
    envelopes = [Envelope.parse(JSON.parse(text))];
  } catch {
    envelopes = text.split("\n").filter((s) => s.trim()).map((s) => Envelope.parse(JSON.parse(s)));
  }

  return envelopes.flatMap((e) => (e.resourceSpans ?? e.batches ?? []).flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
}

/** Open without following symlinks and bound the same descriptor that gets read. */
export function readTraceFile(file: string): Span[] {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const stat = fstatSync(fd);

    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("trace input must be a regular file of at most 10 MB");

    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;

    while (length <= MAX_BYTES) {
      const read = readSync(fd, bytes, length, bytes.length - length, null);

      if (!read) break;
      length += read;
    }

    if (length > MAX_BYTES) throw new Error("trace input exceeds 10 MB");

    return parseTraces(bytes.subarray(0, length).toString("utf8"));
  } finally {
    closeSync(fd);
  }
}

/** Read a response under a byte cap, keeping the timeout active until its body has finished. */
async function readResponse(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error("trace backend request failed");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const next = await reader.read();

      if (next.done) break;
      bytes += next.value.byteLength;

      if (bytes > MAX_BYTES) throw new Error("trace response exceeds 10 MB");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }

  return Buffer.concat(chunks).toString("utf8");
}

const Search = z.object({ traces: z.array(z.object({ traceID: Id })).default([]) });

const appendSpans = (input: TraceInput, spans: Span[]) => {
  const bytes = Buffer.byteLength(JSON.stringify(spans));

  if ((input.bytes ?? 0) + bytes > MAX_MEASUREMENTS) {
    input.limited = true;

    return;
  }

  const available = MAX_SPANS - input.spans.length;
  input.spans.push(...spans.slice(0, available));
  input.bytes = (input.bytes ?? 0) + bytes;
  input.limited ||= spans.length > available;
};

/** Tempo's read-only search and trace-by-id APIs. No URL from a span or search result is ever followed. */
export async function readTempo(endpoint: string, headers: Record<string, string>, repo: string, since: string, now = Date.now()): Promise<TraceInput> {
  const base = new URL(endpoint.endsWith("/") ? endpoint : endpoint + "/");

  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("invalid Tempo endpoint");

  const signal = AbortSignal.timeout(30_000);
  const get = async (url: URL) => readResponse(await fetch(url, { headers: { ...headers, Accept: "application/json" }, redirect: "error", signal }));
  const search = new URL("api/search", base);
  search.searchParams.set("q", `{ (name = "shepherd.iteration" || name = "stamp.review") && span.vcs.repository.name = ${JSON.stringify(repo)} }`);
  search.searchParams.set("start", String(Math.floor(Date.parse(since) / 1000)));
  search.searchParams.set("end", String(Math.floor(now / 1000)));
  search.searchParams.set("limit", String(MAX_TRACES));

  const found = Search.parse(JSON.parse(await get(search))).traces;
  const input: TraceInput = { spans: [], sources: 1, unavailable: 0, limited: found.length >= MAX_TRACES };

  for (const id of new Set(found.map((t) => t.traceID))) {
    try {
      appendSpans(input, parseTraces(await get(new URL(`api/traces/${id}`, base))));
    } catch {
      input.unavailable++;
    }
  }

  return input;
}

// Datadog keeps OTLP attributes nested under `custom` and span IDs in decimal; the trace ID stays 128-bit hex.
// Each field falls back to absent, so one odd attribute drops that measurement, not the span.
const str = z.string().optional().catch(undefined);

const num = z.number().optional().catch(undefined);

const DatadogCustom = z.object({
  vcs: z.object({
    repository: z.object({ name: str }).optional().catch(undefined),
    change: z.object({ id: str }).optional().catch(undefined),
    ref: z.object({ head: z.object({ revision: str }).optional().catch(undefined) }).optional().catch(undefined),
  }).optional().catch(undefined),
  shepherd: z.object({ retries: num, stage: str, outcome: str }).optional().catch(undefined),
  // Datadog stores a boolean attribute as the string "true" or "false".
  stamp: z.object({ cost_usd: num, cost_complete: z.enum(["true", "false"]).optional().catch(undefined) }).optional().catch(undefined),
  otel: z.object({ status_code: str }).optional().catch(undefined),
}).catch({});

const DatadogSpan = z.object({
  attributes: z.object({
    trace_id: z.string(), span_id: z.string().regex(/^\d{1,20}$/), parent_id: z.string().regex(/^\d{1,20}$/),
    start_timestamp: z.iso.datetime(), end_timestamp: z.iso.datetime(), resource_name: z.string(),
    custom: DatadogCustom.default({}),
  }),
});

type DatadogSpan = z.infer<typeof DatadogSpan>;

const DatadogPage = z.object({
  data: z.array(DatadogSpan.nullable().catch(null)).default([]),
  // Datadog sends `page: null` on the last page, and a status other than `done` or any warning when the
  // results are partial, such as a query that timed out.
  meta: z.object({
    page: z.object({ after: z.string() }).nullish(),
    status: z.string().nullish(),
    warnings: z.array(z.unknown()).nullish(),
  }).nullish(),
});

const partial = (page: z.infer<typeof DatadogPage>) => (page.meta?.status ?? "done") !== "done" || Boolean(page.meta?.warnings?.length);

/** Datadog's API hosts, so its keys only ever go to Datadog. */
export const DATADOG_SITES = ["datadoghq.com", "datadoghq.eu", "us3.datadoghq.com", "us5.datadoghq.com", "ap1.datadoghq.com", "ap2.datadoghq.com", "ddog-gov.com"];

const toNano = (iso: string) => String(BigInt(Date.parse(iso)) * 1_000_000n);

const decimalId = (id: string) => BigInt(id).toString(16).padStart(16, "0");

const asText = (key: string, v: string | undefined) => (v === undefined ? [] : [{ key, value: { stringValue: v } }]);

const asDouble = (key: string, v: number | undefined) => (v === undefined ? [] : [{ key, value: { doubleValue: v } }]);

/** One Datadog span in the OTLP shape the scorer reads, keeping only the known attribute keys. */
export function fromDatadog(span: DatadogSpan): Span | null {
  const a = span.attributes;
  const c = a.custom;

  const attributes = [
    ...asText("vcs.repository.name", c.vcs?.repository?.name),
    ...asText("vcs.change.id", c.vcs?.change?.id),
    ...asText("vcs.ref.head.revision", c.vcs?.ref?.head?.revision),
    ...asDouble("shepherd.retries", c.shepherd?.retries),
    ...asText("shepherd.stage", c.shepherd?.stage),
    ...asText("shepherd.outcome", c.shepherd?.outcome),
    ...asDouble("stamp.cost_usd", c.stamp?.cost_usd),
    ...(c.stamp?.cost_complete === undefined ? [] : [{ key: "stamp.cost_complete", value: { boolValue: c.stamp.cost_complete === "true" } }]),
  ];

  const parsed = Span.safeParse({
    name: a.resource_name, traceId: a.trace_id, spanId: decimalId(a.span_id), parentSpanId: a.parent_id === "0" ? "" : decimalId(a.parent_id),
    startTimeUnixNano: toNano(a.start_timestamp), endTimeUnixNano: toNano(a.end_timestamp), attributes,
    status: c.otel?.status_code === "Error" ? { code: 2 } : undefined,
  });

  return parsed.success ? parsed.data : null;
}

/**
 * Datadog's span search: the repository's `shepherd.iteration` and `stamp.review` roots, then every span in those
 * traces, since stage spans carry no repository. The endpoint rate-limits at 300 requests an hour, so the reader
 * batches trace IDs and stops at the trace and span caps.
 */
export async function readDatadog(site: string, apiKey: string, appKey: string, repo: string, since: string, now = Date.now(), get: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<TraceInput> {
  if (!DATADOG_SITES.includes(site)) throw new Error("invalid Datadog site");

  const signal = AbortSignal.timeout(30_000);

  const search = async (query: string, cursor?: string) =>
    DatadogPage.parse(JSON.parse(await readResponse(await get(`https://api.${site}/api/v2/spans/events/search`, {
      method: "POST",
      headers: { "DD-API-KEY": apiKey, "DD-APPLICATION-KEY": appKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ data: { type: "search_request", attributes: { filter: { query, from: new Date(Date.parse(since)).toISOString(), to: new Date(now).toISOString() }, page: { limit: 1000, cursor }, sort: "timestamp" } } }),
      redirect: "error",
      signal,
    }))));

  const roots = await search(`@vcs.repository.name:${JSON.stringify(repo)} resource_name:(shepherd.iteration OR stamp.review)`);
  const ids = [...new Set(roots.data.flatMap((s) => (s ? [s.attributes.trace_id] : [])).filter((id) => /^[0-9a-f]{32}$/.test(id)))].slice(0, MAX_TRACES);
  // Here `limited` tracks only the span budget, so a truncated root search still pages through every trace it found.
  const input: TraceInput = { spans: [], sources: 1, unavailable: 0, limited: false };
  let incomplete = ids.length >= MAX_TRACES || Boolean(roots.meta?.page) || partial(roots);

  for (let i = 0; i < ids.length && !input.limited; i += 50) {
    let cursor: string | undefined;

    do {
      try {
        const page = await search(`trace_id:(${ids.slice(i, i + 50).join(" OR ")})`, cursor);
        appendSpans(input, page.data.flatMap((s) => (s ? (fromDatadog(s) ?? []) : [])));
        incomplete ||= partial(page);
        cursor = page.meta?.page?.after;
      } catch {
        input.unavailable++;
        cursor = undefined;
      }
    } while (cursor && !input.limited);
  }

  input.limited ||= incomplete;

  return input;
}

/** Only operator-selected files and backend configuration enter here; errors never include URLs, headers or bodies. */
export type DatadogConfig = { site: string; apiKey: string; appKey: string };

export async function collectTraces(files: string[], endpoint: string | undefined, headers: Record<string, string>, repo: string, since: string, datadog?: DatadogConfig): Promise<TraceInput> {
  const input: TraceInput = { spans: [], sources: files.length + (endpoint ? 1 : 0) + (datadog ? 1 : 0), unavailable: 0, limited: false };

  if (files.length > MAX_TRACES) throw new Error("at most 100 trace files may be read");

  for (const file of files) {
    try {
      appendSpans(input, readTraceFile(file));
    } catch {
      input.unavailable++;
    }
  }

  const remotes = [endpoint ? () => readTempo(endpoint, headers, repo, since) : null, datadog ? () => readDatadog(datadog.site, datadog.apiKey, datadog.appKey, repo, since) : null];

  for (const read of remotes) {
    if (!read) continue;

    try {
      const remote = await read();
      appendSpans(input, remote.spans);
      input.unavailable += remote.unavailable;
      input.limited ||= remote.limited;
    } catch {
      input.unavailable++;
    }
  }

  return input;
}

const value = (s: Span, key: string) => s.attributes.find((a) => a.key === key)?.value;

const text = (s: Span, key: string) => value(s, key)?.stringValue;

const number = (s: Span, key: string): number | undefined => {
  const v = value(s, key);
  const parsed = z.coerce.number().finite().nonnegative().safeParse(v?.doubleValue ?? v?.intValue);

  return parsed.success ? parsed.data : undefined;
};

const startMs = (s: Span) => Number(BigInt(s.startTimeUnixNano)) / 1e6;

const duration = (s: Span) => Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6;

const unionMs = (intervals: [number, number][]) => {
  let end = 0;
  let total = 0;

  for (const [from, to] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, to - Math.max(from, end));
    end = Math.max(end, to);
  }

  return total;
};

export type TraceSummary = {
  iterations: number; reviews: number; failedStages: number; retries: number; iterationMs: number; approvalWaitMs: number;
  reviewMs: number; knownCostUsd: number; pricedReviews: number; unpricedReviews: number;
  stages: { stage: typeof STAGES[number]; durationMs: number; runs: number; failed: number }[];
  signals: TraceSignal[];
  evidence: { traceId: string; spanId: string; headSha: string; kind: "shepherd.iteration" | "stamp.review" }[];
};

const Kind = z.enum(["shepherd.iteration", "stamp.review"]);

/** Deduplicate exports, then correlate only known PR commits inside the requested window. These are observed samples, not a complete history. */
export function traceScores(input: TraceInput, repo: string, prs: PrRecord[], since: string, limits = traceLimits, now = Date.now()) {
  const spans = [...new Map(input.spans.map((s) => [`${s.traceId}:${s.spanId}`, s])).values()];
  const byPr = new Map(prs.map((pr) => [pr.number, pr]));
  const summaries = new Map<number, TraceSummary>();
  const children = new Map<string, Span[]>();
  let unmatched = 0;

  for (const s of spans) {
    const key = `${s.traceId}:${s.parentSpanId}`;
    const group = children.get(key) ?? [];
    group.push(s);
    children.set(key, group);
  }

  for (const root of spans) {
    const kind = Kind.safeParse(root.name);

    if (!kind.success || text(root, "vcs.repository.name")?.toLowerCase() !== repo.toLowerCase() || startMs(root) < Date.parse(since) || startMs(root) > now) continue;
    const n = Number(text(root, "vcs.change.id") ?? number(root, "vcs.change.id"));
    const pr = byPr.get(n);
    const head = text(root, "vcs.ref.head.revision") ?? "";

    if (!pr || !/^[0-9a-f]{40}$/.test(head) || ![pr.headSha, ...pr.commits.map((c) => c.sha)].includes(head) || duration(root) < 0 || duration(root) > 7 * 864e5) {
      unmatched++;
      continue;
    }

    const summary = summaries.get(n) ?? { iterations: 0, reviews: 0, failedStages: 0, retries: 0, iterationMs: 0, approvalWaitMs: 0, reviewMs: 0, knownCostUsd: 0, pricedReviews: 0, unpricedReviews: 0, stages: [], signals: [], evidence: [] };

    if (summary.evidence.length < 20) summary.evidence.push({ traceId: root.traceId, spanId: root.spanId, headSha: head, kind: kind.data });

    if (kind.data === "stamp.review") {
      summary.reviews++;
      summary.reviewMs += duration(root);
      const cost = number(root, "stamp.cost_usd");

      if (cost !== undefined) summary.knownCostUsd += cost;

      if (cost !== undefined && value(root, "stamp.cost_complete")?.boolValue === true) summary.pricedReviews++;
      else summary.unpricedReviews++;
    } else {
      summary.iterations++;
      summary.iterationMs += duration(root);
      summary.retries += number(root, "shepherd.retries") ?? 0;
      const waits: [number, number][] = [];

      for (const child of children.get(`${root.traceId}:${root.spanId}`) ?? []) {
        const stage = z.enum(STAGES).safeParse(text(child, "shepherd.stage"));
        const elapsed = duration(child);

        if (!stage.success || elapsed < 0 || startMs(child) < startMs(root) || startMs(child) + elapsed > startMs(root) + duration(root)) continue;
        const failed = ["failed", "unfinished"].includes(text(child, "shepherd.outcome") ?? "") || child.status?.code === 2 || child.status?.code === "STATUS_CODE_ERROR";
        const record = summary.stages.find((s) => s.stage === stage.data) ?? { stage: stage.data, durationMs: 0, runs: 0, failed: 0 };
        record.durationMs += elapsed;
        record.runs++;
        record.failed += Number(failed);
        summary.failedStages += Number(failed);

        if (stage.data === "stamp") waits.push([startMs(child), startMs(child) + elapsed]);

        if (!summary.stages.includes(record)) summary.stages.push(record);
      }

      summary.approvalWaitMs += unionMs(waits);
    }

    summaries.set(n, summary);
  }

  for (const s of summaries.values()) {
    if (s.failedStages) s.signals.push("trace_stage_failed");

    if (s.retries >= limits.retries) s.signals.push("trace_retries");

    if (s.approvalWaitMs >= limits.waitMs && s.approvalWaitMs >= s.iterationMs / 2) s.signals.push("trace_approval_wait");

    if (s.knownCostUsd >= limits.costUsd) s.signals.push("trace_review_cost");
  }

  return { summaries, coverage: { sources: input.sources, unavailable: input.unavailable, limited: input.limited, unmatchedRoots: unmatched, observedOnly: true }, limits };
}
