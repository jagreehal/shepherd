import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDemo, captureChange, changedRanges, demoBugs, finish, receiptStatus, ReviewRecord, unquotePath, type LocalChange } from "./local.ts";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const demo = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "shepherd-local-test-"));

  dirs.push(dir);

  return buildDemo(dir);
};

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

const overlaps = (change: LocalChange, file: string, [start, end]: [number, number]) => change.ranges.some((r) => r.file === file && r.start <= end && r.end >= start);

/** A record a full swarm run would write: every stage ok, the router on the full change. */
const fullReview = (change: LocalChange, findings: ReviewRecord["findings"] = []): ReviewRecord => ({
  fingerprint: change.fingerprint,
  stages: [
    { stage: "checks", status: "ok" },
    { stage: "router", status: "ok" },
    { stage: "verify", status: "ok" },
  ],
  lenses: [{ lens: "router", status: "ok", scope: "full" }],
  candidates: [],
  findings,
});

describe("local change capture", () => {
  test("an unpushed commit, a staged edit, an unstaged edit, an untracked file and a deletion all reach the change", () => {
    const app = demo();
    const before = git(app, "status", "--porcelain");
    const change = captureChange(app);

    expect(change.base_ref).toBe("origin/main");
    expect(change.files).toEqual(["src/config.ts", "src/notes.ts", "src/search.ts", "src/users.ts"]);

    for (const bug of demoBugs()) expect({ bug: bug.id, inChange: overlaps(change, bug.file, bug.lines) }).toEqual({ bug: bug.id, inChange: true });
    // The developer's index is untouched: the untracked file is still untracked, the staged edit still staged.
    expect(git(app, "status", "--porcelain")).toBe(before);
    expect(readFileSync(change.patch_path, "utf8")).toContain("+++ b/src/search.ts");
  });

  test("a pure deletion counts as the lines on both sides of the gap", () => {
    const patch = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -12,2 +11,0 @@", "-  if (!ok) throw e;", "-"].join("\n");

    expect(changedRanges(patch)).toEqual([{ file: "x.ts", start: 11, end: 12 }]);
  });

  test("capture runs no filter the repository configures", () => {
    const app = demo();
    const marker = path.join(app, "..", "filter-ran");

    git(app, "config", "filter.evil.clean", `touch '${marker}'; cat`);
    git(app, "config", "filter.evil.process", `touch '${marker}'`);
    git(app, "config", "filter.evil.required", "true");
    writeFileSync(path.join(app, ".gitattributes"), "*.ts filter=evil\n");
    const change = captureChange(app);

    expect(existsSync(marker)).toBe(false);
    expect(change.files).toContain("src/search.ts");
  });

  test("a same-size edit inside the index's timestamp window is still captured", () => {
    const app = demo();
    const file = path.join(app, "src", "db.ts");
    const stamp = new Date("2026-01-01T00:00:00Z");

    // Same size, same mtime as the index entry, ctime ignored: only git's racy check can see the edit.
    git(app, "config", "core.trustctime", "false");
    utimesSync(file, stamp, stamp);

    // The demo's other edits make --refresh exit 1; it still refreshes db.ts's cached stat.
    try {
      git(app, "update-index", "-q", "--refresh");
    } catch {}

    writeFileSync(file, readFileSync(file, "utf8").replace("Row", "Rox"));
    utimesSync(file, stamp, stamp);
    utimesSync(path.join(app, ".git", "index"), stamp, stamp);

    expect(git(app, "diff", "--name-only")).toContain("src/db.ts");
    expect(captureChange(app).files).toContain("src/db.ts");
  });

  test("a deleted file's old lines are a range, marked deleted", () => {
    const patch = ["diff --git a/auth.ts b/auth.ts", "deleted file mode 100644", "--- a/auth.ts", "+++ /dev/null", "@@ -1,4 +0,0 @@", "-a", "-b", "-c", "-d"].join("\n");

    expect(changedRanges(patch)).toEqual([{ file: "auth.ts", start: 1, end: 4, deleted: true }]);
  });

  test("quoted and non-ASCII paths come back as the file's real name", () => {
    expect(unquotePath('"src/a\\"b\\\\c\\303\\251\\t.ts"')).toBe('src/a"b\\cé\t.ts');
    expect(unquotePath("src/plain.ts")).toBe("src/plain.ts");
    expect(unquotePath('"src/quote\\"😀.ts"')).toBe('src/quote"😀.ts');
    const app = demo();

    writeFileSync(path.join(app, "src", "café.ts"), "export const x = 1;\n");
    writeFileSync(path.join(app, "src", 'odd "name".ts'), "export const y = 2;\n");
    writeFileSync(path.join(app, "src", 'quote"😀.ts'), "export const z = 3;\n");
    const change = captureChange(app);

    expect(change.files).toContain("src/café.ts");
    expect(change.files).toContain('src/odd "name".ts');
    expect(change.ranges).toContainEqual({ file: "src/café.ts", start: 1, end: 1 });
    expect(change.ranges).toContainEqual({ file: 'src/odd "name".ts', start: 1, end: 1 });
    expect(change.ranges).toContainEqual({ file: 'src/quote"😀.ts', start: 1, end: 1 });
    const record = fullReview(change);

    record.lenses = [{ lens: "router", status: "ok", scope: change.files }];
    expect(finish(app, JSON.stringify(record)).status).toBe("complete");
  });

  test("the same content gives the same fingerprint; any edit changes it", () => {
    const app = demo();
    const first = captureChange(app).fingerprint;

    expect(captureChange(app).fingerprint).toBe(first);
    appendFileSync(path.join(app, "src", "search.ts"), "\n");
    expect(captureChange(app).fingerprint).not.toBe(first);
  });
});

