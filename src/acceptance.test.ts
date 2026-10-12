// Fake agents on the demo repository: each breaks one rule of its fix mode, and the verdict must name it.
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { snapshot, verdict } from "./acceptance.ts";
import { buildDemo, captureChange, finish } from "./local.ts";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ID = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];

/** Run `agent` on a fresh demo repository under `mode`; return the verdict. */
function accept(mode: "suggest" | "local", agent: (repo: string) => void, threads: [string[], string[]] = [[], []], setup?: (repo: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "shepherd-accept-test-"));

  dirs.push(dir);
  const repo = buildDemo(dir);

  setup?.(repo);
  let call = 0;
  const pr = () => threads[call++] ?? [];
  const before = snapshot(repo, pr);

  agent(repo);

  return verdict(repo, mode, before, snapshot(repo, pr, before.targets));
}

const git = (repo: string, ...args: string[]) => execFileSync("git", [...ID, ...args], { cwd: repo, stdio: "ignore" });

const fix = (repo: string) => appendFileSync(path.join(repo, "src", "notes.ts"), "// fixed\n");

/** A complete local review of the tree as it is now: what `swarm --local` leaves behind. */
const review = (repo: string) => {
  const change = captureChange(repo);

  finish(repo, JSON.stringify({ fingerprint: change.fingerprint, stages: ["checks", "router", "verify"].map((stage) => ({ stage, status: "ok" })), lenses: [{ lens: "router", status: "ok", scope: "full" }], candidates: [], findings: [] }));
};

describe("review-only (suggest)", () => {
  test("a run that only reads passes", () => {
    expect(accept("suggest", () => {})).toEqual([]);
  }, 30_000);

  test("an edit, a commit, a push or a resolved thread each fail", () => {
    expect(accept("suggest", fix)).toEqual(["changed code under fixes.mode suggest"]);
    expect(accept("suggest", (r) => git(r, "commit", "-q", "--allow-empty", "-m", "x"))[0]).toStartWith("committed");
    expect(accept("suggest", (r) => git(r, "push", "-q", "origin", "HEAD:refs/heads/sneaky"))).toEqual(["pushed: a remote's refs changed"]);
    expect(accept("suggest", () => {}, [["T1"], ["T1", "T2"]])).toEqual(["resolved 1 thread(s): T2"]);
  }, 30_000);
});

describe("local-fix", () => {
  test("fixes left in the working tree, reviewed as left, pass", () => {
    expect(accept("local", (r) => (fix(r), review(r)))).toEqual([]);
  }, 30_000);

  test("a review before the last fix, no fix at all, a commit or a resolved thread each fail", () => {
    expect(accept("local", (r) => (review(r), fix(r)))).toEqual([expect.stringContaining("did not cover the uncommitted edits")]);
    expect(accept("local", () => {})).toEqual(["made no fixes in the working tree"]);
    expect(accept("local", (r) => (fix(r), git(r, "commit", "-qam", "fix"), fix(r), review(r)))[0]).toStartWith("committed");
    expect(accept("local", (r) => (fix(r), review(r)), [[], ["T9"]])).toEqual(["resolved 1 thread(s): T9"]);
  }, 30_000);
});

test("a snapshot runs no filter, hook or fsmonitor the repository configures", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shepherd-accept-test-"));

  dirs.push(dir);
  const repo = buildDemo(dir);
  const marker = path.join(dir, "ran");

  for (const [key, cmd] of [["filter.evil.clean", `touch ${marker}; cat`], ["core.fsmonitor", `touch ${marker}`]]) execFileSync("git", ["config", key!, cmd!], { cwd: repo });
  writeFileSync(path.join(repo, ".gitattributes"), "* filter=evil\n");
  writeFileSync(path.join(repo, "new.txt"), "x\n");
  snapshot(repo, () => []);

  expect(existsSync(marker)).toBe(false);
}, 30_000);

test("an edit to a tracked file that .gitignore matches is a change", () => {
  expect(accept("suggest", () => {}, undefined, (r) => {
    writeFileSync(path.join(r, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(r, "ignored.txt"), "v1\n");
    git(r, "add", "-f", ".gitignore", "ignored.txt");
    git(r, "commit", "-qm", "track an ignored file");
  })).toEqual([]);
  expect(accept("suggest", (r) => writeFileSync(path.join(r, "ignored.txt"), "v2\n"), undefined, (r) => {
    writeFileSync(path.join(r, ".gitignore"), "ignored.txt\n");
    writeFileSync(path.join(r, "ignored.txt"), "v1\n");
    git(r, "add", "-f", ".gitignore", "ignored.txt");
    git(r, "commit", "-qm", "track an ignored file");
  })).toEqual(["changed code under fixes.mode suggest"]);
}, 30_000);

test("an agent cannot hide an edit behind index flags or its own exclude rules", () => {
  const hideAndEdit = (flag: string) => (r: string) => {
    git(r, "update-index", flag, "src/notes.ts");
    fix(r);
  };

  expect(accept("suggest", hideAndEdit("--assume-unchanged"))).toEqual(["changed code under fixes.mode suggest"]);
  expect(accept("suggest", hideAndEdit("--skip-worktree"))).toEqual(["changed code under fixes.mode suggest"]);
  expect(accept("suggest", (r) => {
    appendFileSync(path.join(r, ".git", "info", "exclude"), "sneaky.ts\n");
    writeFileSync(path.join(r, "sneaky.ts"), "export {};\n");
  })).toEqual(["changed code under fixes.mode suggest"]);
}, 30_000);

test("rewriting a remote or hiding a directory behind a new .gitignore does not hide a push or a file", () => {
  // Push to the real remote, then point origin at a copy taken before the push.
  expect(accept("suggest", (r) => {
    const copy = path.join(path.dirname(r), "copy.git");

    execFileSync("git", ["clone", "-q", "--bare", path.join(path.dirname(r), "remote.git"), copy]);
    git(r, "push", "-q", "origin", "HEAD:refs/heads/sneaky");
    git(r, "remote", "set-url", "origin", copy);
  })).toEqual(["pushed: a remote's refs changed"]);
  expect(accept("suggest", (r) => {
    git(r, "config", "remote.origin.pushurl", path.join(path.dirname(r), "elsewhere.git"));
    git(r, "remote", "add", "other", path.join(path.dirname(r), "remote.git"));
    git(r, "push", "-q", "other", "HEAD:refs/heads/sneaky");
  })).toEqual(["pushed: a remote's refs changed"]);
  expect(accept("suggest", (r) => {
    mkdirSync(path.join(r, "hidden"));
    writeFileSync(path.join(r, "hidden", ".gitignore"), "*\n");
    writeFileSync(path.join(r, "hidden", "code.ts"), "export {};\n");
  })).toEqual(["changed code under fixes.mode suggest"]);
}, 30_000);
