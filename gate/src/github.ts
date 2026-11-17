// GitHub I/O through the `gh` CLI. Fetch on one side, post the verdict on the other.
// Every response is parsed against a schema at this boundary, so a shape change in the API
// fails here with a message, not three functions later as an undefined property.
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Anchored } from "./inline.ts";
import type { PRFile } from "./policy.ts";

/** Opens every comment shepherd posts, so triage and other reviewers read it as automated even when it posts through a person's account. */
export const AUTOMATED_HEADER = "> 🤖 Automated comment by **shepherd**, not written by a human";

// A hung call must fail rather than wait for the job to be killed: a killed run skips every catch,
// including the one that falls through to dismissing a stale approval.
const CALL_TIMEOUT_MS = 5 * 60_000;

let deadline: number | null = null;

/** Milliseconds the next gh or git call may take: the per-call cap, or what is left of an active budget. */
export function callTimeout(): number {
  if (deadline === null) return CALL_TIMEOUT_MS;
  const left = deadline - Date.now();

  if (left <= 0) throw Object.assign(new Error("time budget exhausted"), { code: "ETIMEDOUT" });

  return Math.min(left, CALL_TIMEOUT_MS);
}

/** A call killed by its timeout, or an exhausted budget. A catch that reads failure as "absent" must rethrow it. */
export const TimedOut = z.object({ code: z.literal("ETIMEDOUT") });

/** Run `fn` with every gh and git call inside it sharing one budget of `ms`. */
export function withBudget<T>(ms: number, fn: () => T): T {
  deadline = Date.now() + ms;

  try {
    return fn();
  } finally {
    deadline = null;
  }
}

/** Runs `fn`, and again after each delay while the error is `transient`. The last error propagates. */
export function retrying<T>(delays: number[], transient: (e: Error) => boolean, fn: () => T, wait: (ms: number) => void = Bun.sleepSync): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (e) {
      const delay = delays[attempt];

      if (delay === undefined || !(e instanceof Error) || !transient(e)) throw e;
      console.error(`retrying in ${delay}ms: ${e.message.split("\n").at(-2) ?? e.message}`);
      wait(delay);
    }
  }
}

/** A GitHub 5xx or a dropped connection. A 4xx is an answer, and a call killed by its timeout has used its time. */
export const transientGh = (e: Error) => /HTTP 5\d\d|ECONNRESET|connection reset|i\/o timeout|TLS handshake timeout|unexpected EOF/i.test(e.message);

// GitHub's generic 422 on `POST .../reviews`: it names no field, and the same request goes through on a retry.
export const transientReviewError = (e: Error) => /internal error occurred, please try again/i.test(e.message);

const READ_DELAYS_MS = [500, 2000];

const REVIEW_DELAYS_MS = [1000, 3000];

// A POST may already have landed, so it runs once. The other calls repeat safely.
const gh = (args: string[], cwd: string, input?: string) =>
  retrying(args.includes("POST") ? [] : READ_DELAYS_MS, transientGh, () => execFileSync("gh", args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, timeout: callTimeout(), input }));

const call = <T>(schema: z.ZodType<T>, args: string[], cwd: string, input?: string): T => schema.parse(JSON.parse(gh(args, cwd, input)));

const paginated = <T>(schema: z.ZodType<T>, endpoint: string, cwd: string): T[] =>
  z
    .array(z.array(schema))
    .parse(JSON.parse(gh(["api", "--paginate", "--slurp", endpoint], cwd)))
    .flat();

const Login = z.object({ login: z.string() });

// Only people who could merge anyway. A drive-by contributor's PR is never auto-approved.
export const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const MERGERS = new Set(["admin", "maintain", "write"]);

/** A user's effective permission on the repository, team grants included. */
export const permissionOf = (repo: string, login: string, cwd: string) => call(z.object({ permission: z.string() }), ["api", `repos/${repo}/collaborators/${login}/permission`], cwd).permission;

/**
 * author_association reads write access through a team, and a private org member, as CONTRIBUTOR. Someone the
 * permission API says can push counts as COLLABORATOR; a failed lookup keeps the association GitHub gave.
 */
export function effectiveAssociation(association: string, permission: () => string): string {
  if (TRUSTED_ASSOCIATIONS.has(association)) return association;

  try {
    return MERGERS.has(permission()) ? "COLLABORATOR" : association;
  } catch (e) {
    if (TimedOut.safeParse(e).success) throw e;

    return association;
  }
}

const CheckRuns = z.object({ check_runs: z.array(z.object({ name: z.string(), status: z.string() })) });

/** The check runs with one name on one commit, by name and status. */
export const checkRuns = (repo: string, sha: string, name: string, cwd: string) =>
  call(CheckRuns, ["api", `repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&per_page=100`], cwd).check_runs;

const RepoView = z.object({ nameWithOwner: z.string(), defaultBranchRef: z.object({ name: z.string() }) });

