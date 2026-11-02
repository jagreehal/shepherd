// Another reviewer, scored on the same change: a case exported as a repository, its comments imported as a run.
import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EvalCase, exportCase, importRun, PostedComments, scoreRun } from "./eval.ts";

const dir = mkdtempSync(path.join(tmpdir(), "shepherd-eval-import-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const git = (...args: string[]) => execFileSync("git", ["-C", path.join(dir, "src"), "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

execFileSync("git", ["init", "-q", "-b", "main", path.join(dir, "src")]);

writeFileSync(path.join(dir, "src", "window.ts"), "export const lastN = (xs: number[], n: number) => xs.slice(-n);\n");

git("add", ".");

git("commit", "-qm", "base");

const base = git("rev-parse", "HEAD");

writeFileSync(path.join(dir, "src", "window.ts"), "export const lastN = (xs: number[], n: number) => {\n  const out = [];\n  for (let i = xs.length - n; i <= xs.length; i++) out.push(xs[i]);\n  return out;\n};\n");

git("commit", "-qam", "loop");

const head = git("rev-parse", "HEAD");

const c = EvalCase.parse({
  id: "loop-past-end",
  split: "dev",
  source: { repo: "src", base, head },
  bugs: [{ id: "past-end", claim: "reads xs[xs.length]", checked: "planted", at: [{ file: "window.ts", lines: [3, 3] }], match: ["<=", "past the end", "undefined"] }],
});

test("export writes the case as a repository: main at its base, pr at its head, checked out", () => {
  const { tree } = exportCase(c, dir, path.join(dir, "out"));
  const at = (ref: string) => execFileSync("git", ["-C", tree, "rev-parse", ref], { encoding: "utf8" }).trim();

  expect([at("main"), at("pr"), at("HEAD")]).toEqual([base, head, head]);
});

test("an outside reviewer's inline comments become a run, scored like shepherd's", () => {
  const comments = [
    { id: 1, path: "window.ts", line: 3, body: "`i <= xs.length` reads one past the end and pushes undefined.", user: { login: "other-bot[bot]" } },
    { id: 2, path: "window.ts", line: null, original_line: 1, body: "Consider a clearer name.", user: { login: "other-bot[bot]" } },
    // The author's reply and a human's comment are neither of them the reviewer's findings.
    { id: 3, path: "window.ts", line: 3, body: "Thanks, fixed.", user: { login: "author" }, in_reply_to_id: 1 },
    { id: 4, path: "window.ts", line: 2, body: "Should this be a slice?", user: { login: "teammate" } },
    { id: 5, path: "window.ts", line: 3, body: "Confirmed after the fix.", user: { login: "other-bot[bot]" }, in_reply_to_id: 1 },
  ];

  const run = importRun(c, PostedComments.parse(comments), { config: "other-bot", run: 0, login: "other-bot[bot]", cost_usd: 0.12, duration_ms: 40_000 });

  expect(run.findings.map((f) => [f.line, f.severity])).toEqual([[3, "MEDIUM"], [1, "MEDIUM"]]);
  expect(scoreRun(c, run)).toMatchObject({ found: ["past-end"], missed: [], false_positives: 1, actionable: 2 });
  // A comment without a body is not a finding: the import refuses rather than guess.
  expect(() => PostedComments.parse([{ path: "window.ts", line: 3, body: "", user: { login: "x" } }])).toThrow();
});
