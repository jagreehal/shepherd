// The "shepherd is reviewing" note: one comment the iteration posts as it starts and the finalizer deletes, so the
// PR shows work in progress between the push and the summary. It stays apart from the summary comment, whose
// update-in-place logic it must never confuse.

export const WORKING_MARKER = "<!-- shepherd-working -->";

/** The animated mascot. A branch URL, so every release shows the same image. */
export const WORKING_IMAGE = "https://raw.githubusercontent.com/jagreehal/shepherd/main/assets/shepherd-reviewing.svg";

/** How the note looks: the repository's branding when it has one (`branding()` output, already escaped). */
export type WorkingLook = { name: string; header: string; image: string };

export const DEFAULT_LOOK: WorkingLook = { name: "shepherd", header: "> 🤖 Automated comment by **Shepherd swarm**, not written by a human", image: WORKING_IMAGE };

export function workingNote(head: string, runUrl: string, look: WorkingLook = DEFAULT_LOOK): string {
  return [
    WORKING_MARKER,
    look.header,
    "",
    `<img src="${look.image}" width="96" align="left" alt="">`,
    "",
    `**${look.name} is reviewing \`${head.slice(0, 7)}\`.** The summary replaces this note when the run ends.`,
    "",
    `[Follow the run](${runUrl}) · \`shepherd status\` from a terminal`,
    '<br clear="left">',
  ].join("\n");
}

/** The note's comment among the PR's comments: the bot's own, carrying the marker. */
export const isWorkingNote = (c: { user: { login: string }; body: string }) => c.user.login === "github-actions[bot]" && c.body.startsWith(WORKING_MARKER);
