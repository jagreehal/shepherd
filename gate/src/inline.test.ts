import { expect, test } from "bun:test";
import { anchoredIssues, commentableLines, inlineBody, issueAnchor } from "./inline.ts";

const diff = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,3 +10,4 @@ function a() {",
  " keep",
  "-gone",
  "+new one",
  "+++ an added line that reads like a header",
  " keep",
  "\\ No newline at end of file",
  "diff --git a/old.ts b/moved.ts",
  "similarity index 90%",
  "rename from old.ts",
  "rename to moved.ts",
  "--- a/old.ts",
  "+++ b/moved.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-z",
  "",
].join("\n");

test("a comment fits an added or context line inside a hunk, on the new side's numbering", () => {
  expect([...commentableLines(diff.split("diff --git a/old.ts")[0]!)]).toEqual([10, 11, 12, 13]);
  expect(commentableLines("diff --git a/x b/x\nBinary files differ\n").size).toBe(0);
});

test("the file:line an issue opens with, through the markup a model wraps it in", () => {
  expect(issueAnchor("src/a.ts:12 wrong total")).toEqual({ path: "src/a.ts", line: 12 });
  expect(issueAnchor("`src/a.ts:12`: wrong total")).toEqual({ path: "src/a.ts", line: 12 });
  expect(issueAnchor("**./src/a.ts:12-14** wrong total")).toEqual({ path: "src/a.ts", line: 12 });
  expect(issueAnchor("The total is wrong")).toBeNull();
  expect(issueAnchor("codex: src/a.ts:12 wrong")).toBeNull(); // a dissenter's issue stays in the body
});

test("only an issue on a commentable line is anchored: a rename by its new name, never a line outside a hunk or a deleted file", () => {
  const issues = ["src/a.ts:11 inside", "src/a.ts:9 before the hunk", "moved.ts:1 renamed", "old.ts:1 old name", "gone.ts:1 deleted", "nowhere.ts:1 not in the diff", "no anchor"];

  expect(anchoredIssues(issues, diff)).toEqual([
    { path: "src/a.ts", line: 11, body: "src/a.ts:11 inside" },
    { path: "moved.ts", line: 1, body: "moved.ts:1 renamed" },
  ]);
});

test("a line comment opens with its grade and a short title, and drops the file:line its anchor already shows", () => {
  const grade = "❌ **Blocks approval**";
  const same = (t: string) => t;

  expect(inlineBody("src/index.ts:34 - Removed zero-division check; divide(1,0) returns Infinity instead of throwing RangeError", grade, same)).toBe("❌ **Blocks approval** · **Removed zero-division check**\n\ndivide(1,0) returns Infinity instead of throwing RangeError");
  expect(inlineBody("`src/index.ts:35`: Removed division by zero check, breaking contract", grade, same)).toBe("❌ **Blocks approval** · **Removed division by zero check, breaking contract**");
  expect(inlineBody("**src/a.ts:12-14** wrong total. The sum skips the last row.", grade, same)).toBe("❌ **Blocks approval** · **wrong total**\n\nThe sum skips the last row.");

  // A spaced dash ends the title as a sentence break does; a hyphen inside a word does not.
  expect(inlineBody("Remove division-by-zero error – divide(1,0) now returns Infinity instead of throwing as documented and expected by tests; restore throw.", grade, same)).toBe("❌ **Blocks approval** · **Remove division-by-zero error**\n\ndivide(1,0) now returns Infinity instead of throwing as documented and expected by tests; restore throw.");
  expect(inlineBody("src/a.ts:3 unsafe without SAFETY comment - add one", grade, same)).toBe("❌ **Blocks approval** · **unsafe without SAFETY comment**\n\nadd one");

  // A first clause too long to scan still gets a title, its opening words, and the whole text stays below it.
  const long = `src/a.ts:1 ${"word ".repeat(30)}end`;
  const body = inlineBody(long, grade, same);

  expect(body).toStartWith("❌ **Blocks approval** · **word word");
  expect(body.split("\n")[0]!.length).toBeLessThan(130);
  expect(body).toContain("…**");
  expect(body).toEndWith(`\n\n${"word ".repeat(30)}end`);
  expect(inlineBody("src/a.ts:1 @team look; see <!-- x -->", grade, (t) => `[${t}]`)).toBe("❌ **Blocks approval** · **[@team look]**\n\n[see <!-- x -->]");
});