const Pull = z.object({
  title: z.string(),
  body: z.string().nullable(),
  user: Login,
  author_association: z.string(),
  draft: z.boolean(),
  mergeable_state: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  head: z.object({ ref: z.string().default(""), sha: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ ref: z.string(), sha: z.string(), repo: z.object({ full_name: z.string(), private: z.boolean().optional() }) }),
});

const File = z.object({ filename: z.string(), previous_filename: z.string().optional(), additions: z.number(), deletions: z.number(), status: z.string() });

const ReviewRow = z.object({ id: z.number(), user: Login, state: z.string(), body: z.string(), commit_id: z.string(), author_association: z.string().optional() });

/** One review thread as the threads query reads it. */
export const ThreadNode = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().nullable().default(null), // where it sits on the head; null once the code under it changed
  originalLine: z.number().nullable().default(null), // where it was posted
  comments: z.object({ totalCount: z.number(), nodes: z.array(z.object({ author: z.object({ login: z.string(), __typename: z.string() }).nullable(), body: z.string(), createdAt: z.string() })) }),
});

const ThreadPage = z.object({ data: z.object({ repository: z.object({ pullRequest: z.object({ reviewThreads: z.object({ nodes: z.array(ThreadNode) }) }) }) }) });

// REST lists inline comments without their thread's resolution, so threads come from GraphQL.
const THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated path line originalLine comments(first:50){totalCount nodes{author{login __typename} body createdAt}}}}}}}`;

const IssueNode = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  labels: z.object({ totalCount: z.number(), nodes: z.array(z.object({ name: z.string() })) }),
  repository: z.object({ nameWithOwner: z.string() }),
});

// `--paginate --slurp` returns every page of the query; the closing references are the paginated connection.
const IssuesPages = z.array(z.object({ data: z.object({ repository: z.object({ pullRequest: z.object({ closingIssuesReferences: z.object({ nodes: z.array(IssueNode) }) }) }) }) }));

// The issues the PR says it closes: the request the change claims to implement.
const ISSUES_QUERY = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:50,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{number title body labels(first:100){totalCount nodes{name}} repository{nameWithOwner}}}}}}`;

const CommitRow = z.object({ sha: z.string(), commit: z.object({ message: z.string() }) });

const CommentRow = z.object({ user: Login, body: z.string(), created_at: z.string(), reactions: z.record(z.string(), z.union([z.number(), z.string()])).optional() });

const ReactionRow = z.object({ user: Login, content: z.string(), created_at: z.string() });

export type Thread = z.infer<typeof ThreadPage>["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"][number];

/** Every review thread of a PR, from every page. */
export function reviewThreads(repo: string, number: number, cwd: string): Thread[] {
  const [owner = "", name = ""] = repo.split("/");

  return z
    .array(ThreadPage)
    .parse(JSON.parse(gh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${THREADS_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`], cwd)))
    .flatMap((p) => p.data.repository.pullRequest.reviewThreads.nodes);
}

// GraphQL names a bot account without the `[bot]` suffix REST uses; restore it so logins match everywhere.
const threadLogin = (c: Thread["comments"]["nodes"][number]) => (c.author ? `${c.author.login}${c.author.__typename === "Bot" ? "[bot]" : ""}` : "ghost");

export type Review = { user: string; state: string; body: string; commit: string; isCurrentHead: boolean };

/** One comment in a review thread; `thread` groups comments of the same thread. */
export type InlineComment = { user: string; path: string; body: string; outdated: boolean; resolved: boolean; thread: number; created: string };

export type Comment = { user: string; body: string; created: string; reactions: string[] };

export type PR = {
  /** owner/name, as fetchPR read it: every later call on this PR reuses it instead of asking again. */
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  authorAssociation: string;
  isFork: boolean;
  /** Set when anyone can read what gate posts here, so its reviews leave out exploit detail. */
  isPublic?: boolean;
  isDraft: boolean;
  mergeable: string;
  baseRef: string;
  headRef: string;
  defaultBranch: string;
  headSha: string;
  baseSha: string;
  labels: string[];
  files: PRFile[];
  reviews: Review[];
  inline: InlineComment[];
  discussion: Comment[];
  reactions: { user: string; content: string; created: string }[];
  commits: { sha: string; message: string }[];
  /** Issues the PR closes, from GitHub's closing references. Context, never assurance; an `incident` label only tightens the review. */
  issues?: LinkedIssue[];
  diff: string;
  /** Set when the review covers only this PR's change over an open stacked parent: files, commits and diff are that delta. */
  stack?: { parent: number; parentHead: string };
};

export type LinkedIssue = { ref: string; title: string; body: string; labels: string[] };

/**
 * The closing issues that live in the PR's own repository, from every page of the query. An issue elsewhere can be
 * private while the PR is public, and its text would reach the model, the evidence bundle and possibly the posted
 * review. An issue with more labels than the query returned gets its full list from `allLabels`: a label past the
 * first page (`incident`) can tighten the review, so it must not be dropped.
 */
export function sameRepoIssues(pages: z.infer<typeof IssuesPages>, repo: string, allLabels: (issue: number) => string[]): LinkedIssue[] {
  return pages
    .flatMap((p) => p.data.repository.pullRequest.closingIssuesReferences.nodes)
    .filter((i) => i.repository.nameWithOwner.toLowerCase() === repo.toLowerCase())
    .map((i) => ({
      ref: `#${i.number}`,
      title: i.title,
      body: i.body ?? "",
      labels: i.labels.totalCount > i.labels.nodes.length ? allLabels(i.number) : i.labels.nodes.map((l) => l.name),
    }));
}

