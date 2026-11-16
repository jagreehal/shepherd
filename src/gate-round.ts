// Under fixes.mode suggest the CI loop runs no agent: the gate's engine reviews (a model with read, grep and glob over
// the checkout and no shell, so it cannot comment, push or start another agent), and its verdict becomes the round
// that publish renders and posts.
import { z } from "zod";
import { gateOnHead, isGateRun, isRed, type PrFacts } from "./status.ts";
import type { SummaryInput } from "./summary.ts";

/** The part of `shepherd gate --json` a round needs. */
export const GateEvidence = z.object({
  head: z.string(),
  verdict: z.string(),
  reasoning: z.string().optional(),
  gates: z.array(z.object({ passed: z.boolean(), message: z.string() })).default([]),
  llm: z
    .object({
      verdict: z.enum(["APPROVE", "REFUSE", "ESCALATE"]),
      reasoning: z.string(),
      issues: z.array(z.string()),
      notes: z.array(z.string()).default([]),
      change_summary: z.string().default(""),
      run: z.object({ model: z.string() }).partial().optional(),
    })
    .nullish(),
});

// The gate asks for each issue to start with file:line and a short title.
const LOCATION = /^`?([\w./@-]+\.[\w]+):(\d+)(?:-(\d+))?`?\s*[-:—–]?\s*/;

function finding(text: string, severity: "HIGH" | "NIT") {
  const at = LOCATION.exec(text);
  const body = at ? text.slice(at[0].length) : text;
  const title = (body.split(/(?<=[.!?])\s|\n/)[0] ?? body).slice(0, 120);
  // Notes are non-blocking and may be refuted concerns: listed in the summary, never posted on a line.
  const line = at && (at[3] ? `${at[2]}-${at[3]}` : Number(at[2]));

  return { file: at?.[1] ?? "", line: line || "general", severity, lens: "correctness", title, body, inline: Boolean(at) && severity !== "NIT" };
}

/** The gate's evidence (`shepherd gate --json`) as a swarm round. Throws when the gate produced no review. */
export function roundFromGate(e: z.infer<typeof GateEvidence>): SummaryInput {
  if (!e.llm) {
    const denied = e.gates.filter((g) => !g.passed).map((g) => g.message);

    if (!denied.length) throw new Error(`the gate produced no review (${e.verdict})`);

    return { head_sha: e.head, verdict: "blocked", why: `Not reviewed: the gate denied it (${denied.join("; ")}). A person reviews it.`, lenses: [{ lens: "correctness", status: "could_not_run", take: denied.join("; ") }] };
  }

  // The gate's final verdict, not the model's: a failed second opinion is ERROR, and checks after the review can
  // escalate an approval. Only APPROVED reads as clean.
  if (e.verdict === "ERROR") throw new Error(`the gate's review failed: ${e.reasoning ?? "no reason given"}`);

  const { llm } = e;
  const verdict = e.verdict === "APPROVED" ? (llm.notes.length ? "nits" : "good") : e.verdict === "REFUSED" ? "changes" : "blocked";

  return {
    head_sha: e.head,
    verdict,
    why: verdict === "blocked" ? `A person decides: the gate escalated it. ${e.reasoning ?? llm.reasoning}` : (e.reasoning ?? llm.reasoning),
    findings: [...llm.issues.map((i) => finding(i, "HIGH")), ...llm.notes.map((n) => finding(n, "NIT"))],
    walkthrough: llm.change_summary ? [llm.change_summary] : [],
    lenses: [{ lens: "correctness", model: llm.run?.model ?? "", status: "ok", take: llm.reasoning }],
  };
}

/** The status.json publish reads: the `shepherd` commit status for the reviewed head. */
export type RoundStatus = { state: "success" | "pending" | "failure"; description: string };

/**
 * The `shepherd` status a gate-engine round hands publish (status.json). A blocked or refused round goes to the
 * author. An approval reaches success once the gate's posted approval covers this head, every other check on it
 * passed, and no thread is open. `self` names this workflow, which is still running.
 */
export function statusFromRound(round: SummaryInput, facts: PrFacts, self: string): RoundStatus {
  const line = (s: string) => s.split(/\s+/).join(" ").slice(0, 139);

  if (round.verdict === "blocked") return { state: "failure", description: line(round.why ?? "the gate escalated it: a person decides") };

  if (round.verdict === "changes") return { state: "failure", description: line(`the gate refused it: ${round.findings?.length ?? 0} finding(s) for the author`) };

  if (!facts.head.startsWith(round.head_sha) && !round.head_sha.startsWith(facts.head)) return { state: "pending", description: "the PR moved past the reviewed head" };

  const others = facts.runs.filter((r) => r.name !== self);
  const running = others.filter((r) => r.status !== "completed");
  // The gate's own run fails on a refusal; its posted verdict, read below, speaks for it.
  const failed = others.filter((r) => isRed(r) && !isGateRun(r.name));
  // This round reviews privately: success also needs the gate's posted approval of this head.
  const gate = gateOnHead(facts);

  if (failed.length) return { state: "failure", description: line(`the review approved; fix ${failed.map((r) => r.name).join(", ")}`) };

  if (gate && gate.verdict !== "APPROVED") return { state: "failure", description: line(`the gate's review of this head is ${gate.verdict}: read it, then push a fix or comment /gate`) };

  if (running.length) return { state: "pending", description: line(`the review approved; waiting on ${running.map((r) => r.name).join(", ")}`) };

  if (!gate) return { state: "pending", description: "the review approved; waiting for the gate's approval of this head" };

  if (facts.openThreads) return { state: "failure", description: `the gate approved; resolve the ${facts.openThreads} open review thread(s)` };

  return { state: "success", description: "the gate approved this head; checks green and no open thread" };
}
