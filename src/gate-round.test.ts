import { expect, test } from "bun:test";
import { GateEvidence, roundFromGate, statusFromRound } from "./gate-round.ts";
import type { PrFacts } from "./status.ts";
import { SummaryInput } from "./summary.ts";

const head = "3b240742f60b6fb873bc3e6b5bd4202d9555ec8e";

test("a gate review becomes a round publish can render: issues anchor on their line, notes stay off the diff", () => {
  const round = roundFromGate(GateEvidence.parse({
    head,
    verdict: "REFUSED",
    llm: {
      verdict: "REFUSE",
      reasoning: "clamp no longer applies the lower bound.",
      issues: ["src/index.ts:42 clamp ignores min. clamp(-5, 0, 10) returns -5, should return 0. Restore Math.max(n, min)."],
      notes: ["The doc comment still describes [min, max]."],
      change_summary: "Simplifies clamp.",
      run: { model: "bedrock/openai.gpt-oss-120b-1:0" },
    },
  }));

  expect(round.verdict).toBe("changes");
  expect(round.findings?.[0]).toMatchObject({ file: "src/index.ts", line: 42, severity: "HIGH", inline: true, title: "clamp ignores min." });
  expect(round.findings?.[1]).toMatchObject({ file: "", line: "general", severity: "NIT", inline: false });
  expect(() => SummaryInput.parse(round)).not.toThrow();
});

test("an approval with no notes looks good; a denied PR is blocked without a model call; an error is no round at all", () => {
  expect(roundFromGate(GateEvidence.parse({ head, verdict: "APPROVED", llm: { verdict: "APPROVE", reasoning: "Docs only.", issues: [] } })).verdict).toBe("good");
  expect(roundFromGate(GateEvidence.parse({ head, verdict: "REFUSED", gates: [{ passed: false, message: "touches gate_policy" }], llm: null })).verdict).toBe("blocked");
  expect(() => roundFromGate(GateEvidence.parse({ head, verdict: "ERROR", llm: null }))).toThrow("the gate produced no review (ERROR)");
});

test("the gate's final verdict decides, not the model's: a failed second opinion is no round, a late escalation is blocked", () => {
  const approve = { verdict: "APPROVE" as const, reasoning: "Looks fine.", issues: [] };

  expect(() => roundFromGate(GateEvidence.parse({ head, verdict: "ERROR", reasoning: "Review failed before reaching a verdict: timeout", llm: approve }))).toThrow("timeout");

  const escalated = roundFromGate(GateEvidence.parse({ head, verdict: "ESCALATE", reasoning: "This PR's test run checks less than the base branch's.", llm: approve }));

  expect(escalated.verdict).toBe("blocked");
  expect(escalated.why).toContain("checks less than the base branch's");
  expect(roundFromGate(GateEvidence.parse({ head, verdict: "REFUSED", llm: approve })).verdict).toBe("changes");
});

test("a gate round's status: blocked and refused fail for the author, an approval succeeds only on green checks and no open thread", () => {
  const facts: PrFacts = { pr: 1, state: "OPEN", head, url: "", gate: { verdict: "APPROVED", head }, changesRequested: [], openThreads: 0, runs: [{ name: "ci", status: "completed", conclusion: "success", url: "" }, { name: "shepherd", status: "in_progress", conclusion: "", url: "" }] };
  const approved = roundFromGate(GateEvidence.parse({ head, verdict: "APPROVED", llm: { verdict: "APPROVE", reasoning: "Docs only.", issues: [] } }));
  const status = (round: typeof approved, f: Partial<PrFacts> = {}) => statusFromRound(round, { ...facts, ...f }, "shepherd");

  expect(status(approved)).toEqual({ state: "success", description: "the gate approved this head; checks green and no open thread" });
  expect(status(approved, { runs: [{ name: "ci", status: "completed", conclusion: "failure", url: "" }] })).toMatchObject({ state: "failure", description: "the review approved; fix ci" });
  // Only the gate's own workflows are the gate: a red api-gateway is CI like any other.
  expect(status(approved, { runs: [{ name: "api-gateway", status: "completed", conclusion: "failure", url: "" }] }).state).toBe("failure");
  expect(status(approved, { runs: [{ name: "shepherd-gate", status: "completed", conclusion: "failure", url: "" }] }).state).toBe("success");
  // Green is listed, not red: a check waiting on someone blocks, and a skipped or neutral one does not.
  expect(status(approved, { runs: [{ name: "deploy-preview", status: "completed", conclusion: "action_required", url: "" }] })).toMatchObject({ state: "failure", description: "the review approved; fix deploy-preview" });
  expect(status(approved, { runs: [{ name: "docs", status: "completed", conclusion: "skipped", url: "" }, { name: "lint", status: "completed", conclusion: "neutral", url: "" }] }).state).toBe("success");
  // The private review is not the gate's approval: it must be posted on this head, or kept over an identical diff.
  expect(status(approved, { gate: undefined }).state).toBe("pending");
  expect(status(approved, { gate: { verdict: "APPROVED", head: "0".repeat(40) } }).state).toBe("pending");
  expect(status(approved, { gate: { verdict: "APPROVED", head: "0".repeat(40), kept: true } }).state).toBe("success");

  for (const verdict of ["REFUSED", "ESCALATE", "DISMISSED", "ERROR"]) expect(status(approved, { gate: { verdict, head } }).state).toBe("failure");
  expect(status(approved, { runs: [{ name: "lint", status: "in_progress", conclusion: "", url: "" }] }).state).toBe("pending");
  expect(status(approved, { openThreads: 2 }).state).toBe("failure");
  expect(status(approved, { head: "0".repeat(40) }).state).toBe("pending");

  const blocked = roundFromGate(GateEvidence.parse({ head, verdict: "ESCALATE", reasoning: "Touches billing.", llm: { verdict: "APPROVE", reasoning: "Fine.", issues: [] } }));

  expect(status(blocked)).toMatchObject({ state: "failure", description: "A person decides: the gate escalated it. Touches billing." });
  expect(status(roundFromGate(GateEvidence.parse({ head, verdict: "REFUSED", gates: [{ passed: false, message: "touches gate_policy" }], llm: null }))).state).toBe("failure");
  expect(status(roundFromGate(GateEvidence.parse({ head, verdict: "REFUSED", llm: { verdict: "REFUSE", reasoning: "Bug.", issues: ["src/a.ts:1 bug"] } }))).state).toBe("failure");
});