/**
 * Closing issues for a PR. A failed fetch fails the run, like every other PR fetch: an `incident` label it would
 * have found tightens the review, so going on without it would fail open.
 */
function closingIssues(owner: string, name: string, number: number, cwd: string): LinkedIssue[] {
  const pages = IssuesPages.parse(JSON.parse(gh(["api", "graphql", "--paginate", "--slurp", "-f", `query=${ISSUES_QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`], cwd)));

  return sameRepoIssues(pages, `${owner}/${name}`, (issue) => paginated(z.object({ name: z.string() }), `repos/${owner}/${name}/issues/${issue}/labels`, cwd).map((l) => l.name));
}

export function repoSlug(cwd: string): string {
  return call(z.object({ nameWithOwner: z.string() }), ["repo", "view", "--json", "nameWithOwner"], cwd).nameWithOwner;
}

// GitHub's reaction rollup: counts keyed by emoji name, plus `url` and `total_count`.
const reactionList = (r: Record<string, number | string> | undefined) => {
  const out: string[] = [];

  for (const [k, v] of Object.entries(r ?? {})) if (k !== "total_count" && v !== 0 && Number.isInteger(v)) out.push(`${k}×${v}`);

  return out;
};

export function fetchPR(number: number, cwd: string, exclude: string[] = []): PR {
  const repo = call(RepoView, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], cwd);
  const base = `repos/${repo.nameWithOwner}`;
  const view = call(Pull, ["api", `${base}/pulls/${number}`], cwd);
  const headSha = view.head.sha;
  const notOurs = <T extends { user: { login: string } }>(rows: T[]) => rows.filter((r) => !exclude.includes(r.user.login));
  const [owner = "", name = ""] = repo.nameWithOwner.split("/");
  const threads = reviewThreads(repo.nameWithOwner, number, cwd);

  return {
    repo: repo.nameWithOwner,
    number,
    title: view.title,
    body: view.body ?? "",
    author: view.user.login,
    authorAssociation: effectiveAssociation(view.author_association, () => permissionOf(repo.nameWithOwner, view.user.login, cwd)),
    isFork: view.head.repo?.full_name !== view.base.repo.full_name,
    isPublic: view.base.repo.private === false,
    isDraft: view.draft,
    mergeable: view.mergeable_state === "dirty" ? "CONFLICTING" : "MERGEABLE",
    baseRef: view.base.ref,
    headRef: view.head.ref,
    defaultBranch: repo.defaultBranchRef.name,
    headSha,
    baseSha: view.base.sha,
    labels: view.labels.map((l) => l.name),
    files: paginated(File, `${base}/pulls/${number}/files`, cwd).map((f) => ({
      filename: f.filename,
      previousFilename: f.previous_filename, // a rename out of a sensitive path is still a change to it
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
    })),
    // Our own earlier verdicts describe an older snapshot and are never independent signal, whatever login posted them.
    reviews: notOurs(paginated(ReviewRow, `${base}/pulls/${number}/reviews`, cwd)).filter((r) => !RUN_MARKER.test(r.body)).map((r) => ({
      user: r.user.login,
      state: r.state,
      body: r.body,
      commit: r.commit_id,
      isCurrentHead: r.commit_id === headSha,
    })),
    inline: threads.flatMap((t, thread) =>
      t.comments.nodes
        .map((c) => ({ user: threadLogin(c), path: t.path, body: c.body, outdated: t.isOutdated, resolved: t.isResolved, thread, created: c.createdAt }))
        // Our own findings, whatever login posted them, as for reviews below: an App token's login is not `exclude`.
        .filter((c) => !exclude.includes(c.user) && !isOwnBot(c.user, c.body)),
    ),
    discussion: notOurs(paginated(CommentRow, `${base}/issues/${number}/comments`, cwd)).map((c) => ({
      user: c.user.login,
      body: c.body,
      created: c.created_at,
      reactions: reactionList(c.reactions),
    })),
    reactions: prReactions(base, number, cwd),
    commits: paginated(CommitRow, `${base}/pulls/${number}/commits`, cwd).map((c) => ({ sha: c.sha, message: c.commit.message })),
    issues: closingIssues(owner, name, number, cwd),
    diff: gh(["pr", "diff", String(number)], cwd),
  };
}

