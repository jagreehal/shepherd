// Local review: capture what the developer changed before any PR exists, check a swarm review of it
// against that change, and keep a receipt tied to the exact content reviewed.
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

// Settings that would run user code or write inside `.git` during a read, off for every call. quotePath off
// keeps non-ASCII names readable; names with quotes, backslashes or control characters are still quoted.
const GIT_SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "gc.auto=0", "-c", "core.quotePath=false"];

const DIFF_FLAGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames"];

const RUN: ExecFileSyncOptionsWithStringEncoding = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 };

/**
 * A `.gitattributes` filter runs its configured clean, smudge or process command whenever git reads or writes
 * a working-tree file, so capture would execute repository-chosen code. Every driver in config gets empty
 * commands, which git skips, and loses `required`.
 */
function filtersOff(cwd: string): string[] {
  let names: string[] = [];

  try {
    names = execFileSync("git", ["config", "--null", "--name-only", "--get-regexp", "^filter\\..+\\.(clean|smudge|process|required)$"], { ...RUN, cwd }).split("\0");
  } catch {
    // git config exits 1 when nothing matches: no drivers to switch off.
  }

  const drivers = new Set(names.filter(Boolean).map((n) => n.slice("filter.".length, n.lastIndexOf("."))));

  return [...drivers].flatMap((d) => ["clean", "smudge", "process"].flatMap((k) => ["-c", `filter.${d}.${k}=`]).concat("-c", `filter.${d}.required=false`));
}

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv): string => execFileSync("git", [...GIT_SAFE, ...filtersOff(cwd), ...args], { ...RUN, cwd, env: { ...process.env, ...env } });

const gitOr = (cwd: string, args: string[]): string | null => {
  try {
    return git(cwd, args).trim() || null;
  } catch {
    return null;
  }
};

/**
 * A run of new-side lines the change touched. A deletion inside a file counts as the lines on either side of
 * it. A deleted file has no new side, so its range is its old lines, marked `deleted`.
 */
export type ChangedRange = { file: string; start: number; end: number; deleted?: true };

export type LocalChange = {
  base_ref: string;
  base_sha: string;
  head_sha: string | null;
  fingerprint: string;
  patch_path: string;
  files: string[];
  ranges: ChangedRange[];
};

/** Where shepherd keeps scratch and receipts: inside the git directory, never committed, the same path for every process. */
export const stateDir = (repoRoot: string): string => {
  const common = git(repoRoot, ["rev-parse", "--git-common-dir"]).trim();

  return path.join(path.resolve(repoRoot, common), "shepherd");
};

/**
 * The commit the change is measured from: an explicit base, else where this branch left its upstream,
 * else where it left the remote's default branch, else HEAD (uncommitted work only), else the empty tree.
 */
type Base = { ref: string; sha: string; head: string | null };

