// The gardener's evidence: what shepherd did on a repository's recent PRs, read from GitHub (the record,
// never a session), and scored by fixed signals. The `garden` skill turns the scores into skill edits and
// the recurring lens findings into lint-rule proposals.
import { execFileSync } from "node:child_process";
import { z } from "zod";

export const HEADER = "🤖 Automated comment by";

export type Thread = { tag: string; severity: string; path: string; resolved: boolean; humanReplied: boolean };

export type Commit = { sha: string; headline: string; skill: string | null; lens: string | null; fixes: string[]; date: string };

export type PrRecord = {
  number: number;
  title: string;
  state: string;
  threads: Thread[];
  commits: Commit[];
  status: { state: string; description: string; updatedAt: string } | null;
  rounds: number | null;
  /** The author can push to the repository. Only then do the PR's Shepherd-Fixes trailers count. */
  trusted: boolean;
};

const DAY = 864e5;

export type Signal = "reverted_fix" | "human_replied" | "round_cap" | "stopped_short" | "loop_stalled" | "churn";

const TAG = /\*\*\[(?:convergent: )?([^\]]+)\]\*\*\s*\S+\s*(CRITICAL|HIGH|MEDIUM|LOW|NIT)/;

const ROUND = /\(round (\d+) @/;

/** The lens rules in a finding's tag, `[convergent: a/b + c/d]` giving both. A bare lens name is no rule, and
 * `checks/*` already comes from a tool, so neither is a candidate for a new lint rule. */
const rulesOf = (tag: string) => tag.split(" + ").map((t) => t.trim()).filter((t) => t.includes("/") && !t.startsWith("checks/"));

const isReverted = (commit: Commit, commits: Commit[]) => commits.some((r) => r.headline === `Revert "${commit.headline}"`);

/** True when shepherd left any mark on the PR: a thread, a commit, a status, or a swarm summary. */
const touched = (pr: PrRecord) => pr.threads.length > 0 || pr.commits.some((c) => c.skill) || pr.status !== null || pr.rounds !== null;

/**
 * Fixed signals per PR shepherd touched, and the lens rules triage fixed (Shepherd-Fixes) on at least `minPrs` PRs. A reply is
 * only `human_replied`: whether it corrected shepherd is the gardener's reading. `loop_stalled` needs a day of
 * silence, so a run in flight never counts.
 */
export function score(all: PrRecord[], minPrs = 3, now = Date.now()) {
  const prs = all.filter(touched);

  const scored = prs.map((pr) => {
    const shepherdCommits = pr.commits.filter((c) => c.skill);
    const reverted = shepherdCommits.filter((c) => isReverted(c, pr.commits));
    const replied = pr.threads.filter((t) => t.humanReplied);
    const lastActivity = Math.max(Date.parse(pr.status?.updatedAt ?? "") || 0, ...shepherdCommits.map((c) => Date.parse(c.date) || 0));
    const final = pr.status?.state === "success" || pr.status?.state === "failure";
    const signals: Signal[] = [];

    if (reverted.length) signals.push("reverted_fix");

    if (replied.length) signals.push("human_replied");

    if ((pr.rounds ?? 0) >= 4) signals.push("round_cap");

    if (pr.status?.state === "failure") signals.push("stopped_short");

    if (shepherdCommits.length && !final && now - lastActivity > DAY) signals.push("loop_stalled");

    if (shepherdCommits.length > 10) signals.push("churn");

    return {
      number: pr.number,
      title: pr.title,
      signals,
      shepherdCommits: shepherdCommits.length,
      reverted: reverted.map((c) => ({ sha: c.sha, headline: c.headline, skill: c.skill, lens: c.lens })),
      replied: replied.map((t) => `${t.path} [${t.tag}]`),
      threads: { posted: pr.threads.length, open: pr.threads.filter((t) => !t.resolved).length },
      status: pr.status,
      rounds: pr.rounds,
    };
  });

  const byRule = new Map<string, { prs: Set<number>; paths: Set<string> }>();

  // Accepted means triage fixed it and said so in a Shepherd-Fixes trailer. Triage also resolves findings it
  // judged wrong, so a resolved thread proves nothing; and a thread a person argued in never counts.
  for (const pr of prs.filter((p) => p.trusted)) {
    const acceptedCommits = pr.commits.filter((c) => !isReverted(c, pr.commits));

    for (const rule of new Set(acceptedCommits.flatMap((c) => c.fixes).flatMap(rulesOf))) {
      const argued = pr.threads.some((t) => t.humanReplied && rulesOf(t.tag).includes(rule));

      if (argued) continue;
      const entry = byRule.get(rule) ?? { prs: new Set(), paths: new Set() };
      entry.prs.add(pr.number);

      for (const t of pr.threads.filter((x) => rulesOf(x.tag).includes(rule))) entry.paths.add(t.path);
      byRule.set(rule, entry);
    }
  }

  const recurring = [...byRule]
    .flatMap(([rule, e]) => (e.prs.size >= minPrs ? [{ rule, prs: [...e.prs].sort((a, b) => a - b), paths: [...e.paths].sort() }] : []))
    .sort((a, b) => b.prs.length - a.prs.length || a.rule.localeCompare(b.rule));

  return { prs: scored, recurring };
}

/** Parse one shepherd thread's first comment and its replies; null when the thread is not shepherd's. */
export function parseThread(path: string, resolved: boolean, comments: { author: string; bot: boolean; body: string }[]): Thread | null {
  const [first, ...replies] = comments;

  if (!first?.body.includes(HEADER)) return null;
  const m = TAG.exec(first.body);

  if (!m) return null;
  const humanReplied = replies.some((c) => !c.body.includes(HEADER) && !c.bot);

  return { tag: m[1]!, severity: m[2]!, path, resolved, humanReplied };
}

/** One commit's shepherd trailers, from its full message. */
export function parseCommit(sha: string, message: string, date = ""): Commit {
  const trailer = (key: string) => new RegExp(`^${key}: (\\S+)`, "m").exec(message)?.[1] ?? null;

  const fixes = [...message.matchAll(/^Shepherd-Fixes: (\S+)/gm)].map((m) => m[1]!);

  return { sha, headline: message.split("\n")[0] ?? "", skill: trailer("Shepherd"), lens: trailer("Shepherd-Lens"), fixes, date };
}

export const roundsOf = (summaryBody: string | undefined) => (summaryBody ? Number(ROUND.exec(summaryBody)?.[1] ?? 0) || null : null);

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }); // stderr rides on the thrown error

