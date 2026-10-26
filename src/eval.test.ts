import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type EvalCase, type EvalRun, loadCases, type ScoreRow, pick, prepare, runCase, scoreRun, scoreRuns } from "./eval.ts";

const CASE: EvalCase = {
  id: "two-bugs",
  split: "heldout",
  source: { repo: ".", base: "aaaaaaa", head: "bbbbbbb" },
  bugs: [
    { id: "off-by-one", claim: "", checked: "reproduced", at: [{ file: "a.ts", lines: [10, 12] }], match: ["off.by.one", "bound"] },
    { id: "unawaited", claim: "", checked: "reproduced", at: [{ file: "b.ts", lines: [5, 5] }, { file: "c.ts", lines: [1, 1] }], match: ["await"] },
  ],
  note: "",
};

const CLEAN: EvalCase = { ...CASE, id: "clean", bugs: [] };

const run = (findings: EvalRun["findings"], over: Partial<EvalRun> = {}): EvalRun => ({ case: CASE.id, config: "cheap", run: 0, shepherd: "", agent: [], started_at: "", duration_ms: 1000, cost_usd: 0.5, status: "complete", reason: "", findings, ...over });

const at = (file: string, line: number | "general", body = "x", severity: EvalRun["findings"][number]["severity"] = "HIGH") => ({ file, line, severity, lens: "correctness", body });

const OFF = "Off-by-one: the last page is skipped.";

const AWAIT = "The write is not awaited, so its failure is lost.";

