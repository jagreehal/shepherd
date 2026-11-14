/**
 * The PR's gate card: one issue comment, rewritten each run, with the latest verdict and two checkboxes. Ticking a
 * box edits the comment, and the `issue_comment: edited` event acts on it: "Review again" in shepherd-gate.yml's review job,
 * "Let shepherd fix it" in shepherd-gate-actions.yml. It is an issue comment because people with write access can tick a task
 * list there, and the tick fires that event.
 */
import type { Verdict } from "./github.ts";

export const CARD_MARKER = "<!-- gate-actions -->";

/** Opens every comment the gate posts, so triage and other gates read it as automated even when it posts through a person's account. */
export const AUTOMATED_HEADER = "> 🤖 Automated comment by **shepherd gate**, not written by a human";

export const ACTIONS = { rereview: "Review again", shepherd: "Let shepherd fix it" } as const;

export type Action = keyof typeof ACTIONS;

const ALL: Action[] = ["rereview", "shepherd"];

const box = (action: Action, ticked: boolean) => `- [${ticked ? "x" : " "}] <!-- gate-action:${action} --> ${ACTIONS[action]}`;

/** The card for one verdict. "Let shepherd fix it" is offered when the repository runs shepherd and gate did not approve. */
export function renderCard(args: { heading: string; verdict: Verdict; head: string; reviewId: number; shepherd: boolean }): string {
  const actions: Action[] = ["rereview", ...(args.shepherd && args.verdict !== "APPROVED" ? (["shepherd"] as const) : [])];

  return [CARD_MARKER, AUTOMATED_HEADER, "", `**${args.heading}** <sub>on <code>${args.head.slice(0, 7)}</code> · <a href="#pullrequestreview-${args.reviewId}">full review</a></sub>`, "", ...actions.map((a) => box(a, false))].join("\n");
}

/** The actions whose box the edit ticked: checked now, unchecked before. */
export function ticked(before: string, after: string): Action[] {
  return ALL.filter((a) => after.includes(box(a, true)) && before.includes(box(a, false)));
}
