// `shepherd doctor`: is this machine and repository set up to run shepherd? Each check says what to do.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { defaultBranchReader, defaultBranchRef, fetchPackLenses, ghFetch, ghFetchDir, loadPolicy, type Config } from "./config.ts";
import { bundledSkills } from "./install.ts";
import { lensProblems, pluginRoots, providerKeyEnv, skillDirs } from "./lens.ts";

export type Check = { check: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

const run = (cmd: string, args: string[], cwd?: string) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });

const attempt = <T>(f: () => T): T | Error => {
  try {
    return f();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
};

// Where a harness looks for skills: the bare-name directories, plus OpenCode's.
const SKILL_DIRS = (home: string, repo: string) => [...skillDirs(home, repo), path.join(home, ".config/opencode/skills")];

/**
 * True when a workflow runs shepherd's review on pull requests: a step that runs `shepherd gate` from the package, or
 * from a checkout of shepherd's repository. The word "gate" alone is not enough.
 */
export function runsGate(text: string): boolean {
  const parsed = Workflow.safeParse(attempt(() => parse(text)));

  if (!parsed.success) return false;

  if (!parsed.data.on.some((t) => t === "pull_request" || t === "pull_request_target")) return false;

  const gateCall = /(@jagreehal\/shepherd\S*|\bshepherd|\/src\/bin\.ts)"?\s+gate\b/;

  return Object.values(parsed.data.jobs).some(({ steps }) => {
    const checkouts = steps.filter((st) => st.with?.repository === "jagreehal/shepherd").map((st) => st.with?.path ?? ".");

    return steps.some((st) => gateCall.test(st.run ?? "") && (st.run?.includes("@jagreehal/shepherd") || /\bshepherd\s+gate\b/.test(st.run ?? "") || checkouts.some((p) => p !== "." && st.run?.includes(`${p}/`))));
  });
}

const Workflow = z.object({
  on: z.union([z.string().transform((t) => [t]), z.array(z.string()), z.record(z.string(), z.unknown()).transform((o) => Object.keys(o))]),
  jobs: z.record(z.string(), z.object({ steps: z.array(z.object({ uses: z.string().optional(), run: z.string().optional(), with: z.object({ repository: z.string().optional(), path: z.string().optional() }).passthrough().optional() }).passthrough()).default([]) }).passthrough()),
});

const CLAUDE_MODELS = /^(haiku|sonnet|opus|fable)$|^claude-/;

/**
 * The directories among `/.shepherd/` and `/.github/` that CODEOWNERS leaves without an owner. GitHub applies the last
 * line that matches, and a line with no owner removes ownership: `* @team` then an ownerless `/.github/workflows/`
 * leaves the workflows unowned.
 */
export function uncoveredByOwners(codeowners: string): string[] {
  const rules = codeowners.split("\n").flatMap((l) => {
    const [pattern, ...owners] = l.trim().split(/\s+/);

    return pattern && !pattern.startsWith("#") ? [{ path: pattern.replace(/^\//, "").replace(/\/?\*\*$/, "").replace(/\/$/, ""), owned: owners.length > 0 }] : [];
  });

  return [".shepherd", ".github"].flatMap((d) => {
    let covered = false;

    for (const r of rules) {
      if (r.path === "*" || r.path === "" || r.path === d) covered = r.owned;
      else if (r.path.startsWith(`${d}/`) && !r.owned) covered = false; // part of it left without an owner
    }

    return covered ? [] : [`/${d}/`];
  });
}

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

  const bundled = bundledSkills(path.join(bundleRoot, "skills"));
  const plugins = pluginRoots(home);
  const asPlugin = plugins.get("shepherd");
  const dirs = [...SKILL_DIRS(home, repo), ...(asPlugin ? [path.join(asPlugin, "skills")] : [])];
  const missing = bundled.filter((s) => !dirs.some((d) => existsSync(path.join(d, s, "SKILL.md"))));

  if (missing.length) add("skills", "fail", `not installed: ${missing.join(", ")}`, "bunx @jagreehal/shepherd install (or --project, or --target <your agent's skills dir>), or install the shepherd plugin");
  else add("skills", "ok", `every bundled skill is installed${asPlugin ? " (as a plugin)" : ""}`);

  // Another plugin's skill under one of shepherd's names (pstack ships a `swarm`): Cursor does not namespace
  // plugin skills, so `/swarm` there may load either. Shepherd's own loop loads its sub-skills by path.
  const shared = [...plugins].filter(([name]) => name !== "shepherd").flatMap(([name, root]) => bundled.filter((s) => existsSync(path.join(root, "skills", s, "SKILL.md"))).map((s) => `${name}:${s}`));

  if (shared.length) add("skill names", "warn", `other plugins ship skills under shepherd's names: ${shared.join(", ")}. /shepherd is unaffected; typed on its own, the name may load either`, "in Claude Code type the plugin prefix (/pstack:swarm); in Cursor, pick the skill from the / menu by its description");

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
  const gate = (workflows instanceof Error ? [] : workflows.split("\n").filter(Boolean)).find((f) => runsGate(read(f) ?? ""));

  if (!gate) {
    add("review workflow", "warn", "no default-branch workflow runs shepherd's review on pull requests, so nothing sets the shepherd check", "shepherd workflows, then add the model key");

    return checks;
  }

  add("review workflow", "ok", `${gate} runs shepherd's review on pull requests`);
  // Shepherd's workflows are guarded by people: CODEOWNERS on both directories, and a branch rule that requires them.
  const owners = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"].map((f) => read(f)).find((t) => t !== null) ?? null;
  const uncovered = owners === null ? ["/.shepherd/", "/.github/"] : uncoveredByOwners(owners);

  if (uncovered.length) add("code owners", "warn", `${owners === null ? "no CODEOWNERS file" : "CODEOWNERS does not cover"}: ${uncovered.join(" and ")} can change without a named person's review`, `add to .github/CODEOWNERS: ${uncovered.map((d) => `${d} @your-team`).join(", ")}`);
  else add("code owners", "ok", "CODEOWNERS covers /.shepherd/ and /.github/");
  const branch = attempt(() => run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], repo).trim());
  // A ruleset is readable with read access; classic protection needs admin, so either saying yes is enough.
  const required = branch instanceof Error ? null : [`repos/{owner}/{repo}/rules/branches/${branch}`, `repos/{owner}/{repo}/branches/${branch}/protection`].some((api) => /true/.test(String(attempt(() => run("gh", ["api", api, "--jq", '[.. | objects | (.require_code_owner_review?, .require_code_owner_reviews?) | select(. != null)] | any'], repo)))));

  if (!required) add("code owner review", "warn", `"Require review from Code Owners" is off for the default branch${branch instanceof Error ? ", or gh cannot read it" : " (or gh cannot read it)"}: CODEOWNERS only suggests reviewers until it is on`, "turn on Require review from Code Owners in the default branch's rule or ruleset");
  else add("code owner review", "ok", "the default branch requires a code owner's review");
  // The first review fails on a missing key, so check for it before anyone opens a PR. An environment's secrets are
  // not listed here, hence a warning.
  const loop = policy.models.loop?.value ?? "";
  const key = loop ? providerKeyEnv(loop) : null;
  const secrets = key ? attempt(() => run("gh", ["secret", "list", "--json", "name", "--jq", ".[].name"], repo)) : null;

  if (key && !(secrets instanceof Error) && secrets !== null) {
    if (secrets.split("\n").includes(key)) add("model key", "ok", `${key} is set for ${loop}`);
    else add("model key", "warn", `${key} is not a repository secret, so ${loop} cannot run (fine if a GitHub environment holds it)`, `gh secret set ${key}`);
  }

  const last = attempt(() => run("gh", ["run", "list", "--workflow", path.basename(gate), "--limit", "30", "--json", "conclusion,status,url", "--jq", "[.[] | select(.conclusion != \"skipped\")][0] // empty | [.status, .conclusion, .url] | @tsv"], repo).trim());

  if (last instanceof Error) add("review runs", "warn", "cannot read its runs through gh", "check gh can read this repository's Actions");
  else if (!last) add("review runs", "warn", "configured, but no recent run did anything (all skipped, or none)", "open a PR, or comment /review on one, and check the run");
  else {
    const [status, conclusion, url] = last.split("\t");

    // A refusal or an escalation is a verdict on the shepherd check; the run fails only when the review did not finish.
    if (conclusion === "success") add("review runs", "ok", `its latest run finished: ${url}`);
    else if (conclusion === "action_required") add("review runs", "warn", `its latest run is waiting for a maintainer to approve it: ${url}`, "approve the run in the Actions tab (GitHub holds runs from first-time contributors and bots), or open a PR from a branch of this repository");
    else add("review runs", "warn", `its latest run is ${conclusion || status}: ${url}`, "read the run log; a missing model key or a wrong SHEPHERD_MODEL is the usual cause");
  }

  return checks;
}