describe("local review finish", () => {
  test("a complete review writes a receipt, and an edit after it invalidates the receipt", () => {
    const app = demo();
    const change = captureChange(app);

    expect(receiptStatus(app).status).toBe("none");
    const result = finish(app, JSON.stringify(fullReview(change, [{ file: "src/search.ts", line: 7, severity: "CRITICAL", lens: "security/sql-injection", body: "Bind term as a parameter." }])));

    expect(result).toMatchObject({ status: "complete", errors: [], missing: [], findings: { open: 1, by_severity: { CRITICAL: 1 } } });
    expect(receiptStatus(app)).toMatchObject({ status: "reviewed", findings: { open: 1 } });
    writeFileSync(path.join(app, "src", "config.ts"), 'export const paymentsKey = process.env.PAYMENTS_KEY ?? "";\n');
    expect(receiptStatus(app).status).toBe("changed");
  });

  test("a changed range no reviewer received, a lens that failed, or a moved change is incomplete", () => {
    const app = demo();
    const change = captureChange(app);
    const record = fullReview(change);

    record.lenses = [
      { lens: "router", status: "ok", scope: ["src/notes.ts", "src/search.ts", "src/users.ts"] },
      { lens: "security", status: "failed", scope: ["src/config.ts"] },
    ];
    const result = finish(app, JSON.stringify(record));

    expect(result.status).toBe("incomplete");
    expect(result.missing).toEqual(["lens security ended failed", "src/config.ts:2-2 reached no reviewer"]);
    expect(result.receipt).toBeNull();
    expect(finish(app, JSON.stringify({ ...fullReview(change), fingerprint: "stale" })).missing).toEqual(["the change moved during the review: capture it again and re-run"]);
  });

  test("deleting a whole file still needs a reviewer, and findings may cite its removed lines", () => {
    const app = demo();

    git(app, "rm", "-qf", "src/notes.ts");
    const change = captureChange(app);

    const record = fullReview(change, [
      { file: "src/notes.ts", line: 12, severity: "HIGH", lens: "security/authz", body: "The admin check goes with the file." },
      { file: "src/notes.ts", line: 99, severity: "LOW", lens: "correctness", body: "Past the end." },
    ]);

    expect(change.ranges).toContainEqual({ file: "src/notes.ts", start: 1, end: 15, deleted: true });
    record.lenses = [];
    const result = finish(app, JSON.stringify(record));

    expect(result.status).toBe("invalid");
    expect(result.errors).toEqual(["finding 1: src/notes.ts has 15 lines, not 99"]);
    expect(result.missing).toContain("src/notes.ts:1-15 reached no reviewer");
    record.findings.pop();
    record.lenses = [{ lens: "router", status: "ok", scope: "full" }];
    expect(finish(app, JSON.stringify(record)).status).toBe("complete");
  });

  test("a line range scope covers only the lines inside it", () => {
    const app = demo();
    const record = fullReview(captureChange(app));

    record.lenses = [{ lens: "router", status: "ok", scope: ["src/config.ts", "src/search.ts", "src/users.ts", "src/notes.ts:6-8"] }];
    expect(finish(app, JSON.stringify(record)).missing).toEqual(["src/notes.ts:13-14 reached no reviewer"]);
  });

  test("findings the change cannot hold, and scanner candidates without an outcome, are invalid", () => {
    const app = demo();
    const record = fullReview(captureChange(app), [{ file: "src/users.ts", line: 99, severity: "HIGH", lens: "correctness", body: "Off by one." }]);

    record.candidates = [
      { source: "checks/semgrep", file: "src/search.ts", line: 7, status: "raised" },
      { source: "checks/gitleaks", file: "src/config.ts", line: 2, status: "dropped" },
    ];
    record.stages[0] = { stage: "checks", status: "skipped" };
    const result = finish(app, JSON.stringify(record));

    expect(result.status).toBe("invalid");
    expect(result.errors).toEqual([
      "stage checks was skipped without a reason",
      "finding 0: src/users.ts has 8 lines, not 99",
      "candidate 0 (checks/semgrep src/search.ts:7) marked raised, but no finding is within 5 lines of it",
      "candidate 1 (checks/gitleaks src/config.ts:2) dropped without a reason",
    ]);
    expect(finish(app, JSON.stringify({ fingerprint: "x" })).status).toBe("invalid");
  });
});

test("the record swarm's local mode documents is the one finish parses", () => {
  const swarm = readFileSync(path.join(import.meta.dir, "..", "skills", "swarm", "SKILL.md"), "utf8");
  const record = [...swarm.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? "").find((b) => b.includes('"candidates"'));

  expect(ReviewRecord.safeParse(JSON.parse(record ?? "{}")).success).toBe(true);
});
