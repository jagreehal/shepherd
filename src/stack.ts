// Stacked PRs and wrong bases, detected the way stamp detects them before it reviews. A PR's base...head
// diff is what lands when it merges, which is right for a lone PR and wrong for two common shapes: a PR stacked on another open PR into the same base (its diff
// carries the parent's change), and a PR branched from one long-lived branch but opened against another
// (its diff carries everything the two branches differ by). Everything here is git ancestry on immutable
// SHAs; nothing a PR author writes (body, title, "stacked on #n") is read.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";

export type StackDeps = {
  /** `git rev-list --topo-order <head> ^<base>`: this PR's commits, newest first. */
  commits: (head: string, base: string) => string[];
  /** How many of this PR's commits are not on `branch` (a remote-tracking ref). */
  notOn: (head: string, base: string, branch: string) => number;
  /** Remote branch names, `git ls-remote --heads origin`. */
  branches: () => string[];
  /** Fetch these branches into their remote-tracking refs. */
  fetch: (branches: string[]) => void;
};

export type WrongBase = { branch: string; on: number; total: number };

/**
 * The long-lived branch this PR's commits mostly already sit on, when that is not its base: it was branched
 * from there and opened against the wrong target. A branch holding every commit of the PR is not flagged
 * (a backport or a promotion PR), and neither is the PR's own head branch.
 */
export function wrongBase(pr: { headSha: string; baseSha: string; baseRef: string; headRef: string }, longLived: string[], deps: StackDeps): WrongBase | null {
  if (!longLived.length) return null;
  const candidates = deps.branches().filter((b) => b !== pr.baseRef && b !== pr.headRef && longLived.some((g) => path.matchesGlob(b, g)));

  if (!candidates.length) return null;
  const total = deps.commits(pr.headSha, pr.baseSha).length;

  if (total < 2) return null;
  deps.fetch(candidates);
  let worst: WrongBase | null = null;

  for (const branch of candidates) {
    const off = deps.notOn(pr.headSha, pr.baseSha, branch);
    const on = total - off;

    if (off > 0 && on * 2 > total && (!worst || on > worst.on)) worst = { branch, on, total };
  }

  return worst;
}

/**
 * The nearest open PR into the same base whose head is one of this PR's own commits: the parent this PR is
 * stacked on. Its head being in base..head is the whole test, so a PR already merged into the base, or one
 * that only shares history, never counts.
 */
export function stackedParent(pr: { number: number; headSha: string; baseSha: string }, open: { number: number; headRefOid: string }[], deps: Pick<StackDeps, "commits">): { parent: number; parentHead: string } | null {
  const others = open.filter((p) => p.number !== pr.number && p.headRefOid !== pr.headSha);

  if (!others.length) return null;
  const order = deps.commits(pr.headSha, pr.baseSha);
  let best: { parent: number; parentHead: string; at: number } | null = null;

  for (const p of others) {
    const at = order.indexOf(p.headRefOid);

    if (at >= 0 && (!best || at < best.at)) best = { parent: p.number, parentHead: p.headRefOid, at };
  }

  return best && { parent: best.parent, parentHead: best.parentHead };
}

// The same default stamp's policy carries: branches a PR is opened from and merged into, never feature branches.
export const LONG_LIVED = ["main", "master", "develop", "release", "release/*", "staging"];

const View = z.object({ number: z.number(), headRefName: z.string(), headRefOid: z.string(), baseRefName: z.string() });

const Open = z.array(z.object({ number: z.number(), headRefOid: z.string(), isCrossRepository: z.boolean() }));

export type Stack = {
  pr: number;
  head_sha: string;
  base_ref: string;
  /** Set when most of the PR's commits already sit on another long-lived branch: retarget it, review nothing. */
  wrong_base: WrongBase | null;
  /** The open PR this one is stacked on; review `range` instead of the whole PR. */
  parent: { number: number; head: string } | null;
  /** The git range to review: the delta over the parent, or base...head. */
  range: string;
};

