// Stacks and wrong bases on a real git history shaped like the cases that motivated them: a feature branched
// from `release` and opened against `main`, and three PRs stacked into one base.
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stackedParent, type StackDeps, wrongBase } from "./stack.ts";

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
