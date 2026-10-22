/**
 * Swarm's summary comment, rendered in code from the round's JSON. The comment keeps the same shape every round, so a
 * reader scans one line per section and garden parses the heading. Every model-written string is defused here.
 */
import { z } from "zod";
import type { BRANDING } from "./config.ts";

const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NIT"]);

export const SummaryInput = z.object({
  head_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  verdict: z.enum(["blocked", "changes", "nits", "good"]),
  why: z.string(),
  findings: z.array(z.object({ file: z.string().default(""), line: z.union([z.number().int().nonnegative(), z.string().regex(/^(?:\d+(?:-\d+)?|general)$/)]).optional(), severity: Severity, lens: z.string(), body: z.string(), convergent: z.boolean().default(false) })).default([]),
  still_open: z.array(z.object({ url: z.string().regex(/^https:\/\/github\.com\/[\w./#-]+$/), title: z.string() })).default([]),
  checks: z.array(z.object({ tool: z.string(), status: z.enum(["ran", "unavailable"]), findings: z.number().default(0), reason: z.string().optional() })).default([]),
  lenses: z.array(z.object({ lens: z.string(), model: z.string().default(""), scope: z.union([z.string(), z.array(z.string())]).default("full"), status: z.enum(["ok", "failed", "could_not_run"]), take: z.string().default(""), skill_blob: z.string().default("") })).default([]),
  lenses_yml_blob: z.string().default(""),
});

export type SummaryInput = z.input<typeof SummaryInput>;

type Emoji = Record<keyof typeof BRANDING.emoji, string>;

const VERDICT = { blocked: ["blocked", "BLOCKED"], changes: ["changes_needed", "CHANGES NEEDED"], nits: ["approve_with_nits", "APPROVE WITH NITS"], good: ["looks_good", "LOOKS GOOD"] } as const;

const SEVERITIES = Severity.options;

const GLYPH = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", NIT: "nit" } as const satisfies Record<z.infer<typeof Severity>, keyof Emoji>;

/** Model text made inert: no hidden markers, mentions, images or control characters, one table cell when `cell`. */
export function defuse(text: string, cell = false): string {
  const out = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replaceAll("<!--", "&lt;!--")
    .replace(/<(\/?)(img|picture|source|video|iframe|details|summary)\b/gi, "&lt;$1$2")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[image removed: $1]")
    .replaceAll("![", "!\\[") // reference-style images too: `![x][ref]` with a `[ref]: url` line elsewhere
    .replace(/(?<![\w/])@(?=[A-Za-z0-9])/g,"@​");

  return cell ? out.replace(/\r?\n/g, " ").replaceAll("|", "\\|") : out;
}

/** The latest round of a summary already on the PR, folded into one history line, plus the history it carried. */
export function earlierRounds(previous: string | undefined) {
  if (!previous) return { round: 0, history: [] };

  const latest = /^## \S+ ([A-Z_ ]+?) <sub>\((?:round (\d+)|handoff) @ ([0-9a-f]{7,40})\)<\/sub>/m.exec(previous);
  const carried = previous.match(/^(?:round \d+|handoff) @ [0-9a-f]{7,40}: [^\n]{0,200}$/gm) ?? [];
  const round = Number(latest?.[2] ?? Math.max(0, ...carried.map((l) => Number(/^round (\d+)/.exec(l)?.[1] ?? 0))));

  return { round, history: [...(latest ? [`${latest[2] ? `round ${latest[2]}` : "handoff"} @ ${latest[3]}: ${latest[1]}`] : []), ...carried] };
}

const section = (summary: string, body: string[], open = false) => [`<details${open ? " open" : ""}>`, `<summary>${summary}</summary>`, "", ...body, "", "</details>", ""];

/**
 * The summary comment: the verdict heading, why, then one collapsed section per part of the round. With a null header
 * it is the body alone, for the handoff file the publish job wraps in its own marker and header.
 */
export function renderSummary(raw: SummaryInput, emoji: Emoji, header: string | null, previous?: string): string {
  const s = SummaryInput.parse(raw);
  const [key, label] = VERDICT[s.verdict];
  const { round, history } = earlierRounds(previous);
  const sha = s.head_sha.slice(0, 7);
  const glyph = (sev: z.infer<typeof Severity>) => emoji[GLYPH[sev]];
  const where = (f: (typeof s.findings)[number]) => (f.file ? ` · \`${defuse(f.file, true).replaceAll("`", "")}${f.line !== undefined && f.line !== "general" ? `:${f.line}` : ""}\`` : "");

  const findings = SEVERITIES.flatMap((sev) => s.findings.filter((f) => f.severity === sev));

  const counts = SEVERITIES.flatMap((sev) => {
    const n = s.findings.filter((f) => f.severity === sev).length;

    return n ? [`${glyph(sev)} ${n} ${sev}`] : [];
  });

  const ran = s.checks.filter((c) => c.status === "ran");
  const failed = s.lenses.filter((l) => l.status !== "ok");
  const out = [...(header === null ? [] : ["<!-- shepherd-swarm-summary -->", "> [!NOTE]", header, ""]), `## ${emoji[key]} ${label} <sub>(round ${round + 1} @ ${sha})</sub>`, "", defuse(s.why), ""];

  out.push(
    ...section(
      `<strong>Findings:</strong> ${counts.join(" · ") || "none"}`,
      findings.length ? findings.flatMap((f) => [`**${glyph(f.severity)} ${f.severity}**${where(f)} · ${f.convergent ? "convergent: " : ""}${defuse(f.lens, true)}`, "", defuse(f.body), ""]) : ["Nothing this round."],
      s.verdict !== "good",
    ),
  );

  if (s.still_open.length) out.push(...section(`<strong>Still open:</strong> ${s.still_open.length}`, s.still_open.map((t) => `- [${defuse(t.title, true).replace(/[[\]]/g, "")}](${t.url})`)));

  if (s.checks.length) {
    const skipped = s.checks.length - ran.length;

    out.push(
      ...section(
        `<strong>Checks:</strong> ${ran.length} ran${skipped ? ` · ⏭️ ${skipped} skipped` : ""}`,
        s.checks.map((c) => (c.status === "ran" ? `- ${defuse(c.tool, true)}: ${c.findings} finding${c.findings === 1 ? "" : "s"}` : `- checks skipped: ${defuse(c.tool, true)} (${defuse(c.reason ?? "unavailable", true)})`)),
      ),
    );
  }

  if (s.lenses.length) {
    out.push(
      ...section(`<strong>Lenses:</strong> ${s.lenses.length - failed.length} ok${failed.length ? ` · ❌ ${failed.length} did not finish` : ""}`, [
        "| Lens | Model | Scope | Status | Take | SKILL.md |",
        "| --- | --- | --- | --- | --- | --- |",
        ...s.lenses.map((l) => `| ${[l.lens, l.model, Array.isArray(l.scope) ? l.scope.join(", ") : l.scope, l.status, l.take, l.skill_blob.slice(0, 7)].map((c) => defuse(c, true)).join(" | ")} |`),
        ...(s.lenses_yml_blob ? ["", `<sub>lenses.yml ${defuse(s.lenses_yml_blob.slice(0, 7), true)}</sub>`] : []),
      ]),
    );
  }

  // The handoff body (no header) leaves history to the publish job, which folds in the comment it replaces.
  if (history.length && header !== null) out.push(...section(`Earlier rounds (${history.length})`, [defuse(history.join("\n"))]));

  return out.join("\n").trimEnd() + "\n";
}