/** Fetch what the checks need (the PR head, its base, full history), then run them against GitHub's open PRs. */
export function prStack(number: number, repoRoot: string): Stack {
  const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
  // Fetches authenticate through gh, since a CI checkout keeps no token for a private origin.
  const git = (...args: string[]) => run("git", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args);
  const view = View.parse(JSON.parse(run("gh", "pr", "view", String(number), "--json", "number,headRefName,headRefOid,baseRefName")));
  const baseRef = `refs/remotes/origin/${view.baseRefName}`;

  if (git("rev-parse", "--is-shallow-repository") === "true") git("fetch", "-q", "--unshallow", "origin");
  git("fetch", "-q", "origin", `refs/pull/${number}/head`, `+refs/heads/${view.baseRefName}:${baseRef}`);
  const baseSha = git("rev-parse", baseRef);

  const deps: StackDeps = {
    commits: (head, base) => git("rev-list", "--topo-order", head, `^${base}`).split("\n").filter(Boolean),
    notOn: (head, base, branch) => Number(git("rev-list", "--count", head, `^${base}`, `^refs/remotes/origin/${branch}`)),
    branches: () => git("ls-remote", "--heads", "origin").split("\n").flatMap((l) => l.split("\trefs/heads/")[1] ?? []),
    fetch: (branches) => void git("fetch", "-q", "origin", ...branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`)),
  };

  const pr = { number, headSha: view.headRefOid, baseSha, baseRef: view.baseRefName, headRef: view.headRefName };
  const wrong = wrongBase(pr, LONG_LIVED, deps);
  const open = wrong ? [] : Open.parse(JSON.parse(run("gh", "pr", "list", "--state", "open", "--base", view.baseRefName, "--limit", "100", "--json", "number,headRefOid,isCrossRepository"))).filter((p) => !p.isCrossRepository);
  const parent = stackedParent(pr, open, deps);

  return {
    pr: number,
    head_sha: view.headRefOid,
    base_ref: view.baseRefName,
    wrong_base: wrong,
    parent: parent && { number: parent.parent, head: parent.parentHead },
    range: `${parent?.parentHead ?? baseSha}...${view.headRefOid}`,
  };
}

export type Interdiff = {
  since: string;
  head: string;
  /** The PR's own change is the same as at `since`: only the base moved, or nothing did. */
  unchanged: boolean;
  /** Files whose part of the PR's change differs from what was reviewed at `since`. */
  files: string[];
  /** `git range-diff` of the two versions: a diff of the PR's diff, with base movement left out. */
  text: string;
  /** A plain diff of the two versions on one merge base, `+`/`-` meaning changed since `since`: the round's focus. `text` when the old version conflicts on the new base. */
  focus: string;
};

/**
 * How the PR's own change moved between two reviewed heads, free of whatever the base brought in between. Each
 * version is squashed onto its own merge base (`git commit-tree`, which writes an unreferenced commit and no ref),
 * the old one is replayed onto the new merge base (`replay`), and `git range-diff` compares the two squashes.
 * `git diff since..head` would carry every base commit merged since, and after a rebase it compares two unrelated
 * histories; this survives both, and a base edit beside the PR's lines is no change either.
 */
export function interdiff(since: string, head: string, base: string, git: (...args: string[]) => string, sinceBase?: string): Interdiff {
  const commit = (tree: string, parent: string) => git("-c", "user.name=shepherd", "-c", "user.email=shepherd@localhost", "commit-tree", tree, "-p", parent, "-m", "squash");

  const ancestor = (a: string, b: string) => {
    try {
      git("merge-base", "--is-ancestor", a, b);

      return true;
    } catch {
      return false;
    }
  };

  const squash = (sha: string, from?: string) => {
    const mb = from ?? git("merge-base", base, sha);

    return { mb, sq: commit(`${sha}^{tree}`, mb) };
  };

  const b = squash(head);
  // The base tip `since` was reviewed against, when it is still one of since's ancestors: a stacked parent force-pushed
  // since then is no longer an ancestor of the new head, and squashing over today's merge base would carry its old change.
  const a = replay(squash(since, sinceBase && ancestor(sinceBase, since) ? sinceBase : undefined), b.mb, git, commit);
  // --creation-factor=1000: the two squashes always pair, however much they differ. Git's default treats a heavily
  // rewritten one as a removed commit and an added one, and prints their subjects with no patch at all.
  const text = git("range-diff", "--no-color", "--creation-factor=1000", `${a.mb}..${a.sq}`, `${b.mb}..${b.sq}`);

  return { since, head, unchanged: /^\d+:\s+\S+ = /.test(text), files: rangeDiffFiles(text), text, focus: a.mb === b.mb ? git("diff", "--no-color", "--no-ext-diff", a.sq, b.sq) : text };
}

/**
 * The old version replayed onto the new merge base, so a base edit near the PR's lines does not reach the
 * comparison as changed context. `git merge-tree --merge-base` applies the old squash's change to the new base
 * without touching the index or worktree. When the base moved under the PR's own lines it conflicts, and the old
 * version stays where it was: that change needs a fresh look. Git before 2.40 lacks the flag, and falls back too.
 */
function replay(old: { mb: string; sq: string }, mb: string, git: (...args: string[]) => string, commit: (tree: string, parent: string) => string) {
  if (old.mb === mb) return old;

  try {
    return { mb, sq: commit(git("merge-tree", "--write-tree", `--merge-base=${old.mb}`, mb, old.sq), mb) };
  } catch {
    return old;
  }
}

/** range-diff's own sections, never files: the commit message and its metadata. */
const NOT_FILES = new Set(["Commit message", "Metadata"]);

/** A file as a range-diff header names it: `f.ts`, `f.ts (new)`, `old => new` (the path it has now). */
const headerFile = (v: string) => v.replace(/ \((?:new|deleted|mode change)[^)]*\)$/, "").split(" => ").at(-1)!;

/**
 * The files whose part of the PR's change differs between the two versions. The range-diff is read in order: an
 * inner file header (`## f.ts ##`, marked `-`/`+` when the header itself differs) or range-diff's own hunk line
 * (`@@ f.ts`, `@@ f.ts: <function>`) sets the current file, and a file counts only once a line under it differs
 * (a `-` or `+` in the outer column). A hunk line alone is context: it names where the hunk starts, which can be
 * the file before the one that changed.
 */
export function rangeDiffFiles(text: string): string[] {
  const lines = text.split("\n");
  // Paths a header names whole, so a hunk line `src/b: c.ts: fn` resolves to `src/b: c.ts`, not `src/b`.
  const known = lines.flatMap((l) => /^ {4}[-+ ]? ?## (.+) ##$/.exec(l)?.[1] ?? []).map(headerFile).sort((x, y) => y.length - x.length);
  const files = new Set<string>();
  let file: string | null = null;

  for (const l of lines) {
    const header = /^ {4}([-+ ]?) ?## (.+) ##$/.exec(l);
    const hunk = /^ {4}@@ (.+)$/.exec(l);

    if (header) {
      file = NOT_FILES.has(header[2]!) ? null : headerFile(header[2]!);

      if (file && header[1] !== " " && header[1] !== "") files.add(file); // the header itself differs: a new, removed or renamed file
    } else if (hunk) {
      const v = headerFile(hunk[1]!);

      file = NOT_FILES.has(v) ? null : (known.find((k) => v === k || v.startsWith(`${k}: `)) ?? v.split(": ")[0]!);
    } else if (file && /^ {4}[-+]/.test(l)) {
      files.add(file);
    }
  }

  return [...files];
}

/**
 * `interdiff` against origin/<base>, or against a commit when `base` is a SHA (a stacked PR's parent head),
 * fetching `since` when a force-push left it out of the local clone.
 */
export function prInterdiff(since: string, head: string, base: string, repoRoot: string, sinceBase?: string): Interdiff {
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...args], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();

  const has = (sha: string) => {
    try {
      git("cat-file", "-e", `${sha}^{commit}`);

      return true;
    } catch {
      return false;
    }
  };

  for (const sha of [since, sinceBase]) if (sha && !has(sha)) git("fetch", "-q", "origin", sha); // GitHub serves a force-pushed-away commit by SHA

  const sha = git("rev-parse", `${head}^{commit}`);

  if (/^[0-9a-f]{40}$/.test(base)) return interdiff(since, sha, base, git, sinceBase);
  git("fetch", "-q", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`);

  return interdiff(since, sha, `refs/remotes/origin/${base}`, git, sinceBase);
}