function resolveBase(repoRoot: string, base?: string): Base {
  const head = gitOr(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  const forkPoint = (ref: string) => (head ? gitOr(repoRoot, ["merge-base", "HEAD", ref]) : null);

  if (base) {
    const sha = gitOr(repoRoot, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${base}^{commit}`]);

    if (!sha) throw new Error(`base not found: ${base}`);

    return { ref: base, sha: forkPoint(sha) ?? sha, head };
  }

  if (!head) return { ref: "empty tree", sha: git(repoRoot, ["hash-object", "-t", "tree", "/dev/null"]).trim(), head };
  const remoteDefault = gitOr(repoRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);

  for (const ref of [gitOr(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]), remoteDefault, "origin/main", "origin/master"]) {
    const sha = ref ? forkPoint(ref) : null;

    if (ref && sha) return { ref, sha, head };
  }

  return { ref: "HEAD", sha: head, head };
}

const ESCAPES = "abtnvfr";

/** Undo git's C-style quoting of a path: `"caf\\303\\251.ts"` is `café.ts`. An unquoted path comes back as is. */
export function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];

  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i]!;

    if (c !== "\\") {
      // A whole code point: an emoji is two UTF-16 units that only encode together.
      const point = String.fromCodePoint(raw.codePointAt(i)!);

      bytes.push(...Buffer.from(point));
      i += point.length - 1;
      continue;
    }

    const next = raw[++i]!;

    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(raw.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(ESCAPES.includes(next) ? 7 + ESCAPES.indexOf(next) : next.charCodeAt(0));
  }

  return Buffer.from(bytes).toString("utf8");
}

/** The path in a `--- a/x` or `+++ b/x` header, or null for /dev/null. */
const headerPath = (line: string): string | null => {
  const raw = unquotePath(line.slice(4).replace(/\t$/, ""));

  return raw === "/dev/null" ? null : raw.slice(2);
};

/** Changed ranges from a zero-context patch: new-side lines, or old lines for a file the change deletes. */
export function changedRanges(patch: string): ChangedRange[] {
  const out: ChangedRange[] = [];
  let oldFile: string | null = null;
  let newFile: string | null = null;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) oldFile = newFile = null;
    else if (line.startsWith("--- ")) oldFile = headerPath(line);
    else if (line.startsWith("+++ ")) newFile = headerPath(line);
    else if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

      if (!m) continue;
      const count = (n: string | undefined) => (n === undefined ? 1 : Number(n));

      if (newFile === null && oldFile !== null) {
        out.push({ file: oldFile, start: Number(m[1]), end: Number(m[1]) + count(m[2]) - 1, deleted: true });
        continue;
      }

      if (newFile === null) continue;
      const start = Number(m[3]);
      const added = count(m[4]);

      // A pure deletion reports the line before it; the lines on both sides of the gap are what it changed.
      out.push(added === 0 ? { file: newFile, start: Math.max(start, 1), end: start + 1 } : { file: newFile, start, end: start + added - 1 });
    }
  }

  return out;
}

/**
 * Capture the change: commits not yet on the base, staged and unstaged edits, and untracked files that
 * .gitignore does not exclude. Untracked files enter through a copy of the index in a temp folder, so the
 * developer's own index is never touched.
 */
export function captureChange(repoRoot: string, base?: string): LocalChange {
  const { ref, sha, head } = resolveBase(repoRoot, base);
  const tmp = mkdtempSync(path.join(tmpdir(), "shepherd-index-"));
  const index = path.join(tmp, "index");

  try {
    const real = path.resolve(repoRoot, git(repoRoot, ["rev-parse", "--git-path", "index"]).trim());

    if (existsSync(real)) {
      copyFileSync(real, index);
      // Git treats a file whose mtime is not older than the index as possibly changed and compares its
      // content. A copy with a fresh mtime would hide same-size edits made within that window.
      const { atime, mtime } = statSync(real);

      utimesSync(index, atime, mtime);
    }

    const env = { GIT_INDEX_FILE: index, GIT_OPTIONAL_LOCKS: "0" };

    git(repoRoot, ["add", "--all", "--intent-to-add", "--", "."], env);
    const exact = git(repoRoot, [...DIFF_FLAGS, "-U0", sha], env);
    const patch = git(repoRoot, [...DIFF_FLAGS, sha], env);
    const fingerprint = createHash("sha256").update(`${sha}\n${exact}`).digest("hex");
    const dir = stateDir(repoRoot);

    mkdirSync(dir, { recursive: true });
    const patchPath = path.join(dir, `local-${fingerprint.slice(0, 12)}.patch`);

    writeFileSync(patchPath, patch);
    const ranges = changedRanges(exact);
    const files = git(repoRoot, [...DIFF_FLAGS, "--name-only", "-z", sha], env).split("\0").filter(Boolean);

    return { base_ref: ref, base_sha: sha, head_sha: head, fingerprint, patch_path: patchPath, files, ranges };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const Severity = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NIT"]);

const Status = z.enum(["ok", "failed", "could_not_run", "skipped"]);

/** What swarm writes at the end of a local review. Scopes are "full", "<path>", or "<path>:<start>-<end>". */
export const ReviewRecord = z.object({
  fingerprint: z.string(),
  stages: z.array(z.object({ stage: z.string(), status: Status, reason: z.string().optional() })),
  lenses: z.array(z.object({ lens: z.string(), status: Status, scope: z.union([z.literal("full"), z.array(z.string())]) })),
  candidates: z.array(z.object({ source: z.string(), file: z.string(), line: z.number().int(), status: z.enum(["raised", "dropped"]), reason: z.string().optional() })).default([]),
  findings: z.array(z.object({ file: z.string(), line: z.union([z.number().int().positive(), z.literal("general")]), severity: Severity, lens: z.string(), body: z.string().min(1) })),
});

export type ReviewRecord = z.infer<typeof ReviewRecord>;

export const REQUIRED_STAGES = ["checks", "router", "verify"];

export type FinishResult = {
  status: "complete" | "incomplete" | "invalid";
  fingerprint: string;
  errors: string[];
  missing: string[];
  findings: { open: number; by_severity: Record<string, number> };
  receipt: string | null;
};

const covers = (scope: "full" | string[], r: ChangedRange): boolean =>
  scope === "full" ||
  scope.some((s) => {
    const m = /^(.*):(\d+)-(\d+)$/.exec(s);

    if (!m) return s === r.file;

    return m[1] === r.file && Number(m[2]) <= r.start && Number(m[3]) >= r.end;
  });

const lineCount = (repoRoot: string, file: string): number | null => {
  const p = path.join(repoRoot, file);

  return existsSync(p) ? readFileSync(p, "utf8").replace(/\n$/, "").split("\n").length : null;
};

/**
 * Check a review record against the change on disk now. Invalid: a finding or candidate the change cannot
 * hold. Incomplete: a stage or lens did not finish, a changed range never reached a reviewer, or the change
 * moved during the review. Complete writes a receipt for this exact content. Delivery is checked, not
 * understanding.
 */
export function finish(repoRoot: string, recordJson: string, base?: string): FinishResult {
  const parsed = ReviewRecord.safeParse(JSON.parse(recordJson));
  const change = captureChange(repoRoot, base);
  const empty = { open: 0, by_severity: {} };

  if (!parsed.success) return { status: "invalid", fingerprint: change.fingerprint, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), missing: [], findings: empty, receipt: null };
  const record = parsed.data;
  const errors: string[] = [];
  const missing: string[] = [];

  if (record.fingerprint !== change.fingerprint) missing.push("the change moved during the review: capture it again and re-run");

  for (const stage of REQUIRED_STAGES) {
    const s = record.stages.find((x) => x.stage === stage);

    if (!s) missing.push(`stage ${stage} has no record`);
    else if (s.status === "skipped" && !s.reason) errors.push(`stage ${stage} was skipped without a reason`);
    else if (s.status !== "ok" && s.status !== "skipped") missing.push(`stage ${stage} ended ${s.status}`);
  }

  for (const l of record.lenses) if (l.status !== "ok") missing.push(`lens ${l.lens} ended ${l.status}`);
  const reviewed = record.lenses.filter((l) => l.status === "ok");

  for (const r of change.ranges) if (!reviewed.some((l) => covers(l.scope, r))) missing.push(`${r.file}:${r.start}-${r.end} reached no reviewer`);

  record.findings.forEach((f, i) => {
    if (f.line === "general") return;
    // A finding on a deleted file cites the removed content, so it is checked against the old lines.
    const removed = change.ranges.find((r) => r.deleted && r.file === f.file);
    const lines = removed ? removed.end : lineCount(repoRoot, f.file);

    if (lines === null) errors.push(`finding ${i}: ${f.file} does not exist`);
    else if (f.line > lines) errors.push(`finding ${i}: ${f.file} has ${lines} lines, not ${f.line}`);
  });

  record.candidates.forEach((c, i) => {
    if (c.status === "dropped" && !c.reason) errors.push(`candidate ${i} (${c.source} ${c.file}:${c.line}) dropped without a reason`);

    if (c.status === "raised" && !record.findings.some((f) => f.file === c.file && f.line !== "general" && Math.abs(f.line - c.line) <= 5)) {
      errors.push(`candidate ${i} (${c.source} ${c.file}:${c.line}) marked raised, but no finding is within 5 lines of it`);
    }
  });
  const bySeverity: Record<string, number> = {};

  for (const f of record.findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  const findings = { open: record.findings.length, by_severity: bySeverity };
  const status = errors.length ? "invalid" : missing.length ? "incomplete" : "complete";
  let receipt: string | null = null;

  if (status === "complete") {
    const dir = path.join(stateDir(repoRoot), "receipts");

    mkdirSync(dir, { recursive: true });
    receipt = path.join(dir, `${change.fingerprint}.json`);
    const body = JSON.stringify({ fingerprint: change.fingerprint, base_ref: change.base_ref, base_sha: change.base_sha, reviewed_at: new Date().toISOString(), findings }, null, 2);

    writeFileSync(receipt, body);
    writeFileSync(path.join(dir, "last.json"), body);
  }

  return { status, fingerprint: change.fingerprint, errors, missing, findings, receipt };
}

export type ReceiptStatus = { status: "reviewed" | "changed" | "none"; fingerprint: string; reviewed_at?: string; findings?: FinishResult["findings"] };

/** Is the change on disk now the one a complete local review covered? Any edit since makes it "changed". */
export function receiptStatus(repoRoot: string, base?: string): ReceiptStatus {
  const { fingerprint } = captureChange(repoRoot, base);
  const dir = path.join(stateDir(repoRoot), "receipts");
  const exact = path.join(dir, `${fingerprint}.json`);
  const read = (p: string) => z.object({ reviewed_at: z.string(), findings: z.object({ open: z.number(), by_severity: z.record(z.string(), z.number()) }) }).parse(JSON.parse(readFileSync(p, "utf8")));

  if (existsSync(exact)) return { status: "reviewed", fingerprint, ...read(exact) };

  if (existsSync(path.join(dir, "last.json"))) return { status: "changed", fingerprint, reviewed_at: read(path.join(dir, "last.json")).reviewed_at };

  return { status: "none", fingerprint };
}

const DEMO = path.resolve(import.meta.dir, "..", "examples", "local-demo");

export type DemoBug = { id: string; class: string; file: string; lines: [number, number]; enters_as: string };

export const demoBugs = (): DemoBug[] => JSON.parse(readFileSync(path.join(DEMO, "expected.json"), "utf8")).bugs;

const copyTree = (from: string, to: string) => {
  for (const rel of readdirSync(from, { recursive: true, withFileTypes: true })) {
    if (!rel.isFile()) continue;
    const src = path.join(rel.parentPath, rel.name);
    const dest = path.join(to, path.relative(from, src));

    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
};

/**
 * Build a demo repository under `dir`: a remote holding the baseline, and an `app` clone on a feature branch
 * whose change carries every planted bug, one per way a change reaches the review. Returns the clone's path.
 */
export function buildDemo(dir: string): string {
  const remote = path.join(dir, "remote.git");
  const app = path.join(dir, "app");
  const id = ["-c", "user.name=Shepherd demo", "-c", "user.email=demo@example.invalid", "-c", "commit.gpgsign=false"];

  git(dir, ["init", "-q", "--bare", "-b", "main", remote]);
  git(dir, ["clone", "-q", remote, app]);
  git(app, ["checkout", "-q", "-b", "main"]);
  copyTree(path.join(DEMO, "baseline"), app);
  git(app, ["add", "-A"]);
  git(app, [...id, "commit", "-q", "-m", "Notes service"]);
  git(app, ["push", "-q", "-u", "origin", "main"]);
  git(app, ["remote", "set-head", "origin", "main"]);
  git(app, ["checkout", "-q", "-b", "feature/notes"]);
  const planted = path.join(DEMO, "planted", "src");

  copyFileSync(path.join(planted, "users.ts"), path.join(app, "src", "users.ts"));
  git(app, [...id, "commit", "-q", "-am", "Page through users"]);
  copyFileSync(path.join(planted, "notes.ts"), path.join(app, "src", "notes.ts"));
  git(app, ["add", "src/notes.ts"]);
  const key = `sk_live_${randomBytes(18).toString("base64url").replace(/[-_]/g, "a").slice(0, 24)}`;

  writeFileSync(path.join(app, "src", "config.ts"), readFileSync(path.join(planted, "config.ts"), "utf8").replace("{{GENERATED_KEY}}", key));
  copyFileSync(path.join(planted, "search.ts"), path.join(app, "src", "search.ts"));

  return app;
}
