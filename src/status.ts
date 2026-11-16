// One answer to "where is my PR?": the gate's verdict, shepherd's status, people's reviews and CI on the PR's current
// head, folded into a single stage and the one thing to do next. Read-only: `shepherd status <pr>` gathers the facts.

export type Stage = "reviewing" | "fixing" | "waiting for CI" | "needs you" | "ready" | "merged" | "closed";

export type Run = { name: string; status: string; conclusion: string; url: string };

export type PrFacts = {
  pr: number;
  state: string; // OPEN, MERGED, CLOSED
  head: string;
  url: string;
  /**
   * The gate's latest verdict and the head it reviewed, from its own markers only (DISMISSED: an approval taken back).
   * `kept`: an approval of an earlier head whose PR diff matches the current one byte for byte, which the gate keeps.
   */
  gate?: { verdict: string; head: string; kept?: boolean };
  /** The `shepherd` commit status on the head, if the loop has run on it. */
  shepherd?: { state: string; description: string };
  /** People whose latest review requests changes. */
  changesRequested: string[];
  /** Unresolved review threads, whoever opened them. */
  openThreads: number;
  /** Of those, the bots' own threads the gate's approval of this head answers: publish resolves them. */
  answeredThreads?: number;
  /** Checks on the head: Actions workflow runs, other apps' check runs and commit statuses (CI outside Actions). */
  runs: Run[];
};

export type PrStatus = { stage: Stage; lines: string[]; next: string };

const short = (sha: string) => sha.slice(0, 7);

/** A finished check that is not green. Listed by what passes, so action_required, stale or a new conclusion blocks. */
export const isRed = (r: Run) => r.status === "completed" && !/^(success|neutral|skipped)$/.test(r.conclusion);

/** The gate's own workflows, by the names its templates give them: a repo's `api-gateway` CI is not the gate. */
export const isGateRun = (name: string) => /^shepherd-gate(-edited|-actions)?$/.test(name);

/** The gate's verdict when it covers the current head: reviewed there, or an approval kept over an identical diff. */
export const gateOnHead = (f: PrFacts) => (f.gate && (f.gate.kept || f.head.startsWith(f.gate.head)) ? f.gate : undefined);

export function prStatus(f: PrFacts): PrStatus {
  const running = f.runs.filter((r) => r.status !== "completed");
  // The gate's run fails on a refusal: its verdict, read from its review, speaks for it.
  const failed = f.runs.filter((r) => isRed(r) && !isGateRun(r.name));
  const onHead = gateOnHead(f);

  const lines = [
    `PR #${f.pr} on ${short(f.head)}  ${f.url}`,
    `gate      ${onHead ? `${onHead.verdict}${onHead.kept ? ` (kept from ${short(onHead.head)}: the PR's diff is unchanged)` : ""}` : f.gate ? `${f.gate.verdict} on ${short(f.gate.head)}, an older head` : "has not reviewed it"}`,
    `shepherd  ${f.shepherd ? `${f.shepherd.state}: ${f.shepherd.description}` : "has not run on this head"}`,
    `CI        ${f.runs.length ? f.runs.map((r) => `${r.name} ${r.status === "completed" ? r.conclusion : r.status}`).join(", ") : "no runs on this head"}`,
    ...(f.changesRequested.length ? [`reviews   changes requested by ${f.changesRequested.join(", ")}`] : []),
    ...(f.openThreads ? [`threads   ${f.openThreads} unresolved`] : []),
  ];

  const at = (stage: Stage, next: string): PrStatus => ({ stage, lines, next });

  if (f.state === "MERGED") return at("merged", "nothing: it is merged");

  if (f.state === "CLOSED") return at("closed", "nothing: it is closed");

  // What is running now comes first: a pending status only says shepherd is not done, not what it waits on.
  if (running.some((r) => isGateRun(r.name))) return at("reviewing", "wait: the gate is reviewing");

  if (running.length) return at("waiting for CI", `wait: ${running.map((r) => r.name).join(", ")} running`);

  // Then every current blocker, so an older success never reads as ready over a newer failure.
  if (failed.length) return at("needs you", `fix ${failed.map((r) => r.name).join(", ")}, or comment /shepherd to have shepherd try`);

  if (f.changesRequested.length) return at("needs you", `answer the review from ${f.changesRequested.join(", ")}`);

  if (onHead?.verdict === "ERROR") return at("needs you", "the gate could not review: open its run, then comment /gate");

  if (onHead?.verdict === "DISMISSED") return at("needs you", "the gate's approval was dismissed: comment /gate to review again");

  if (onHead && onHead.verdict !== "APPROVED") return at("needs you", "read the gate's review, then push a fix or comment /shepherd");

  if (f.shepherd?.state === "pending") return at("fixing", `wait: shepherd is working (${f.shepherd.description})`);

  if (f.shepherd?.state === "failure") return at("needs you", `${f.shepherd.description}; then comment /shepherd`);

  if (f.shepherd?.state === "error") return at("needs you", "shepherd stopped on an error: open its run in Actions, then comment /shepherd");

  if (f.openThreads) return at("needs you", `resolve the ${f.openThreads} open review thread${f.openThreads === 1 ? "" : "s"}, or comment /shepherd to have shepherd work through them`);

  if (!onHead) return at("reviewing", f.gate ? "wait for the gate to review the new head, or comment /gate" : "comment /shepherd to start, or /gate for a review only");

  return at("ready", "merge it");
}
