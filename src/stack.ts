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