/**
 * The PR's reactions, read for reviewer bots still at work. The endpoint sits behind the `issues` permission, and
 * without it the only loss is not waiting for those bots, so a 403 warns and reads as none rather than failing the run.
 */
function prReactions(base: string, number: number, cwd: string): PR["reactions"] {
  try {
    return paginated(ReactionRow, `${base}/issues/${number}/reactions`, cwd).map((r) => ({ user: r.user.login, content: r.content, created: r.created_at }));
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("HTTP 403")) throw e;
    console.error("PR reactions unreadable (HTTP 403: grant the workflow `issues: read`); not waiting for reviewer bots");

    return [];
  }
}

const VERDICTS = ["APPROVED", "REFUSED", "ESCALATE", "ERROR"] as const;

export type Verdict = (typeof VERDICTS)[number];

/** True when the live PR still has the head, base ref and base sha that were reviewed. */
export function unchanged(pr: PR, cwd: string): boolean {
  const live = call(Pull, ["api", `repos/${pr.repo}/pulls/${pr.number}`], cwd);

  if (live.head.sha === pr.headSha && live.base.ref === pr.baseRef && live.base.sha === pr.baseSha) return true;

  console.log(`PR changed (head ${pr.headSha.slice(0, 7)}→${live.head.sha.slice(0, 7)}, base ${pr.baseRef}@${pr.baseSha.slice(0, 7)}→${live.base.ref}@${live.base.sha.slice(0, 7)})`);

  return false;
}

// Every posted review carries the ISO start time of the run that produced it, so concurrent runs
// can be ordered without shared state: the run that started later owns the newer verdict.
const RUN_MARKER = /<!-- gate-run:(\S+) -->/;

/**
 * Git config for a fetch that authenticates through gh (GH_TOKEN in CI), so the workflow can check out with
 * persist-credentials: false and no token sits in .git/config for a reviewer to read.
 */
export const GH_CREDENTIALS = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];

export const runMarker = (started: string) => `<!-- gate-run:${started} -->`;

/** Text with no HTML comment delimiter left, nested ones (`<!<!---->--`) included. */
export function withoutComments(text: string): string {
  let out = text;

  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(/<!--|-->/g, "");
  }

  return out;
}

// The full SHAs a review covered. Approval retention compares diffs on exactly these.
const REVIEWED_MARKER = /<!-- gate-reviewed:head=([0-9a-f]+);base=([0-9a-f]+) -->/;

export const reviewedMarker = (headSha: string, baseSha: string) => `<!-- gate-reviewed:head=${headSha};base=${baseSha} -->`;

export const listReviews = (repo: string, prNumber: number, cwd: string) => paginated(ReviewRow, `repos/${repo}/pulls/${prNumber}/reviews`, cwd);

export type ReviewRecord = z.infer<typeof ReviewRow>;

/**
 * Written on a verdict reached while policy asked for CI test evidence and the review did not read it
 * (pending, stale, missing or unreadable). Retention never keeps such an approval: the evidence may have
 * landed since, and a byte-identical diff says nothing about it.
 */
export const EVIDENCE_UNSEEN_MARKER = "<!-- gate-evidence:unseen -->";

export const evidenceUnseen = (r: ReviewRecord) => r.body.includes(EVIDENCE_UNSEEN_MARKER);

/** The head and base one of our reviews covered, from its marker; null for a review posted before the marker existed. */
export function reviewedShas(r: ReviewRecord): { head: string; base: string } | null {
  // The last marker: gate writes it after the review text, so text above it cannot stand in for it.
  const m = [...r.body.matchAll(new RegExp(REVIEWED_MARKER, "g"))].at(-1);

  // SAFETY: both capture groups in REVIEWED_MARKER are mandatory, so a match fills them.
  return m ? { head: m[1]!, base: m[2]! } : null;
}

/** The heading and first paragraph gate wrote on a review, folded or not. The model's text below them stays out. */
function opening(body: string) {
  const [heading = "", , first = ""] = (body.startsWith(SUPERSEDED) ? body.slice(body.indexOf("\n\n") + 2) : body).split("\n");

  return { heading, first };
}

/** An ERROR or a gate denial, which posts without a model reading the head. */
const unread = (body: string) => {
  const { heading, first } = opening(body);

  return /: ERROR\b/.test(heading) || /^(Gates denied|Not reviewed): /.test(first);
};

/** The head and base our newest completed review covered, or null when it covered `head`. */
export function lastReviewed(reviews: ReviewRecord[], botLogin: string, head: string) {
  const last = reviews.filter((r) => isOurs(r, botLogin) && !unread(r.body)).flatMap((r) => reviewedShas(r) ?? []).at(-1);

  return last && last.head !== head ? last : null;
}

/** How many earlier heads of this PR a model refused, a refusal the cap escalated included. A rerun on `head` adds none. */
export function refusedRounds(reviews: ReviewRecord[], botLogin: string, head: string): number {
  const wasRefused = (body: string) => /: REFUSED\b/.test(opening(body).heading) || /^Round \d+ on this PR/.test(opening(body).first);
  const refused = reviews.filter((r) => isOurs(r, botLogin) && wasRefused(r.body) && !unread(r.body));

  return new Set(refused.flatMap((r) => reviewedShas(r)?.head ?? []).filter((h) => h !== head)).size;
}

