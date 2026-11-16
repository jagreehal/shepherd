// Under fixes.mode suggest with no team lenses the gate's posted review is the review: the CI loop runs no model and
// posts nothing. It sets the `shepherd` status from the gate's verdict and the head's checks, and once the gate
// approves a head it resolves the bots' threads on earlier heads.
import type { Thread } from "../gate/src/github.ts";
import { HEADER } from "./garden.ts";
import { gateOnHead, isGateRun, isRed, type PrFacts } from "./status.ts";

/** How a status waiting only on answered threads begins: publish resolves them, then sets the status again. */
export const RESOLVING = "the gate approved; resolving";

/** The status.json publish reads: the `shepherd` commit status for the head. */
export type CiStatus = { state: "success" | "pending" | "failure"; description: string };

const NEXT = {
  REFUSED: "read its review, then push a fix",
  ESCALATE: "a person decides",
  DISMISSED: "comment /gate to review again",
  ERROR: "it could not review; comment /gate",
} as const;

/**
 * The `shepherd` status for the head, from the gate's posted verdict. Success needs the gate's approval of this head
 * (or one kept over an identical diff), every other check passed, and no open thread. `self` names this workflow,
 * which is still running.
 */
export function statusFromGate(facts: PrFacts, self: string): CiStatus {
  const line = (s: string) => s.split(/\s+/).join(" ").slice(0, 139);
  const gate = gateOnHead(facts);
  const checks = facts.runs.filter((r) => r.name !== self);
  const running = checks.filter((r) => r.status !== "completed");
  // The gate's own run fails on a refusal; its verdict speaks for it.
  const failed = checks.filter((r) => isRed(r) && !isGateRun(r.name));

  const next = Object.entries(NEXT).find(([v]) => v === gate?.verdict)?.[1] ?? "read it";

  if (gate && gate.verdict !== "APPROVED") return { state: "failure", description: line(`the gate's review of this head is ${gate.verdict}: ${next}`) };

  if (failed.length) return { state: "failure", description: line(`fix ${failed.map((r) => r.name).join(", ")}`) };

  if (running.length) return { state: "pending", description: line(`waiting on ${running.map((r) => r.name).join(", ")}`) };

  if (!gate) return { state: "pending", description: "waiting for the gate's review of this head" };

  if (facts.changesRequested.length) return { state: "failure", description: line(`changes requested by ${facts.changesRequested.join(", ")}`) };

  const answered = facts.answeredThreads ?? 0;
  const others = facts.openThreads - answered;

  if (others > 0) return { state: "failure", description: `the gate approved; resolve the ${others} open review thread(s)` };

  // Never success while a thread is open: publish resolves the answered ones, then counts again.
  if (answered > 0) return { state: "pending", description: `${RESOLVING} ${answered} answered thread(s)` };

  return { state: "success", description: "the gate approved this head; checks green and no open thread" };
}

/**
 * A thread the gate's approval of the head answers: unresolved, read whole, and every comment shepherd's or the gate's
 * own (GitHub Actions' bot, or `viewer`, the account shepherd posts through) with the header. The gate reviews each
 * head from scratch and raises a finding that still holds again, so its earlier threads are answered; a swarm thread
 * is answered only once the code under it changed. Anyone else in it, or a comment past the 50 read, keeps it open.
 */
export const retirable = (t: Thread, viewer: string | null) =>
  !t.isResolved &&
  t.comments.totalCount === t.comments.nodes.length &&
  t.comments.nodes.every((c) => c.author !== null && ((c.author.__typename === "Bot" && c.author.login === "github-actions") || c.author.login === viewer) && c.body.includes(HEADER)) &&
  (t.isOutdated || t.comments.nodes.every((c) => c.body.includes("<!-- gate-run:")));
