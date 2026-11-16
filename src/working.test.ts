import { describe, expect, test } from "bun:test";
import { isWorkingNote, WORKING_MARKER, workingNote } from "./working.ts";

describe("the reviewing note", () => {
  test("names the head and the run, carries the header, and only the bot's marked comment counts as the note", () => {
    const note = workingNote("4db811220d2d", "https://github.com/o/r/actions/runs/1");

    expect(note.startsWith(WORKING_MARKER)).toBe(true);
    expect(note).toContain("> 🤖 Automated comment by **Shepherd swarm**");
    expect(note).toContain("`4db8112`");
    expect(note).toContain("(https://github.com/o/r/actions/runs/1)");
    expect(isWorkingNote({ user: { login: "github-actions[bot]" }, body: note })).toBe(true);
    expect(isWorkingNote({ user: { login: "sam" }, body: note })).toBe(false);
  });

  test("a repository's branding names the bot and replaces the mascot", () => {
    const note = workingNote("4db811220d2d", "https://x/runs/1", { name: "Acme Review", header: "> 🤖 Automated comment by **Acme Review swarm**, not written by a human", image: "https://example.com/acme.png" });

    expect(note).toContain("**Acme Review is reviewing");
    expect(note).toContain('src="https://example.com/acme.png"');
    expect(note).toContain("**Acme Review swarm**");
    expect(note.startsWith(WORKING_MARKER)).toBe(true);
  });

});