// Which head one of our reviews covered. GitHub moves a standing approval's `commit_id` forward when
// the branch is updated from its base, so `commit_id` can name a head the review never saw. Our own
// marker is the record; `commit_id` is the fallback only for reviews posted before the marker existed.
const reviewedHead = (r: ReviewRecord) => reviewedShas(r)?.head ?? r.commit_id;

/**
 * Whether `r` is one of our verdicts: posted by our login, or by any bot account and carrying our run
 * marker. A GitHub App token posts as `<app>[bot]` while `gh api user` fails, so the login alone can miss
 * our own approvals; the marker keeps them in every sweep.
 */
export const isOurs = (r: ReviewRecord, botLogin: string) => r.user.login === botLogin || isOwnBot(r.user.login, r.body);

const isOwnBot = (login: string, body: string) => login.endsWith("[bot]") && RUN_MARKER.test(body);

/**
 * The gate's latest verdict on a PR and the head it reviewed, for a reader that does not know the gate's login:
 * only a bot account's review carrying both markers counts, since a person can paste the heading. An approval
 * GitHub dismissed reads DISMISSED. A gate posting through a person's token is not recognised here.
 */
export function latestVerdict(reviews: ReviewRecord[]): { verdict: Verdict | "DISMISSED"; head: string; base: string; evidenceUnseen: boolean } | undefined {
  const r = reviews.filter((x) => isOwnBot(x.user.login, x.body) && reviewedShas(x)).at(-1);
  const heading = r && /^## .*?: (APPROVED|REFUSED|ESCALATE|ERROR)\b/.exec(r.body)?.[1];
  const v = VERDICTS.find((x) => x === heading);

  if (!r || !v) return undefined;

  const shas = reviewedShas(r);

  // An approval GitHub dismissed was a real APPROVE review: one posted as a comment cannot be dismissed.
  return { verdict: v === "APPROVED" && r.state === "DISMISSED" ? "DISMISSED" : v, head: shas?.head ?? r.commit_id, base: shas?.base ?? "", evidenceUnseen: evidenceUnseen(r) };
}

/** Whether the run that posted `r` started after `iso`: the later-started run owns the newer verdict. */
const startedAfter = (r: { body: string }, iso: string) => {
  // The last marker, as for the reviewed marker: gate writes it after the review text.
  const started = [...r.body.matchAll(new RegExp(RUN_MARKER, "g"))].at(-1)?.[1];

  return started !== undefined && started > iso;
};

const Compare = z.object({ files: z.array(File).default([]), commits: z.array(CommitRow) });

/**
 * The files and commits of from...to, through the compare API, with its unified diff. The API lists at most 300
 * files, so a fuller list is null: the caller reviews the whole PR instead.
 */
export function compareDelta(repo: string, from: string, to: string, cwd: string): Pick<PR, "files" | "commits" | "diff"> | null {
  const c = Compare.parse(JSON.parse(gh(["api", `repos/${repo}/compare/${from}...${to}`], cwd)));

  if (c.files.length >= 300) return null;

  return {
    files: c.files.map((f) => ({ filename: f.filename, previousFilename: f.previous_filename, additions: f.additions, deletions: f.deletions, status: f.status })),
    commits: c.commits.map((x) => ({ sha: x.sha, message: x.commit.message })),
    diff: compareDiff(repo, from, to, cwd),
  };
}

const OpenPR = z.object({ number: z.number(), headRefOid: z.string(), isCrossRepository: z.boolean() });

/** Open PRs into `base` whose head lives in this repository: the candidates for a stacked parent. */
export const openPRsInto = (base: string, cwd: string) =>
  call(z.array(OpenPR), ["pr", "list", "--state", "open", "--base", base, "--limit", "100", "--json", "number,headRefOid,isCrossRepository"], cwd).filter((p) => !p.isCrossRepository);

