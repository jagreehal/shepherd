// The "shepherd is reviewing" note: one comment per run, posted as the review starts and deleted when the run ends,
// so the PR shows work in progress between the push and the verdict. It stays apart from the summary comment, whose
// update-in-place logic it must never confuse.

import { AUTOMATED_ICON, AUTOMATED_MARK, type IssueComments } from "../gate/src/github.ts";

export const WORKING_MARKER = "<!-- shepherd-working -->";

/** Which run a note belongs to: only that run edits or deletes it, so an older run never takes a newer run's note. */
const runMarker = (runId: string) => `<!-- shepherd-working-run:${runId} -->`;

const RUN_OF = /^<!-- shepherd-working-run:(\d+) -->$/m;

/** The animated mascot. A branch URL, so every release shows the same image. */
export const WORKING_IMAGE = "https://raw.githubusercontent.com/jagreehal/shepherd/main/assets/shepherd-reviewing.svg";

/** How the note looks: the repository's branding when it has one (`branding()` output, already escaped). */
export type WorkingLook = { name: string; header: string; image: string };

export const DEFAULT_LOOK: WorkingLook = { name: "shepherd", header: `> ${AUTOMATED_ICON} ${AUTOMATED_MARK} **Shepherd swarm**, not written by a human`, image: WORKING_IMAGE };

/** The Actions run this process belongs to: its id and the URL a reader follows. */
export type Run = { id: string; url: string };

export function workingNote(head: string, run: Run, look: WorkingLook = DEFAULT_LOOK): string {
  return [
    WORKING_MARKER,
    runMarker(run.id),
    look.header,
    "",
    `<img src="${look.image}" width="96" align="left" alt="">`,
    "",
    `**${look.name} is reviewing \`${head.slice(0, 7)}\`.** The summary replaces this note when the run ends.`,
    "",
    `[Follow the run](${run.url}) · \`shepherd status\` from a terminal`,
    '<br clear="left">',
  ].join("\n");
}

/** The note's comment among the PR's comments: the poster's own (the Actions bot unless named), carrying the marker. */
export const isWorkingNote = (c: { user: { login: string }; body: string }, login = "github-actions[bot]") => c.user.login === login && c.body.startsWith(WORKING_MARKER);

/**
 * Shows this run's note: refreshes the one it already posted, or posts one. Notes of runs that ended without deleting
 * theirs (a cancelled run skips its exit handler) are deleted; a note whose run is still going stays. Returns the id.
 */
export function showWorkingNote(api: IssueComments, run: Run, head: string, look: WorkingLook, login: string): number {
  const body = workingNote(head, run, look);
  const notes = api.list().filter((c) => isWorkingNote(c, login));
  const own = notes.find((c) => RUN_OF.exec(c.body)?.[1] === run.id);

  for (const c of notes) {
    const of = RUN_OF.exec(c.body)?.[1];

    if (c !== own && (!of || api.finished(of))) api.remove(c.id);
  }

  if (!own) return api.post(body);

  api.edit(own.id, body);

  return own.id;
}
