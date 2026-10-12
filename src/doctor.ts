// `shepherd doctor`: is this machine and repository set up to run shepherd? Each check says what to do.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { defaultBranchReader, defaultBranchRef, fetchPackLenses, ghFetch, ghFetchDir, loadPolicy, type Config } from "./config.ts";
import { bundledSkills } from "./install.ts";
import { lensProblems } from "./lens.ts";

export type Check = { check: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

const run = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });

const attempt = <T>(f: () => T): T | Error => {
  try {
    return f();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};

// Where a harness looks for skills: Claude Code, the shared .agents layout, Codex, OpenCode.
const SKILL_DIRS = (home: string, repo: string) => [
  path.join(home, ".claude/skills"),
  path.join(repo, ".claude/skills"),
  path.join(home, ".agents/skills"),
  path.join(repo, ".agents/skills"),
  path.join(home, ".codex/skills"),
  path.join(home, ".config/opencode/skills"),
];

/**
 * True when a workflow runs stamp on pull requests: a step that uses stamp's action, runs its package, or
 * checks out its repository and then runs from that checkout. The word "stamp" alone is not enough.
 */
export function runsStamp(text: string): boolean {
  const parsed = Workflow.safeParse(attempt(() => parse(text)));

  if (!parsed.success) return false;

  if (!parsed.data.on.some((t) => t === "pull_request" || t === "pull_request_target")) return false;

  return Object.values(parsed.data.jobs).some(({ steps }) => {
    const checkouts = steps.filter((st) => st.with?.repository === "jagreehal/stamp").map((st) => st.with?.path ?? ".");

    return steps.some((st) => st.uses?.startsWith("jagreehal/stamp") || st.run?.includes("@jagreehal/stamp") || checkouts.some((p) => p !== "." && st.run?.includes(`${p}/`)));
  });
}

const Workflow = z.object({
  on: z.union([z.string().transform((t) => [t]), z.array(z.string()), z.record(z.string(), z.unknown()).transform((o) => Object.keys(o))]),
  jobs: z.record(z.string(), z.object({ steps: z.array(z.object({ uses: z.string().optional(), run: z.string().optional(), with: z.object({ repository: z.string().optional(), path: z.string().optional() }).passthrough().optional() }).passthrough()).default([]) }).passthrough()),
});

const CLAUDE_MODELS = /^(haiku|sonnet|opus|fable)$|^claude-/;

export function doctor(bundleRoot: string, home: string, repo: string, personal: Config | null): Check[] {
  const checks: Check[] = [];

  const add = (check: string, status: Check["status"], detail: string, fix?: string) => {
    const c: Check = { check, status, detail };

    if (fix) c.fix = fix;
    checks.push(c);
  };

  const auth = attempt(() => run("gh", ["auth", "status"]));

  if (auth instanceof Error) add("gh auth", "fail", "gh is missing or not signed in", "gh auth login (shepherd reads and writes GitHub through gh)");
  else add("gh auth", "ok", "signed in");

  // The skills call `shepherd` for local change capture and receipts, else `bunx @jagreehal/shepherd`.
  if (attempt(() => run("sh", ["-c", "command -v shepherd"])) instanceof Error) {
    add("shepherd cli", "warn", "not on PATH: the skills fall back to bunx @jagreehal/shepherd, which needs the package published on npm and network access on every call", "bun add -g @jagreehal/shepherd, or put a shepherd wrapper on PATH");
  } else add("shepherd cli", "ok", "on PATH");

  const read = attempt(() => defaultBranchReader(repo));

  if (read instanceof Error) add("default branch", "fail", read.message, "git fetch origin <default branch>: policy and lenses are read from it");
  else add("default branch", "ok", "fetched");

  const missing = bundledSkills(path.join(bundleRoot, "skills")).filter((s) => !SKILL_DIRS(home, repo).some((d) => existsSync(path.join(d, s, "SKILL.md"))));

  if (missing.length) add("skills", "fail", `not installed: ${missing.join(", ")}`, "bunx @jagreehal/shepherd install (or --project, or --target <your agent's skills dir>)");
  else add("skills", "ok", "every bundled skill is installed");

  if (read instanceof Error) return checks;

  const policy = attempt(() => {
    const p = loadPolicy(read, ghFetch, personal);

    fetchPackLenses(p, home, ghFetchDir);

    return p;
  });

  if (policy instanceof Error) {
    const pack = /github:[\w.-]+\/[\w.-]+/.exec(policy.message)?.[0];

    add("policy", "fail", policy.message.split("\n")[0]!, pack ? `gh must read ${pack.slice(7)}: sign gh in as an account with access, or set GH_TOKEN to a token that can read it` : "fix the file on the default branch; shepherd config validate checks your edits");

    return checks;
  }

  add("policy", "ok", policy.teamFile ? `${policy.teamFile}, fixes.mode ${policy.fixes.value.mode}` : "no policy file: built-in defaults", policy.teamFile ? undefined : "bunx @jagreehal/shepherd init");

  for (const [name, l] of Object.entries(policy.lenses)) {
    const problems = lensProblems(l.value, home, repo);

    if (problems.length) add(`lens ${name}`, "fail", problems.join("; "), `from ${l.source}: add the skill to this repository or install it for the agent (see "Packs and lens files" in policy.md)`);
  }

  const models = [...new Set([...(policy.ladder?.value ?? []), ...Object.values(policy.models).map((m) => m.value)])];
  const opencode = models.some((m) => m.includes("/")) ? attempt(() => run("opencode", ["models"])) : null;

  for (const model of models) {
    if (CLAUDE_MODELS.test(model)) add(`model ${model}`, "ok", "a Claude Code model id");
    else if (!model.includes("/")) add(`model ${model}`, "warn", "not a known id; it passes to the agent tool as written", "check the harness accepts it");
    else if (opencode instanceof Error || opencode === null) add(`model ${model}`, "warn", "cannot list OpenCode models", "install opencode, or ignore if another harness runs it");
    else if (opencode.split("\n").includes(model)) add(`model ${model}`, "ok", "listed by opencode models");
    else add(`model ${model}`, "fail", "opencode models does not list it", "fix the id, or sign in to its provider (opencode auth login)");
  }

  if (!models.length) add("models", "ok", "no ladder set: the harness's own (shepherd models)");

  const workflows = attempt(() => run("git", ["-C", repo, "ls-tree", "--name-only", "-r", defaultBranchRef(repo), ".github/workflows/"]));
  const stamp = (workflows instanceof Error ? [] : workflows.split("\n").filter(Boolean)).find((f) => runsStamp(read(f) ?? ""));

  if (!stamp) {
    add("stamp workflow", "warn", "no default-branch workflow runs stamp on pull requests: shepherd can review and fix, but nothing gives the approval verdict", "bunx @jagreehal/stamp init, then add its backend secret");

    return checks;
  }

  add("stamp workflow", "ok", `${stamp} runs stamp on pull requests`);
  const last = attempt(() => run("gh", ["run", "list", "--workflow", path.basename(stamp), "--limit", "30", "--json", "conclusion,status,url,databaseId", "--jq", "[.[] | select(.conclusion != \"skipped\")][0] // empty | [.status, .conclusion, .url, .databaseId] | @tsv"], repo).trim());

  if (last instanceof Error) add("stamp runs", "warn", "cannot read its runs through gh", "check gh can read this repository's Actions");
  else if (!last) add("stamp runs", "warn", "configured, but no recent run did anything (all skipped, or none)", "open a PR, or comment /stamp on one, and check the run");
  else {
    const [status, conclusion, url, id] = last.split("\t");
    // stamp exits 1 on a refusal or an escalation: the run failed, but stamp worked and gave its verdict.
    const verdict = conclusion === "failure" ? /\b(REFUSED|ESCALATE): /.exec(String(attempt(() => run("gh", ["run", "view", id!, "--log-failed"], repo))))?.[1] : undefined;

    if (conclusion === "success") add("stamp runs", "ok", "its latest run approved");
    else if (verdict) add("stamp runs", "ok", `its latest run gave a verdict (${verdict}): ${url}`);
    else if (conclusion === "action_required") add("stamp runs", "warn", `its latest run is waiting for a maintainer to approve it: ${url}`, "approve the run in the Actions tab (GitHub holds runs from first-time contributors and bots), or open a PR from a branch of this repository");
    else add("stamp runs", "warn", `its latest run is ${conclusion || status}: ${url}`, "read the run log; a missing backend secret is the usual cause (stamp README, Backends)");
  }

  return checks;
}