const PrList = z.array(z.object({ number: z.number(), title: z.string(), state: z.string(), headRefOid: z.string(), author: z.object({ login: z.string() }) }));

const Permission = z.object({ permission: z.string() });

const Threads = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          nodes: z.array(
            z.object({
              isResolved: z.boolean(),
              path: z.string(),
              comments: z.object({ nodes: z.array(z.object({ author: z.object({ login: z.string(), __typename: z.string() }).nullable(), body: z.string() })) }),
            }),
          ),
        }),
      }),
    }),
  }),
});

const Commits = z.array(z.object({ sha: z.string(), commit: z.object({ message: z.string(), committer: z.object({ date: z.string() }).nullable() }) }));

const Statuses = z.object({ statuses: z.array(z.object({ context: z.string(), state: z.string(), description: z.string().nullable(), updated_at: z.string() })) });

const Comments = z.array(z.object({ body: z.string() }));

/** Read shepherd's record on the PRs updated since `since` (YYYY-MM-DD). */
export function collect(repo: string, since: string): PrRecord[] {
  const [owner, name] = repo.split("/");
  const prs = PrList.parse(JSON.parse(gh(["pr", "list", "-R", repo, "--state", "all", "--search", `updated:>=${since}`, "--limit", "100", "--json", "number,title,state,headRefOid,author"])));
  const canPush = new Map<string, boolean>();

  const trusted = (login: string) => {
    if (!canPush.has(login)) {
      let permission = "none";

      try {
        permission = Permission.parse(JSON.parse(gh(["api", `repos/${repo}/collaborators/${login}/permission`]))).permission;
      } catch {
        // Not a collaborator, or the token cannot say: treat as untrusted.
      }

      canPush.set(login, ["admin", "maintain", "write"].includes(permission));
    }

    return canPush.get(login) === true;
  };

  return prs.map((pr) => {
    const query = "query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved path comments(first:50){nodes{author{login __typename} body}}}}}}}";

    const threads = Threads.parse(JSON.parse(gh(["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `n=${pr.number}`])))
      .data.repository.pullRequest.reviewThreads.nodes.flatMap((t) => parseThread(t.path, t.isResolved, t.comments.nodes.map((c) => ({ author: c.author?.login ?? "ghost", bot: c.author?.__typename === "Bot", body: c.body }))) ?? []);

    const commits = Commits.parse(JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr.number}/commits`])).flat()).map((c) => parseCommit(c.sha, c.commit.message, c.commit.committer?.date ?? ""));

    const status = Statuses.parse(JSON.parse(gh(["api", `repos/${repo}/commits/${pr.headRefOid}/status`]))).statuses.find((s) => s.context === "shepherd");
    const summary = Comments.parse(JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${pr.number}/comments`])).flat()).find((c) => c.body.includes("<!-- shepherd-swarm-summary -->"));

    return { number: pr.number, title: pr.title, state: pr.state, threads, commits, status: status ? { state: status.state, description: status.description ?? "", updatedAt: status.updated_at } : null, rounds: roundsOf(summary?.body), trusted: trusted(pr.author.login) };
  });
}