/** Unified diff of base...head on immutable SHAs, via the compare API. Throws on any gh failure. */
export const compareDiff = (repo: string, baseSha: string, headSha: string, cwd: string) =>
  gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/compare/${baseSha}...${headSha}`], cwd);

/** Numbers of up to 1000 PRs by `author` merged into `repo`. */
export const mergedPRNumbers = (repo: string, author: string, cwd: string) =>
  new Set(call(z.array(z.object({ number: z.number() })), ["pr", "list", "--repo", repo, "--author", author, "--state", "merged", "--limit", "1000", "--json", "number"], cwd).map((p) => p.number));

export type PostOptions = { cwd: string; botLogin: string; started: string; triggerLabel?: string };

/** True when a run that started after `started` has already posted a verdict of ours on this head. */
function newerVerdictExists(pr: PR, opts: PostOptions): boolean {
  const newer = listReviews(pr.repo, pr.number, opts.cwd).some(
    (r) => isOurs(r, opts.botLogin) && r.state !== "DISMISSED" && reviewedHead(r) === pr.headSha && startedAfter(r, opts.started),
  );

  if (newer) console.log("a newer gate run already posted on this head; this run's verdict is stale");

  return newer;
}

const SUPERSEDED = "<details><summary>Superseded: ";

/**
 * An older review of ours, folded under one line that names its verdict and links the latest. The body stays whole
 * inside, markers included, so retention and the sweeps read it exactly as before.
 */
export function supersededBody(r: ReviewRecord, latestId: number): string | null {
  if (r.body.startsWith(SUPERSEDED)) return null;

  const verdict = /: (APPROVED|REFUSED|ESCALATE|ERROR)\b/.exec(r.body.split("\n", 1)[0] ?? "")?.[1] ?? r.state.toLowerCase();
  // Its reason, so the fold says what the round raised without opening it. The body already made it inert.
  const why = clip(opening(r.body).first);

  return `${SUPERSEDED}shepherd ${verdict} on <code>${reviewedHead(r).slice(0, 7)}</code>${why ? ` — ${why}` : ""} · <a href="#pullrequestreview-${latestId}">latest review</a></summary>\n\n${r.body}\n\n</details>`;
}

/** One line of a review's reasoning, short enough to read in a fold or a list. */
const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text).replace(/[<>]/g, "");

/** An earlier review of ours: the head it read, its verdict and the first line of its reasoning. */
export type Round = { head: string; verdict: "APPROVED" | "REFUSED" | "ESCALATE"; why: string };

/**
 * Our earlier reviews of this PR that a model read, oldest first: what each round raised, for the review's history. A
 * round is a head: a rerun replaces that head's earlier review, and reviews of `head` itself are this round, not history.
 */
export function priorRounds(reviews: ReviewRecord[], botLogin: string, head: string): Round[] {
  const byHead = new Map<string, Round>();

  for (const r of reviews) {
    const verdict = /: (APPROVED|REFUSED|ESCALATE)\b/.exec(opening(r.body).heading)?.[1];
    const read = reviewedShas(r)?.head;

    if (!isOurs(r, botLogin) || unread(r.body) || !verdict || !read || read === head) continue;

    byHead.delete(read); // re-inserted, so the head sits where its latest review does
    byHead.set(read, { head: read, verdict: z.enum(["APPROVED", "REFUSED", "ESCALATE"]).parse(verdict), why: clip(opening(r.body).first) });
  }

  return [...byHead.values()];
}

/**
 * The older reviews of ours to fold under `latestId`, by id; null when a run that started after `started` has posted,
 * since its verdict is the current one and this run must not fold it.
 */
export function foldTargets(reviews: ReviewRecord[], latestId: number, botLogin: string, started: string): number[] | null {
  const ours = reviews.filter((r) => r.id !== latestId && isOurs(r, botLogin));

  if (ours.some((r) => startedAfter(r, started))) return null;

  return ours.flatMap((r) => (supersededBody(r, latestId) ? [r.id] : []));
}

/**
 * Fold every older review of ours under the one just posted, so the PR reads one current verdict. Folds nothing
 * when a newer run has posted since: that run folds this one. Best effort.
 */
export function foldSuperseded(pr: PR, latestId: number, botLogin: string, started: string, cwd: string): void {
  const reviews = listReviews(pr.repo, pr.number, cwd);
  const targets = foldTargets(reviews, latestId, botLogin, started);

  for (const r of reviews.filter((x) => targets?.includes(x.id))) {
    gh(["api", "-X", "PUT", `repos/${pr.repo}/pulls/${pr.number}/reviews/${r.id}`, "-f", `body=${supersededBody(r, latestId)}`], cwd);
  }
}

/** The JSON gate posts for a review: pinned to the reviewed commit, credentials redacted, each anchored finding carrying the run marker. */
export function reviewPayload(headSha: string, verdict: Verdict, body: string, comments: Anchored[], started: string) {
  return {
    commit_id: headSha,
    // Never an APPROVE: the `shepherd` check carries the verdict, and a person approves the PR.
    event: "COMMENT",
    body: scrub(body),
    comments: comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: `${AUTOMATED_HEADER}\n\n${scrub(c.body)}\n\n${runMarker(started)}` })),
  };
}

/**
 * Approvals are real reviews (count toward branch protection); everything else is a comment. Never request-changes.
 * `comments` anchor findings to lines. On a 422 the review goes again without them: the body holds every finding.
 */
export function postVerdict(pr: PR, verdict: Verdict, body: string, opts: PostOptions, comments: Anchored[] = []): number | null {
  // The diff can change under a finished review two ways: a push moves the head, a retarget moves the
  // base without touching the head. Refuse to post over either; the next run reviews what is live.
  // A newer run may also have already ruled on this exact head; its verdict governs, not this one.
  if (!unchanged(pr, opts.cwd) || newerVerdictExists(pr, opts)) return null;

  // The review is pinned to the reviewed commit, so a push that lands between the check above and
  // this call cannot inherit the approval: GitHub records it against pr.headSha, not the live head.
  const submit = (anchored: Anchored[]) =>
    retrying(REVIEW_DELAYS_MS, transientReviewError, () =>
      call(z.object({ id: z.number() }), ["api", "-X", "POST", `repos/${pr.repo}/pulls/${pr.number}/reviews`, "--input", "-"], opts.cwd, JSON.stringify(reviewPayload(pr.headSha, verdict, body, anchored, opts.started))),
    );

  let posted: { id: number };

  try {
    posted = submit(comments);
  } catch (e) {
    if (!comments.length || !(e instanceof Error) || !e.message.includes("HTTP 422")) throw e;
    console.error(`GitHub refused the review's ${comments.length} inline comment(s); posting without them`);
    posted = submit([]);
  }

  // Substantive non-approvals strip the trigger label so a human takes over; ERROR keeps it so the next push retries.
  if (opts.triggerLabel && (verdict === "REFUSED" || verdict === "ESCALATE") && pr.labels.includes(opts.triggerLabel)) {
    execFileSync("gh", ["pr", "edit", String(pr.number), "--remove-label", opts.triggerLabel], { cwd: opts.cwd, stdio: "inherit", timeout: callTimeout() });
  }

  return posted.id;
}