describe("eval: review accuracy against checked bugs", () => {
  test("a finding counts once, and only when it sits near a bug and names it: a nearby complaint about something else is a false positive", () => {
    const s = scoreRun(CASE, run([at("a.ts", 9, OFF), at("a.ts", 14, OFF), at("c.ts", 1, AWAIT), at("a.ts", 40), at("a.ts", 11, "Rename `n` to `count`."), at("a.ts", "general", OFF), at("b.ts", 5, AWAIT, "NIT")]));

    expect(s).toEqual({ found: ["off-by-one", "unawaited"], missed: [], duplicates: 1, false_positives: 3, near_misses: 1, actionable: 6 });
    expect(scoreRun(CASE, run([at("a.ts", 16, OFF)])).missed).toEqual(["off-by-one", "unawaited"]); // past the slack
  });

  test("totals per configuration and split; a run that did not complete found nothing, and one label never mixes skill versions", () => {
    const runs = [
      run([at("a.ts", 10, OFF), at("b.ts", 5, AWAIT)]),
      run([at("a.ts", 10, OFF), at("z.ts", 1)], { run: 1, cost_usd: 1.5 }),
      run([], { run: 2, status: "incomplete" }),
      run([at("z.ts", 3)], { case: "clean" }),
      run([at("a.ts", 10, OFF), at("b.ts", 5, AWAIT)], { config: "strong", cost_usd: 4 }),
    ];

    const rows = scoreRuns([CASE, CLEAN], runs);
    const cheap = rows.find((r) => r.config === "cheap")!;

    expect(cheap).toMatchObject({ runs: 4, not_complete: 1, coverage: { "two-bugs": 3, clean: 1 }, recall: 3 / 6, precision: 3 / 5, false_positives: 2, cost_usd: 0.75 });
    // One unpriced run leaves the average unknown, so a cheap-looking configuration cannot win on cost.
    expect(scoreRuns([CASE], [run([], { cost_usd: 0.01 }), run([], { run: 1, cost_usd: null })])[0]!.cost_usd).toBeNull();
    expect(cheap.per_bug).toEqual({ "two-bugs/off-by-one": 2 / 3, "two-bugs/unawaited": 1 / 3 });
    expect(rows[0]!.config).toBe("strong"); // best recall first
    expect(() => scoreRuns([CLEAN], runs)).toThrow("run of two-bugs has no case");
    expect(() => scoreRuns([CASE], [run([]), run([], { run: 1, shepherd: "0.11.0@abc skills:def" })])).toThrow("config cheap mixes runs");
  });

  test("pick: the cheapest held-out configuration within noise of the best, only on the same complete work", () => {
    const row = (config: string, recall: number, precision: number, cost_usd: number | null, over: Partial<ScoreRow> = {}): ScoreRow => ({ config, split: "heldout", runs: 3, not_complete: 0, coverage: { a: 3 }, recall, precision, false_positives: 0, near_misses: 0, duplicates: 0, per_bug: {}, cost_usd, duration_ms: 1, ...over });

    expect(pick([row("opus", 0.9, 0.8, 5), row("sonnet", 0.87, 0.78, 1), row("haiku", 0.6, 0.5, 0.2)]).config).toBe("sonnet");
    expect(pick([row("opus", 0.9, 0.8, 5)]).config).toBeNull();
    expect(pick([row("opus", 0.9, 0.8, 5), row("sonnet", 0.9, 0.8, null)]).reason).toBe("sonnet has no cost or no score");
    expect(pick([row("opus", 0.9, 0.8, 5), row("sonnet", 0.9, 0.8, 1, { coverage: { a: 1 } })]).reason).toBe("opus and sonnet reviewed different cases or repeat counts");
    // A trade-off, each best on one score: no configuration is close on both, so none is picked.
    expect(pick([row("opus", 0.9, 0.5, 5), row("sonnet", 0.6, 0.9, 1)])).toEqual({ config: null, reason: "no configuration is within noise of the best on both recall and precision: the trade-off is a person's call" });

    // A cheap configuration that completed one case and failed the other never beats one that completed both.
    const other: EvalCase = { ...CASE, id: "other" };
    const rows = scoreRuns([CASE, other], [run([at("a.ts", 10, OFF), at("b.ts", 5, AWAIT)]), run([], { case: "other", status: "failed" }), ...[CASE, other].map((c) => run([at("a.ts", 10, OFF), at("b.ts", 5, AWAIT)], { case: c.id, config: "strong", cost_usd: 4 }))]);

    expect(pick(rows)).toEqual({ config: null, reason: "cheap has 1 incomplete run(s): rerun them before comparing" });
  });

  test("the shipped cases parse, ids are unique, and the demo case carries the demo's planted bugs", () => {
    const cases = loadCases(path.join(import.meta.dir, "..", "evals", "cases"));

    expect(cases.map((c) => c.split)).toContain("heldout");
    expect(cases.some((c) => !c.bugs.length)).toBe(true); // a clean change, so false positives are measured
    expect(cases.find((c) => c.id === "local-demo")!.bugs.map((b) => b.id)).toContain("sql-injection");
  });

  test("each shipped bug's patterns credit a finding that names the defect and no complaint about the code around it", () => {
    const cases = new Map(loadCases(path.join(import.meta.dir, "..", "evals", "cases")).flatMap((c) => c.bugs.map((b) => [b.id, { c, b }] as const)));

    const names = {
      "anchors-on-the-fix": ["Suggestion placement prefers nearby code that already contains the fix: it anchors the [0] replacement to line 5, leaving the bug unchanged.", ["Remove this comment; the loop already explains itself.", "Rename `best` to `bestWindow`."]],
      "id-only-link-check": ["Thread validation checks only the fragment's ID: with valid ID 42, a URL to other/repo/pull/999#discussion_r42 survives.", ["Extract this regex into a named constant.", "The gh call has no retry."]],
      "hardcoded-key": ["A live secret key is hardcoded in source; load it from configuration.", ["Rename `key` to `apiKey`."]],
      "page-offset": ["Off-by-one: pages start at 1, so the first page is skipped.", ["Name this page size constant."]],
      "unawaited-write": ["The write is not awaited, so a failure is lost.", ["Use `const` here."]],
      "swallowed-error": ["The empty catch swallows the error and saveNote reports success anyway.", ["Add a doc comment to saveNote."]],
      "removed-authz": ["The admin check was removed: any user can delete a note.", ["deleteNote could return the deleted id."]],
      "ts-ignore": ["@ts-ignore hides a string assigned to a number.", ["Sort these imports."]],
      "sql-injection": ["User input is interpolated into the SQL query: SQL injection. Use a parameterized query.", ["Format this query over several lines."]],
    } satisfies Record<string, [string, string[]]>;

    expect([...cases.keys()].sort()).toEqual(Object.keys(names).sort());

    for (const [id, [hit, decoys]] of Object.entries(names)) {
      const { c, b } = cases.get(id)!;
      const where = (body: string) => run([{ file: b.at[0]!.file, line: b.at[0]!.lines[0], severity: "HIGH", lens: "correctness", body }], { case: c.id });

      expect({ id, found: scoreRun(c, where(hit)).found }).toEqual({ id, found: [id] });

      for (const decoy of decoys) expect({ id, decoy, found: scoreRun(c, where(decoy)).found }).toEqual({ id, decoy, found: [] });
    }
  });

  test("a run reviews a fresh clone of the head and reads back the record the agent left", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-eval-test-"));
    const repo = path.join(dir, "origin");
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();

    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    g("add", "-A");
    g("commit", "-qm", "base");
    const base = g("rev-parse", "HEAD");

    writeFileSync(path.join(repo, "a.ts"), "export const a = 2;\n");
    g("commit", "-qam", "head");
    const head = g("rev-parse", "HEAD");
    const c: EvalCase = { ...CASE, source: { repo, base, head } };
    const record = JSON.stringify({ fingerprint: "stale", stages: [], lenses: [], findings: [at("a.ts", 1)] });
    const agent = ["sh", "-c", `test "$(git rev-parse HEAD)" = {head} && mkdir -p .git/shepherd && printf '%s' '${record}' > .git/shepherd/local-record.json && echo '{"total_cost_usd": 0.25}'`];

    const done = runCase(c, prepare(c, dir, mkdtempSync(path.join(dir, "run-"))), agent, { config: "x", run: 0, shepherd: "test" });

    expect(done).toMatchObject({ status: "incomplete", cost_usd: 0.25, findings: [at("a.ts", 1)] });
    expect(done.reason).toContain("the change moved during the review");
    expect(runCase(c, prepare(c, dir, mkdtempSync(path.join(dir, "run-"))), ["true"], { config: "x", run: 0, shepherd: "test" })).toMatchObject({ status: "failed", reason: "the agent left no local record" });
    // A record that is not JSON is kept as an invalid run; the batch goes on.
    expect(runCase(c, prepare(c, dir, mkdtempSync(path.join(dir, "run-"))), ["sh", "-c", "mkdir -p .git/shepherd && printf '{' > .git/shepherd/local-record.json"], { config: "x", run: 0, shepherd: "test" }).status).toBe("invalid");
  });
});
