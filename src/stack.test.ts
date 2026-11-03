// Stacks and wrong bases on a real git history shaped like the cases that motivated them: a feature branched
// from `release` and opened against `main`, and three PRs stacked into one base.
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { interdiff, rangeDiffFiles, stackedParent, type StackDeps, wrongBase } from "./stack.ts";

const dir = mkdtempSync(path.join(tmpdir(), "shepherd-stack-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const git = (...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

const commit = (name: string) => {
  writeFileSync(path.join(dir, name), name);
  git("add", name);
  git("commit", "-qm", name);

  return git("rev-parse", "HEAD");
};

git("init", "-q", "-b", "main");

const main = commit("base");

git("checkout", "-qb", "release");

for (let i = 0; i < 5; i++) commit(`release-${i}`);

git("checkout", "-qb", "fix"); // branched from release, opened against main

const fix = commit("fix");

git("checkout", "-q", "main");

git("checkout", "-qb", "a");

const a = commit("a"); // PR #1

git("checkout", "-qb", "b");

const b = commit("b"); // PR #2, stacked on #1

git("checkout", "-qb", "c");

const c = commit("c"); // PR #3, stacked on #2

// Local branches stand in for the fetched remote-tracking refs.
const deps: StackDeps = {
  commits: (head, base) => git("rev-list", "--topo-order", head, `^${base}`).split("\n").filter(Boolean),
  notOn: (head, base, branch) => Number(git("rev-list", "--count", head, `^${base}`, `^${branch}`)),
  branches: () => ["main", "release", "fix", "a", "b", "c", "feature-x"],
  fetch: () => {},
};

describe("wrong base", () => {
  test("a PR whose commits are mostly on another long-lived branch names it and the retarget command", () => {
    expect(wrongBase({ headSha: fix, baseSha: main, baseRef: "main", headRef: "fix" }, ["main", "release"], deps)).toEqual({ branch: "release", on: 5, total: 6 });
  });

  test("its own base, its head branch, a branch holding every commit, an empty list and a one-commit PR never flag", () => {
    expect(wrongBase({ headSha: fix, baseSha: main, baseRef: "main", headRef: "fix" }, [], deps)).toBeNull();
    expect(wrongBase({ headSha: fix, baseSha: main, baseRef: "release", headRef: "fix" }, ["release"], deps)).toBeNull();
    // A promotion PR, release into main: every commit is on release, which is its own head.
    expect(wrongBase({ headSha: git("rev-parse", "release"), baseSha: main, baseRef: "main", headRef: "release" }, ["release"], deps)).toBeNull();
    // A backport: the branch already holds all of it.
    expect(wrongBase({ headSha: git("rev-parse", "release"), baseSha: main, baseRef: "main", headRef: "hotfix" }, ["release"], deps)).toBeNull();
    expect(wrongBase({ headSha: a, baseSha: main, baseRef: "main", headRef: "a" }, ["main", "release"], deps)).toBeNull();
  });
});

describe("stacked parent", () => {
  const open = [{ number: 1, headRefOid: a }, { number: 2, headRefOid: b }, { number: 3, headRefOid: c }, { number: 9, headRefOid: fix }];

  test("the nearest open PR whose head is one of this PR's commits is the parent", () => {
    expect(stackedParent({ number: 3, headSha: c, baseSha: main }, open, deps)).toEqual({ parent: 2, parentHead: b });
    expect(stackedParent({ number: 2, headSha: b, baseSha: main }, open, deps)).toEqual({ parent: 1, parentHead: a });
  });

  test("the bottom of the stack, an unrelated PR, and a parent already in the base have none", () => {
    expect(stackedParent({ number: 1, headSha: a, baseSha: main }, open, deps)).toBeNull();
    expect(stackedParent({ number: 9, headSha: fix, baseSha: main }, open, deps)).toBeNull();
    // #1 merged: the base is its head, so #1's head is no longer one of #2's own commits.
    expect(stackedParent({ number: 2, headSha: b, baseSha: a }, open, deps)).toBeNull();
  });
});

describe("interdiff", () => {
  const rd = mkdtempSync(path.join(tmpdir(), "shepherd-interdiff-"));

  afterAll(() => rmSync(rd, { recursive: true, force: true }));
  const g = (...args: string[]) => git("-C", rd, ...args);

  const write = (name: string, text: string, message: string) => {
    writeFileSync(path.join(rd, name), text);
    g("add", name);
    g("commit", "-qm", message);

    return g("rev-parse", "HEAD");
  };

  g("init", "-q", "-b", "main");
  write("f.txt", "a\nb\n", "base");
  write("g.txt", "x\n", "base g");
  g("checkout", "-qb", "pr");
  write("f.txt", "a\nB\n", "one");
  const reviewed = write("h.txt", "new\n", "two");

  g("checkout", "-q", "main");
  write("g.txt", "x\ny\n", "base moves");
  g("checkout", "-q", "pr");

  test("a rebase onto a moved base is no change to review; an edit after it is, and only that file", () => {
    g("rebase", "-q", "main");
    const rebased = g("rev-parse", "HEAD");
    const same = interdiff(reviewed, rebased, "main", g);

    expect(same.unchanged).toBe(true);
    expect(same.files).toEqual([]);
    expect(same.focus).toBe("");

    const edited = write("h.txt", "new\nmore\n", "three");
    const moved = interdiff(reviewed, edited, "main", g);

    expect(moved.unchanged).toBe(false);
    // g.txt changed between the two heads, through the base only: `git diff reviewed..edited` would list it.
    expect(moved.files).toEqual(["h.txt"]);
    expect(moved.text).toContain("++more");
    // + means added since the reviewed head, with the file named above it.
    expect(moved.focus).toContain("+more");
    expect(moved.focus).not.toContain("++more");
    expect(moved.focus).toContain("h.txt");
    expect(g("diff", "--name-only", reviewed, edited).split("\n")).toContain("g.txt");

    // A line the old version left alone and this head deletes reads as a deletion.
    const trimmed = write("g.txt", "y\n", "drops a line the PR had not touched");
    const dropped = interdiff(edited, trimmed, "main", g);

    expect(dropped.focus).toContain("-x");
    expect(dropped.focus).not.toContain("+x");
  });

  test("a base edit beside the PR's lines, then a rebase, is no change; one under them is", () => {
    g("checkout", "-qb", "near", "main");
    write("n.ts", `${Array.from({ length: 30 }, (_, i) => i).join("\n")}\n`, "n base");
    g("checkout", "-qb", "near-pr");
    const before = write("n.ts", `${Array.from({ length: 30 }, (_, i) => (i === 15 ? "fifteen" : i)).join("\n")}\n`, "pr edits 15");

    g("checkout", "-q", "near");
    write("n.ts", `${Array.from({ length: 30 }, (_, i) => (i === 12 ? "twelve" : i)).join("\n")}\n`, "base edits 12");
    g("checkout", "-q", "near-pr");
    g("rebase", "-q", "near");
    const rebased = g("rev-parse", "HEAD");

    // Line 12 sits in the PR's hunk context, so without the replay the interdiff shows it as the focus.
    expect(interdiff(before, rebased, "near", g)).toMatchObject({ unchanged: true, files: [] });

    // The base rewrites the PR's own line: the replay conflicts and the change is reviewed.
    g("checkout", "-q", "near");
    write("n.ts", `${Array.from({ length: 30 }, (_, i) => (i === 12 ? "twelve" : i === 15 ? "FIFTEEN" : i)).join("\n")}\n`, "base edits 15");
    g("checkout", "-q", "near-pr");
    g("-c", "core.editor=true", "rebase", "-q", "-X", "theirs", "near");
    const resolved = g("rev-parse", "HEAD");

    expect(interdiff(before, resolved, "near", g).files).toEqual(["n.ts"]);
    g("checkout", "-q", "pr");
  });

  test("a stacked parent force-pushed under a reviewed child: the old parent tip keeps the parent's change out", () => {
    g("checkout", "-qb", "parent", "main");
    const p1 = write("p.ts", "parent v1\n", "parent");

    g("checkout", "-qb", "child");
    const c1 = write("c.ts", "child\n", "child");

    // The parent is amended and force-pushed; the child is restacked onto it, its own change untouched.
    g("checkout", "-q", "parent");
    g("reset", "-q", "--hard", "main");
    const p2 = write("p.ts", "parent v2\n", "parent, amended");

    g("checkout", "-q", "child");
    g("rebase", "-q", "--onto", p2, p1);
    const c2 = g("rev-parse", "HEAD");

    // Squashed over today's merge base, the old child carries parent v1, and the parent's change becomes the focus.
    expect(interdiff(c1, c2, p2, g).files).toContain("p.ts");
    // Squashed over the tip it was reviewed against, only the child's own change compares: unchanged.
    expect(interdiff(c1, c2, p2, g, p1)).toMatchObject({ unchanged: true, files: [] });
    // A tip that is not an ancestor of the reviewed head is ignored, never trusted.
    expect(interdiff(c1, c2, p2, g, p2).files).toContain("p.ts");
    g("checkout", "-q", "pr");
  });

  test("a one-line edit inside an unchanged file header still names its file", () => {
    const before = write("long.ts", `${Array.from({ length: 30 }, (_, i) => i).join("\n")}\n`, "long");
    const after = write("long.ts", `${Array.from({ length: 30 }, (_, i) => (i === 20 ? "twenty" : i)).join("\n")}\n`, "edit one line");
    const moved = interdiff(before, after, "main", g);

    expect(moved.unchanged).toBe(false);
    expect(moved.files).toEqual(["long.ts"]);
  });

  test("a PR rewritten beyond recognition still pairs, so the patch and its files come back", () => {
    g("checkout", "-qb", "rewrite", "main");
    const rewritten = write("other.ts", `${Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n")}\n`, "rewrite");
    const moved = interdiff(reviewed, rewritten, "main", g);

    expect(moved.unchanged).toBe(false);
    expect(moved.text).toContain("## other.ts (new) ##");
    expect([...moved.files].sort()).toEqual(["f.txt", "h.txt", "other.ts"]);
    g("checkout", "-q", "pr");
  });
});

describe("range-diff files", () => {
  test("file headers, renames, and range-diff's own @@ lines name files; its metadata sections do not", () => {
    const text = [
      "1:  985b4ee ! 1:  3e1f83c v",
      "    @@ Metadata",
      "      ## Commit message ##",
      "    - ## f.ts ##",
      "    + ## f.ts => g h.ts ##",
      "    + ## new.ts (new) ##",
      "    @@ src/a.ts: export function total",
      "    @@ src/b: c.ts: fn",
      "    @@ src/b: c.ts",
      "    +-20",
      "    ++twenty",
    ].join("\n");

    // src/a.ts is a hunk line with nothing changed under it: context, not a file that moved.
    expect(rangeDiffFiles(text)).toEqual(["f.ts", "g h.ts", "new.ts", "src/b"]);
    // A path holding ": " is read whole once a ## header names it.
    expect(rangeDiffFiles(`     ## src/b: c.ts ##\n${text}`)).toEqual(["f.ts", "g h.ts", "new.ts", "src/b: c.ts"]);
    // `@@ long.ts (new)`: range-diff copies the header's text into its own hunk line.
    expect(rangeDiffFiles("    @@ long.ts (new)\n      18\n    +-20\n    ++twenty")).toEqual(["long.ts"]);
  });
});