/** How far apart, in lines, a finding and a thread can sit and still be the same place. */
const NEAR = 3;

/** What a review does with the PR's threads: the findings it posts, our threads it resolves, and what stays open. */
export type ThreadPlan = { post: Anchored[]; retire: string[]; open: number };

/**
 * Settles shepherd's own threads against this review. A thread of ours resolves once the code under or near it changed
 * since the last review (`changed`, the new-side lines that push touched): whatever the model raises there now posts
 * fresh, on the new code. On untouched code, a finding near an open thread of ours is that thread again: it posts
 * nothing new and the thread stays, so the model's rewording, or a change of verdict, never reposts it. `open` counts the threads left that are ours or that a person wrote in,
 * plus the ones this review posts; other tools' threads are theirs.
 */
export function planThreads(threads: Thread[], anchors: Anchored[], changed: Map<string, Set<number>> | null, botLogin: string): ThreadPlan {
  const ours = (t: Thread) => ownThread(t, botLogin);
  const person = (t: Thread) => t.comments.nodes.some((c) => c.author === null || c.author.__typename !== "Bot") || t.comments.totalCount > t.comments.nodes.length;
  const at = (t: Thread) => t.line ?? t.originalLine;
  const near = (t: Thread, path: string, line: number) => t.path === path && at(t) !== null && Math.abs(at(t)! - line) <= NEAR; // SAFETY: at(t) is checked non-null first
  const open = threads.filter((t) => !t.isResolved);
  const touched = (t: Thread) => t.isOutdated || (t.line !== null && [...(changed?.get(t.path) ?? [])].some((n) => Math.abs(n - t.line!) <= NEAR)); // SAFETY: t.line is checked non-null first
  const retire = open.flatMap((t) => (ours(t) && touched(t) ? [t.id] : []));
  const same = (t: Thread, a: Anchored) => ours(t) && !touched(t) && near(t, a.path, a.line);
  const post = anchors.filter((a) => !open.some((t) => same(t, a)));

  return { post, retire, open: open.filter((t) => !retire.includes(t.id) && (ours(t) || person(t))).length + post.length };
}

/** A thread only shepherd wrote in, read whole: the query reads 50 comments, so a longer one may hold anyone's reply. */
export const ownThread = (t: Thread, botLogin: string) =>
  t.comments.totalCount === t.comments.nodes.length && t.comments.nodes.length > 0 && t.comments.nodes.every((c) => threadLogin(c) === botLogin || isOwnBot(threadLogin(c), c.body));

/** Resolves a thread, after reading it again: anyone who replied since the plan was made keeps it open. */
export function resolveIfOurs(id: string, botLogin: string, cwd: string): boolean {
  const t = call(z.object({ data: z.object({ node: ThreadNode }) }), ["api", "graphql", "-f", "query=query($id:ID!){node(id:$id){... on PullRequestReviewThread{id isResolved isOutdated path line originalLine comments(first:50){totalCount nodes{author{login __typename} body createdAt}}}}}", "-f", `id=${id}`], cwd).data.node;

  if (t.isResolved) return true;

  if (!ownThread(t, botLogin)) return false;
  gh(["api", "graphql", "-f", "query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}", "-f", `id=${id}`], cwd);

  return true;
}

