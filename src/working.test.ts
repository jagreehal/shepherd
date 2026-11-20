import { describe, expect, test } from "bun:test";
import { AUTOMATED_HEADER, AUTOMATED_ICON, isAutomatedComment } from "../gate/src/github.ts";
import { DEFAULT_LOOK, isWorkingNote, showWorkingNote, WORKING_MARKER, workingNote } from "./working.ts";

const BOT = "github-actions[bot]";

const run = (id: string) => ({ id, url: `https://github.com/o/r/actions/runs/${id}` });

/** A PR's comments in memory, with the runs that have finished. */
function fakePR(comments: { id: number; user: { login: string }; body: string }[], finished: string[] = []) {
  let next = 100;

  return {
    comments,
    list: () => [...comments],
    post: (body: string) => {
      comments.push({ id: next, user: { login: BOT }, body });

      return next++;
    },
    edit: (id: number, body: string) => {
      comments.find((c) => c.id === id)!.body = body;
    },
    remove: (id: number) => {
      comments.splice(comments.findIndex((c) => c.id === id), 1);
    },
    finished: (id: string) => finished.includes(id),
  };
}

const note = (id: number, runId: string, login = BOT) => ({ id, user: { login }, body: workingNote("aaaaaaa", run(runId)) });

describe("the reviewing note", () => {
  test("names the head and the run, carries the header, and only the poster's marked comment counts as the note", () => {
    const body = workingNote("4db811220d2d", run("1"));

    expect(body.startsWith(WORKING_MARKER)).toBe(true);
    expect(body).toContain(`> ${AUTOMATED_ICON} Automated comment by **Shepherd swarm**`);
    expect(body).not.toContain("🤖 Automated");
    expect(body).toContain("`4db8112`");
    expect(body).toContain("(https://github.com/o/r/actions/runs/1)");
    expect(isAutomatedComment(body)).toBe(true);
    expect(isWorkingNote({ user: { login: BOT }, body })).toBe(true);
    expect(isWorkingNote({ user: { login: "sam" }, body })).toBe(false);
  });

  test("a repository's branding names the bot and replaces the mascot", () => {
    const body = workingNote("4db811220d2d", run("1"), { name: "Acme Review", header: `> ${AUTOMATED_ICON} Automated comment by **Acme Review swarm**, not written by a human`, image: "https://example.com/acme.png" });

    expect(body).toContain("**Acme Review is reviewing");
    expect(body).toContain('src="https://example.com/acme.png"');
    expect(body).toContain("**Acme Review swarm**");
  });

  test("a run posts its note, and refreshes it rather than posting twice", () => {
    const pr = fakePR([{ id: 1, user: { login: "sam" }, body: "please review" }]);
    const id = showWorkingNote(pr, run("7"), "aaaaaaa", DEFAULT_LOOK, BOT);

    expect(showWorkingNote(pr, run("7"), "bbbbbbb", DEFAULT_LOOK, BOT)).toBe(id);
    expect(pr.comments.filter((c) => isWorkingNote(c))).toHaveLength(1);
    expect(pr.comments.find((c) => c.id === id)!.body).toContain("`bbbbbbb`");
  });

  test("a newer run takes over notes of finished runs, and never deletes the note of a run still going", () => {
    const pr = fakePR([note(1, "5"), note(2, "6"), { id: 3, user: { login: BOT }, body: `${WORKING_MARKER}\nan older note, no run` }, note(4, "5", "sam")], ["5"]);
    const id = showWorkingNote(pr, run("7"), "aaaaaaa", { ...DEFAULT_LOOK, header: AUTOMATED_HEADER }, BOT);

    // Run 5 finished without deleting its note; run 6 is still going and keeps its own; sam's comment is not ours.
    expect(pr.comments.map((c) => c.id)).toEqual([2, 4, id]);
    expect(pr.comments.at(-1)!.body).toContain("**shepherd**");
  });

  test("an older run deleting its own note leaves the newer run's note alone", () => {
    const pr = fakePR([]);
    const older = showWorkingNote(pr, run("6"), "aaaaaaa", DEFAULT_LOOK, BOT);
    const newer = showWorkingNote(pr, run("7"), "bbbbbbb", DEFAULT_LOOK, BOT);

    pr.remove(older); // run 6's exit handler

    expect(pr.comments.map((c) => c.id)).toEqual([newer]);
  });
});

describe("an automated comment", () => {
  test("opens with the header, in today's icon form or the older 🤖 one, after hidden markers and a note line", () => {
    expect(isAutomatedComment(`${AUTOMATED_HEADER}\n\nfix it`)).toBe(true);
    expect(isAutomatedComment("> [!NOTE]\n> 🤖 Automated comment by **Shepherd swarm**, not written by a human")).toBe(true);
    expect(isAutomatedComment("<!-- shepherd-swarm-summary -->\n> [!NOTE]\n> 🤖 Automated comment by **Shepherd swarm**")).toBe(true);
  });

  test("a person quoting or mentioning the header is still a person", () => {
    expect(isAutomatedComment("I disagree with the bot. > 🤖 Automated comment by **shepherd**")).toBe(false);
    expect(isAutomatedComment("Replying to this:\n> 🤖 Automated comment by **shepherd**, not written by a human")).toBe(false);
    expect(isAutomatedComment("the Automated comment by shepherd was wrong")).toBe(false);
  });
});