/** Deterministic redaction of anything that could be a credential before it reaches GitHub. */
export function scrub(text: string): string {
  const keys = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "AI_GATEWAY_API_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "TYPESAFE_API_KEY", "OTEL_EXPORTER_OTLP_HEADERS", "SHEPHERD_NOTIFY_WEBHOOK", "OPENAI_COMPATIBLE_API_KEY", "DEEPSEEK_API_KEY"];

  const values = keys.flatMap((k) => {
    const v = process.env[k];

    return v ? [v] : [];
  }).sort((a, b) => b.length - a.length);

  for (const v of values) text = text.split(v).join("[redacted]");

  return text.replace(/\b(sk-(?:ant-|proj-|svcacct-)?[\w-]{20,}|gsk_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted]");
}

type EvidenceValue = string | number | boolean | null | undefined | EvidenceValue[] | { [key: string]: EvidenceValue };

type EvidenceBundle = { [key: string]: EvidenceValue };

/** Redact string values before JSON escaping so evidence preserves its structure. */
export const scrubJson = (value: EvidenceBundle): string => JSON.stringify(value, (_k, v) => {
  const text = z.string().safeParse(v);

  return text.success ? scrub(text.data) : v;
}, 2);

export type Sweep = {
  /** The review this run just posted; never dismissed. */
  keep?: number | null;
  /** When set, an approval on the live head is dismissed only if its run started before this ISO time. */
  olderThan?: string;
};

/**
 * A gate approval must never stand over commits it didn't review. With no options (startup) every
 * active approval of ours goes: fresh judgment is pending and, if a later step crashes, the old
 * approval is already gone. With `olderThan` (terminal sweep) an approval pinned to the live head
 * survives if its run started after ours, because that run's verdict is the newer one; everything
 * off-head or older is dismissed. Needs only the PR number, so it can run before any fallible fetch.
 */
export function dismissOwnApprovals(prNumber: number, botLogin: string, cwd: string, sweep: Sweep = {}): void {
  const repo = repoSlug(cwd);
  const liveHead = sweep.olderThan ? call(Pull, ["api", `repos/${repo}/pulls/${prNumber}`], cwd).head.sha : null;

  for (const id of sweepTargets(listReviews(repo, prNumber, cwd), botLogin, liveHead, sweep)) {
    gh(["api", "-X", "PUT", `repos/${repo}/pulls/${prNumber}/reviews/${id}/dismissals`, "-f", "message=Superseded by a newer gate run"], cwd);
  }
}

/** The approvals of ours a sweep dismisses, by id; `liveHead` is read only for the terminal sweep. */
export function sweepTargets(reviews: ReviewRecord[], botLogin: string, liveHead: string | null, sweep: Sweep = {}): number[] {
  return reviews.flatMap((r) => {
    if (!isOurs(r, botLogin) || r.state !== "APPROVED" || r.id === sweep.keep) return [];

    if (sweep.olderThan && reviewedHead(r) === liveHead && startedAfter(r, sweep.olderThan)) return []; // a newer run's approval of this same head

    return [r.id];
  });
}

/**
 * After posting, re-verify the PR is still what was reviewed and that no newer run ruled on this head
 * in the meantime; if either fails, the review just posted is an orphan. An orphaned approval MUST
 * come down, so a failed dismissal propagates and fails the run loudly: a silent 503 here would leave
 * an approval standing over code nobody reviewed. A comment cannot be dismissed on GitHub and grants
 * nothing, so a stale one is logged and left.
 */
/** Returns true when the verdict just posted is still current; false when it went stale (and an approval was dismissed). */
export function reconcilePosted(pr: PR, opts: PostOptions): boolean {
  if (unchanged(pr, opts.cwd) && !newerVerdictExists(pr, opts)) return true;
  console.log("the review just posted is stale; it is a comment, grants nothing, and stays");

  return false;
}

/** The `shepherd` commit status: the verdict on a head, which a branch rule can require. */
export type Check = { state: "success" | "failure" | "pending" | "error"; description: string };

export function setCheck(repo: string, sha: string, check: Check, cwd: string): void {
  gh(["api", `repos/${repo}/statuses/${sha}`, "-f", "context=shepherd", "-f", `state=${check.state}`, "-f", `description=${check.description.split(/\s+/).join(" ").slice(0, 139)}`], cwd);
}

/**
 * The check for a posted verdict. An approval is `success` only while no thread stays open that is shepherd's or that
 * a person wrote in; every other verdict says what the author does next.
 */
/** How the check opens on an escalation. The workflow's decide job matches it, so it is a contract: a test pins both. */
export const PERSON_DECIDES = "a person decides";

export function checkFor(verdict: Verdict, reason: string, open: number): Check {
  const why = reason.split("\n").find((l) => l.trim()) ?? "";

  if (verdict === "APPROVED") return open ? { state: "failure", description: `approved; ${open} open thread(s) to resolve` } : { state: "success", description: "approved; no open thread" };

  if (verdict === "REFUSED") return { state: "failure", description: `changes needed: ${why}` };

  if (verdict === "ESCALATE") return { state: "failure", description: `${PERSON_DECIDES}: ${why}` };

  return { state: "error", description: "the review did not finish; comment /review to run it again" };
}
