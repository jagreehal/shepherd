#!/usr/bin/env bun
// shepherd install   [--project | --target <dir>] [--link] [--force]
// shepherd uninstall [--project | --target <dir>]
// shepherd lens new <name> [--from <template>] [--applies <glob>]... [--description <text>]   (templates: lenses/)
// shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
// shepherd lens list
// shepherd models [ladder <model>... | pin <lens-or-runner> <model>] [--global]
// shepherd opencode-agents [--file <lenses.yml>]   (agents for OpenCode 1.x, from the default branch's lenses.yml)
// shepherd garden <owner/repo>... [--since YYYY-MM-DD] [--min-prs <n>] [--traces <otlp.json>]... [--tempo-url <url>] [--trace-retries <n>] [--trace-wait-ms <ms>] [--trace-cost-usd <usd>]
// shepherd local change [--base <ref>]              (the change before a PR: unpushed commits, staged, unstaged, untracked)
// shepherd local finish <record.json> [--base <ref>]  (check a local review against that change; complete writes a receipt)
// shepherd local status [--base <ref>]              (is the change on disk the one a complete review covered?)
// shepherd local demo [<dir>]                       (a repository with planted bugs to try /shepherd --local on)
// shepherd init [--preset review-only|local-fix|push] [--from <pack>] [--stacks] [--model <id>]  (scaffold .shepherd/config.yml)
// shepherd config validate                          (the working tree's policy: exits 1 on a problem)
// shepherd config schema                            (the JSON Schema of .shepherd/config.yml, for editors)
// shepherd config explain [--json] [--working-tree] (effective policy and where each setting came from)
// shepherd inline <round.json>                     (JSON: swarm's inline review, for POST /pulls/<n>/reviews)
// shepherd summary <round.json> [--previous <comment.md>] [--body] [--fanout <fanout.json>]   (Markdown: swarm's summary comment)
// shepherd branding [--working-tree]                (JSON: the name, avatar, glyphs and headers posted comments use)
// shepherd fanout [--base <ref>] [--working-tree]   (JSON: the lenses swarm starts beside the router, each with its scope)
// shepherd preview [--recipe <name>] [--base <ref>] [--working-tree]  (what would run on your change)
// shepherd doctor [--json]                          (is this machine and repository set up? each problem says what to do)
// shepherd acceptance <suggest|local> [--pr <n>] -- <agent command>...  (run it; check it kept to the mode)
// shepherd trace event <stage> <start|end> --pr <n> [--round <n>] [--outcome ok|failed|skipped] [--retries <n>] [--head <sha>]
// shepherd stack <pr>                              (JSON: a stacked parent and the range to review, or a wrong base)
// shepherd interdiff <since> <base> [--head <sha>] [--since-base <sha>]  (JSON: how the PR's own change moved since a reviewed head)
// shepherd coverage <round.json> --diff <path>     (JSON: changed ranges no finished lens reached; non-zero when any)
// shepherd reviewed <summary.md>                   (JSON: the head and base tip the previous round reviewed)
// shepherd eval export <case-id> <dir> | eval import <case-id> <comments.json> --config <label> --login <reviewer> [--cost <usd>]
// shepherd impact <diff>                            (JSON: changed exports, files naming them, each source's tests, stale references)
// shepherd number <diff>                            (the diff with each line's old and new numbers, under a contents list)
// shepherd ci-log <log>                             (JSON: a failed job log's error lines, and a window on the last error)
// shepherd eval run <cases-dir> --config <label> [--repeat <n>] [--out <dir>] -- <agent command>...  (review each case, keep each run)
// shepherd eval score <runs-dir> [--cases <dir>] [--json]  (precision and recall per configuration, dev and held-out apart)
// shepherd workflows [--upgrade] [--model <id>] [--environment <name>] [--aws-region <region>]  (write .github/workflows/shepherd.yml and the reviewer's policy)
// shepherd notify --pr <n> --repo <owner/repo> --head <sha> --state success|failure|pending|error --file <description.txt>
// shepherd trace flush --pr <n> --repo <owner/repo> --head <sha> --outcome <how it ended> [--base <sha>] [--ci-run <id> --ci-attempt <n>] [--related <traceparent>]...
//
// Default: skills to ~/.claude/skills, the /shepherd command to ~/.claude/commands.
// --project installs into ./.claude of the current repository instead.
// --target <dir> installs skills only, into any agent's skills directory (e.g. ~/.codex/skills, ./.agents/skills).
// A lens wraps any skill as a swarm reviewer: .shepherd/lenses.yml for the repository, --global for a
// personal preview that prints locally and never posts. Model ids pass straight to the harness's agent
// tool (`haiku` on Claude Code, `provider/model` on OpenCode); --model on a lens pins it to one.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml, parseDocument, stringify } from "yaml";
import { z } from "zod";
import { branding, ciSettings, type Config, ConfigSchema, defaultBranchDir, defaultBranchReader, type Effective, fetchPackLenses, ghFetch, ghFetchDir, loadPolicy, policyProblems, PRESETS, preview, type Read, TEAM_FILES, configJsonSchema, schemaLine } from "./config.ts";
import { commentableLines, type OpenThread, renderReview, renderSummary, reviewedTips, roundCoverage, swarmThreads } from "./summary.ts";
import { ghThreads, snapshot, verdict } from "./acceptance.ts";
import { doctor } from "./doctor.ts";
import { fileLedger, LEDGER_CONTEXT, notify, notifyOn, STATES, statusLedger } from "./notify.ts";
import { collect, collectEscapes, score } from "./garden.ts";
import { collectTraces, tempoHeaders, traceLimits, traceScores } from "./garden-traces.ts";
import { install, type Outcome, uninstall } from "./install.ts";
import { exportCase, importRun, loadCases, PostedComments, loadRuns, pick, prepare, runCase, scoreRuns, treeHash } from "./eval.ts";
import { buildDemo, captureChange, changedRanges, demoBugs, finish, receiptStatus } from "./local.ts";
import { analyzeLog } from "./cilog.ts";
import { numberDiff } from "./diff.ts";
import { formatLeads, leadsAt } from "./leads.ts";
import { prInterdiff, prStack } from "./stack.ts";
import { flush, recordEvent, traceFile } from "./trace.ts";
import { compareDiff, latestVerdict, listReviews, reviewThreads as prThreads } from "../gate/src/github.ts";
import { approvedDiffUnchanged } from "../gate/src/retention.ts";
import { githubSetup, KEY_MODELS, modelProblem, pickModel } from "./setup.ts";
import { type PrFacts, prStatus } from "./status.ts";
import { DEFAULT_LOOK, isWorkingNote, WORKING_IMAGE, workingNote } from "./working.ts";
import { addLens, sharedModelProblem, BUILT_IN_LENSES, PROVIDER_KEY_ENVS, pluginRoots, lensTemplates, globalLensFile, lensProblems, newLens, opencodeAgents, opencodeModel, setTier, detectStacks, stackLens, pinModel, repoLensFile, resolveSkill, setLadder, skillDescription, skillDirs, type Lens } from "./lens.ts";

const BUNDLE_ROOT = path.resolve(import.meta.dir, "..");

/** What runs shepherd again: the bundle when installed, src/bin.ts in a clone. */
const ENTRY = import.meta.path.endsWith(".ts") ? path.join(BUNDLE_ROOT, "src", "bin.ts") : import.meta.path;


/** This CLI's version: workflows and the policy's schema line pin to it. */
const bundleVersion = () => z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path.join(BUNDLE_ROOT, "package.json"), "utf8"))).version;

const HELP = `usage: shepherd <command>

commands:
  init        set up this repository: config, workflows, secrets on GitHub
  doctor      check the setup can run, and say what to fix
  review      start a review of a PR in GitHub Actions and print the run's URL
  status      where a PR is (reviewing, fixing, waiting for CI, needs you, ready) and what to do next
  gate        the approval gate's verdict on a PR, here or posted to it
  config      inspect the settings and where each comes from (explain, validate)
  models      show or set the model for each tier
  lens        list or add review lenses
  workflows   write or upgrade the workflow files
  local       whether a local review covered your branch

  shepherd help --all lists every command, including those the workflows call.`;

const USAGE = `usage: shepherd install   [--project | --target <dir>] [--link] [--force]
       shepherd uninstall [--project | --target <dir>]
       shepherd lens new <name> [--from <template>] [--applies <glob>]... [--description <text>]
       shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
       shepherd lens list
       shepherd models [tier <name> <model> | ladder <model-or-tier>... | pin <runner-lens-or-group> <model-or-tier>] [--global]
       shepherd opencode-agents [--file <lenses.yml>]
       shepherd garden <owner/repo>... [--since YYYY-MM-DD] [--min-prs <n>] [--traces <otlp.json>]... [--tempo-url <url>] [--trace-retries <n>] [--trace-wait-ms <ms>] [--trace-cost-usd <usd>]
       shepherd local change [--base <ref>]
       shepherd local finish <record.json> [--base <ref>]
       shepherd local status [--base <ref>]
       shepherd local demo [<dir>]
       shepherd init [--preset review-only|local-fix|push] [--from <pack>] [--stacks] [--model <id>] [--yes]
       shepherd review <pr>
       shepherd status <pr>
       shepherd gate <pr> [--post] (shepherd gate --help for its options)
       shepherd config validate
       shepherd config schema
       shepherd config explain [--json] [--working-tree]
       shepherd inline <round.json>
       shepherd summary <round.json> [--previous <comment.md>] [--body] [--fanout <fanout.json>]
       shepherd branding [--working-tree]
       shepherd fanout [--base <ref>] [--working-tree]
       shepherd preview [--recipe <name>] [--base <ref>] [--working-tree]
       shepherd doctor [--json]
       shepherd acceptance <suggest|local> [--pr <n>] -- <agent command>...
       shepherd trace event <stage> <start|end> --pr <n> [--round <n>] [--outcome ok|failed|skipped] [--retries <n>] [--head <sha>]
       shepherd trace flush --pr <n> --repo <owner/repo> --head <sha> --outcome <how it ended> [--base <sha>] [--ci-run <id> --ci-attempt <n>] [--related <traceparent>]...
       shepherd stack <pr>
       shepherd interdiff <since> <base> [--head <sha>] [--since-base <sha>]
       shepherd impact <diff>
       shepherd number <diff>
       shepherd ci-log <log>
       shepherd reviewed <summary.md>
       shepherd coverage <round.json> --diff <path>
       shepherd eval run <cases-dir> --config <label> [--repeat <n>] [--out <dir>] -- <agent command>...
       shepherd eval score <runs-dir> [--cases <dir>] [--json]
       shepherd eval export <case-id> <dir>
       shepherd eval import <case-id> <comments.json> --config <label> --login <reviewer> [--cost <usd>] [--duration-ms <n>]
       shepherd model-id <provider:model | provider/model>
       shepherd workflows [--upgrade] [--model <id>] [--environment <name>] [--aws-region <region>]
       shepherd working --pr <n> --repo <owner/repo> [--head <sha>]
       shepherd notify --pr <n> --repo <owner/repo> --head <sha> --state success|failure|pending|error --file <description.txt>`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "boolean", default: false },
    all: { type: "boolean", default: false }, // help: every command, not only the everyday ones
    help: { type: "boolean", short: "h", default: false },
    target: { type: "string" },
    link: { type: "boolean", default: false }, // symlink instead of copy: for a local clone you edit, never for bunx
    force: { type: "boolean", default: false },
    name: { type: "string" },
    applies: { type: "string", multiple: true },
    description: { type: "string" },
    global: { type: "boolean", default: false },
    model: { type: "string" }, // lens add: the lens's model; init, workflows: the session model, written to models.loop
    environment: { type: "string" }, // workflows: the GitHub environment whose secrets hold the model keys
    upgrade: { type: "boolean", default: false }, // workflows: rewrite existing workflows from the current templates
    since: { type: "string" },
    file: { type: "string" }, // opencode-agents: a lenses.yml to read instead of the default branch's
    "min-prs": { type: "string", default: "3" },
    traces: { type: "string", multiple: true }, // garden: OTLP JSON or collector JSON-lines files
    "tempo-url": { type: "string" }, // garden: read-only Tempo API, never the OTLP ingest endpoint
    "trace-retries": { type: "string" },
    "trace-wait-ms": { type: "string" },
    "trace-cost-usd": { type: "string" },
    base: { type: "string" }, // local: the ref the change is measured from
    from: { type: "string" }, // lens new: a starter lens in lenses/; init: the pack to extend
    json: { type: "boolean", default: false },
    previous: { type: "string" }, // summary: the summary comment already on the PR, whose rounds carry forward
    body: { type: "boolean", default: false }, // summary: no marker or header, for the handoff findings.md
    fanout: { type: "string" }, // summary: `shepherd fanout`'s output, default $SHEPHERD_FANOUT; lenses it lists but the round lacks show as could_not_run
    "working-tree": { type: "boolean", default: false }, // explain, preview: your edits instead of the default branch
    recipe: { type: "string" },
    preset: { type: "string" }, // init: how far fixes go
    audit: { type: "boolean", default: false }, // workflows: also the scheduled OWASP playbook audit
    outputs: { type: "boolean", default: false }, // ci-settings: key=value lines for $GITHUB_OUTPUT
    "aws-region": { type: "string" }, // workflows: the reviewer's Bedrock region
    stacks: { type: "boolean", default: false }, // init: add a lens for each stack the repository uses
    yes: { type: "boolean", short: "y", default: false }, // init: set the secrets and the approval setting without asking
    pr: { type: "string" }, // acceptance: the PR whose threads must stay as they were; trace: the PR; summary, inline: the PR whose review threads a link may name
    round: { type: "string" }, // trace: the quality-loop round
    outcome: { type: "string" }, // trace: how a step or iteration ended
    retries: { type: "string" },
    head: { type: "string" }, // trace, notify, interdiff: the head SHA
    diff: { type: "string" }, // inline, coverage: the reviewed diff
    "since-base": { type: "string" }, // interdiff: the base tip the earlier head was reviewed against
    cost: { type: "string" }, // eval import: what the outside reviewer's run cost, in USD
    login: { type: "string" }, // eval import: the reviewer's GitHub login, whose top-level comments are the findings
    "duration-ms": { type: "string" }, // eval import: how long it took
    state: { type: "string" }, // notify: the commit status state just set
    repo: { type: "string" }, // trace flush: owner/repo
    "ci-run": { type: "string" },
    "ci-attempt": { type: "string" },
    related: { type: "string", multiple: true }, // trace flush: traceparent of a related trace, such as gate's review
    config: { type: "string" }, // eval run: the label runs are grouped and compared under
    repeat: { type: "string", default: "1" }, // eval run: reviews per case; one run says little about a model
    out: { type: "string" }, // eval run: where run files go, default evals/runs
    cases: { type: "string" }, // eval score: the cases the runs reviewed, default evals/cases
  },
});

const base = opts.project ? path.join(process.cwd(), ".claude") : path.join(homedir(), ".claude");

const skillsDest = opts.target ? path.resolve(opts.target) : path.join(base, "skills");

const commandsDest = opts.target ? null : path.join(base, "commands");

const repoRoot = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
})();

const report = (outcomes: Outcome[]) => {
  for (const o of outcomes) console.log(`${o.action.padEnd(9)} ${o.name.padEnd(24)} ${o.dest}`);

  return outcomes.some((o) => o.action === "skipped");
};

const [command, sub, skillRef, ...rest] = positionals;

// Before any command runs: `shepherd init --help` must not set anything up.
if (opts.help) {
  const forms = USAGE.split("\n").filter((l) => command && l.trim().startsWith(`shepherd ${command} `));

  console.log(forms.length ? `usage:\n${forms.join("\n")}` : HELP);
  process.exit(0);
}

/**
 * The URLs of the review comments on the PR as GitHub gives them (`--pr`, or `$PR` in CI, with `$GITHUB_REPOSITORY`), so
 * a rendered thread link can only name a thread that exists on this PR. Unknown (no PR, gh failing): undefined, and links are kept as the round gave them.
 */
/** The PR's open swarm threads (`swarmThreads`), so a finding swarm marked as a repeat joins its thread. */
function openThreads(): OpenThread[] {
  const pr = opts.pr ?? process.env.PR;
  const [owner, name] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

  if (!pr || !/^\d+$/.test(pr) || !owner || !name) return [];
  const query = "query($owner:String!,$name:String!,$number:Int!){viewer{login} repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{url body author{login __typename}}}}}}}}";
  const Node = z.object({ isResolved: z.boolean(), comments: z.object({ nodes: z.array(z.object({ url: z.string(), body: z.string(), author: z.object({ login: z.string(), __typename: z.string() }).nullable() })) }) });
  const Out = z.object({ viewer: z.object({ login: z.string() }).nullable(), repository: z.object({ pullRequest: z.object({ reviewThreads: z.object({ nodes: z.array(Node) }) }) }) });

  try {
    const out = Out.parse(JSON.parse(execFileSync("gh", ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${pr}`, "--jq", ".data"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 })));

    return swarmThreads(out.repository.pullRequest.reviewThreads.nodes, out.viewer?.login ?? null);
  } catch {
    return [];
  }
}

function reviewThreads(): Set<string> | undefined {
  const pr = opts.pr ?? process.env.PR;

  if (!pr || !/^\d+$/.test(pr)) return undefined;

  try {
    const out = execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY ?? "{owner}/{repo}"}/pulls/${pr}/comments`, "--paginate", "--jq", ".[].html_url"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 });

    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return undefined;
  }
}

/** Print a lens error as one line and exit 1. */
const orExit = <T>(run: () => T): T => {
  try {
    return run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

// Secrets config explain shows only as set or unset.
const SECRETS = ["SHEPHERD_TOKEN", "SHEPHERD_NOTIFY_WEBHOOK", ...new Set(PROVIDER_KEY_ENVS)];

const MERGE_NOTE = "shepherd reads .shepherd/ from the default branch: commit and merge it before it takes effect.";

if (command === "install") {
  if (report(install(BUNDLE_ROOT, skillsDest, commandsDest, opts.link, opts.force))) {
    console.log("\nskipped: something this installer did not create is in the way; rerun with --force to replace it.");
  }

  console.log("\nNext: in a repository with an open PR, run /shepherd <pr> (or /swarm, /triage, /ci-repair on their own).\nBefore a PR: /shepherd --local. To try it: shepherd local demo.");
} else if (command === "uninstall") {
  report(uninstall(BUNDLE_ROOT, skillsDest, commandsDest));
} else if (command === "lens" && sub === "add" && skillRef) {
  const found = resolveSkill(skillRef, homedir(), repoRoot);

  if (!found) {
    console.error(`no SKILL.md found for "${skillRef}": install the skill, or pass a path to its directory`);
    process.exit(1);
  }

  const name = opts.name ?? path.basename(found).toLowerCase();
  const file = opts.global ? globalLensFile(homedir()) : repoLensFile(repoRoot);

  const lens: Lens = { skill: skillRef };

  if (opts.applies?.length) lens.applies_to = opts.applies;

  if (opts.description) lens.description = opts.description;
  const problems = lensProblems(lens, homedir(), repoRoot);

  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }

  orExit(() => addLens(file, name, lens));

  if (opts.model) pinModel(file, name, opts.model);
  console.log(`lens "${name}" -> ${found}\nwritten to ${file}`);

  console.log(opts.global ? "personal lens: swarm prints its findings locally and never posts them." : MERGE_NOTE);
} else if (command === "lens" && sub === "new" && skillRef) {
  const lens: Omit<Lens, "skill"> = {};

  if (opts.applies?.length) lens.applies_to = opts.applies;

  if (opts.description) lens.description = opts.description;
  const dir = orExit(() => newLens(repoRoot, skillRef, lens, opts.from));

  if (opts.model) pinModel(repoLensFile(repoRoot), skillRef, opts.model);

  console.log(`lens "${skillRef}" -> ${path.join(dir, "SKILL.md")}\n${opts.from ? `started from the ${opts.from} template: edit its rules to fit` : "fill in its Review and Fix sections"}, try it with /swarm --preview, then: ${MERGE_NOTE}`);
} else if (command === "lens" && sub === "list") {
  for (const name of BUILT_IN_LENSES) console.log(`${name.padEnd(18)} built-in`);

  console.log(`${"".padEnd(18)} starter templates (lens new <name> --from <template>): ${lensTemplates().join(", ")}`);

  // The effective policy, packs included, as your working tree has it.
  for (const [name, { value: lens, source, scope }] of Object.entries(policy(true).lenses)) {
    const found = resolveSkill(lens.skill, homedir(), repoRoot);
    const about = lens.description ?? (found ? skillDescription(found) : null) ?? "";

    console.log(`${name.padEnd(18)} ${scope === "personal" ? "personal preview  " : ""}${found ?? `MISSING ${lens.skill}`}  [${lens.applies_to?.join(", ") ?? "router picks"}]  (${source})  ${about.slice(0, 80)}`);

    for (const p of lensProblems(lens, homedir(), repoRoot)) {
      console.log(`${"".padEnd(18)} problem: ${p}`);
      process.exitCode = 1;
    }
  }
} else if (command === "models" && (sub === undefined || (sub === "ladder" && skillRef) || ((sub === "pin" || sub === "tier") && skillRef && rest.length === 1))) {
  const file = opts.global ? globalLensFile(homedir()) : repoLensFile(repoRoot);

  if (sub === "tier") orExit(() => setTier(file, skillRef!, rest[0]!));

  if (sub === "ladder") orExit(() => setLadder(file, [skillRef!, ...rest]));

  if (sub === "pin") orExit(() => pinModel(file, skillRef!, rest[0]!));
  const effective = policy(true);
  const { ladder, models } = choice(effective);

  const spelled = (id: string) => (opencodeModel(id) === id ? id : `${id} (OpenCode: ${opencodeModel(id)})`);

  for (const [name, t] of Object.entries(effective.tiers)) console.log(`tier    ${name.padEnd(18)} ${spelled(t.value)}  (${t.source})`);

  console.log(`ladder  ${ladder?.map(spelled).join(" -> ") ?? "the harness's own (skills/shepherd/references/models.md)"}`);

  for (const [name, model] of Object.entries(models)) console.log(`pin     ${name.padEnd(18)} ${spelled(model)}`);

  if (sub) console.log(`\nwritten to ${file}${opts.global ? "" : `\n${MERGE_NOTE}`}`);
} else if (command === "opencode-agents") {
  // The models come from the default branch, never the working tree: on a PR checkout that is PR content.
  // Packs count: a ladder an organisation pack sets is the ladder. With --file, its local packs still come
  // from the default branch: the working tree of a PR checkout is the PR's to write.
  const branch = orExit(() => defaultBranchReader(repoRoot));
  const read: Read = opts.file ? ((text) => (rel: string) => (rel === TEAM_FILES[0] ? text : branch(rel)))(readFileSync(path.resolve(opts.file), "utf8")) : branch;

  console.log(JSON.stringify(opencodeAgents(choice(orExit(() => loadPolicy(read, ghFetch, personal()))))));
} else if (command === "garden" && sub) {
  // Default window: the last seven days, which the weekly gardener covers exactly.
  const since = opts.since ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const repos = [sub, ...(skillRef ? [skillRef] : []), ...rest];
  const files = opts.traces ?? orExit(() => z.array(z.string()).parse(JSON.parse(process.env.GARDEN_TRACE_FILES || "[]")));
  const endpoint = opts["tempo-url"] ?? process.env.GARDEN_TEMPO_URL;
  const headers = orExit(() => tempoHeaders(endpoint, process.env.GARDEN_TEMPO_URL, process.env.GARDEN_TEMPO_HEADERS));
  const { GARDEN_DATADOG_SITE: site, GARDEN_DATADOG_API_KEY: apiKey, GARDEN_DATADOG_APP_KEY: appKey } = process.env;
  const datadog = site && apiKey && appKey ? { site, apiKey, appKey } : undefined;
  const positive = (v: string | undefined, fallback: number) => orExit(() => z.coerce.number().finite().positive().parse(v ?? fallback));
  const limits = { retries: positive(opts["trace-retries"], traceLimits.retries), waitMs: positive(opts["trace-wait-ms"], traceLimits.waitMs), costUsd: positive(opts["trace-cost-usd"], traceLimits.costUsd) };
  const reports = [];

  orExit(() => z.iso.date().parse(since));

  for (const repo of repos) {
    const records = orExit(() => collect(repo, since));
    const report = { repo, since, ...score(records, Number(opts["min-prs"])), escapes: orExit(() => collectEscapes(repo, since)) };

    if (!files.length && !endpoint && !datadog) {
      reports.push(report);
      continue;
    }

    const traces = traceScores(await collectTraces(files, endpoint, headers, repo, since, datadog), repo, records, since, limits);
    reports.push({ ...report, prs: report.prs.map((pr) => ({ ...pr, signals: [...pr.signals, ...(traces.summaries.get(pr.number)?.signals ?? [])], telemetry: traces.summaries.get(pr.number) ?? null })), telemetry: { coverage: { ...traces.coverage, untouchedPrs: [...traces.summaries.keys()].filter((n) => !report.prs.some((pr) => pr.number === n)).length }, limits: traces.limits } });
  }

  console.log(JSON.stringify(reports, null, 2));
} else if (command === "local" && sub === "change") {
  console.log(JSON.stringify(orExit(() => captureChange(repoRoot, opts.base)), null, 2));
} else if (command === "local" && sub === "finish" && skillRef) {
  const result = orExit(() => finish(repoRoot, readFileSync(skillRef, "utf8"), opts.base));

  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "complete") process.exitCode = 2;
} else if (command === "local" && sub === "status") {
  const result = orExit(() => receiptStatus(repoRoot, opts.base));

  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "reviewed") process.exitCode = 1;
} else if (command === "local" && sub === "demo") {
  const dir = skillRef ? path.resolve(skillRef) : mkdtempSync(path.join(tmpdir(), "shepherd-demo-"));
  const app = orExit(() => buildDemo(dir));

  console.log(`demo repository: ${app}\n\nplanted bugs:`);

  for (const b of demoBugs()) console.log(`  ${`${b.file}:${b.lines[0]}`.padEnd(18)} ${b.class} (${b.enters_as})`);

  console.log(`\nNext: cd ${app}, open your coding agent there, and run /shepherd --local.`);
} else if (command === "trace" && (sub === "event" || sub === "flush")) {
  const pr = Number(opts.pr);

  const count = (flag: string, v: string | undefined) =>
    v === undefined
      ? undefined
      : orExit(() => {
          if (!/^\d+$/.test(v)) throw new Error(`trace needs --${flag} as a whole number`);

          return Number(v);
        });

  if (!Number.isInteger(pr) || pr <= 0) orExit(() => {
    throw new Error("trace needs --pr <number>");
  });

  if (sub === "event") {
    orExit(() => recordEvent(traceFile(repoRoot, pr), { stage: skillRef ?? "", phase: rest[0] ?? "", round: count("round", opts.round), outcome: opts.outcome, retries: count("retries", opts.retries), head_sha: opts.head }));
  } else {
    if (!opts.repo || !opts.head || !opts.outcome) orExit(() => {
      throw new Error("trace flush needs --repo, --head and --outcome");
    });

    const result = await flush(traceFile(repoRoot, pr), { repo: opts.repo ?? "", pr, headSha: opts.head ?? "", baseSha: opts.base, outcome: opts.outcome ?? "", ciRun: count("ci-run", opts["ci-run"]), ciAttempt: count("ci-attempt", opts["ci-attempt"]), links: opts.related ?? [] });

    console.log(JSON.stringify(result, null, 2));
  }
} else if (command === "model-id" && sub) {
  // A model id as OpenCode spells it, so gate's provider:model spelling works in a local OpenCode run too.
  console.log(opencodeModel(sub));
} else if (command === "stack" && sub) {
  // Which diff to review: the delta over an open stacked parent, or nothing at all when the base is wrong.
  console.log(JSON.stringify(orExit(() => prStack(Number(sub), repoRoot)), null, 2));
} else if (command === "coverage" && sub && opts.diff) {
  // Before a round posts: did every changed range of the PR's diff reach a lens that finished? Non-zero when not.
  const result = orExit(() => roundCoverage(JSON.parse(readFileSync(sub, "utf8")), readFileSync(opts.diff!, "utf8")));

  console.log(JSON.stringify(result, null, 2));

  if (!result.complete) process.exitCode = 1;
} else if (command === "reviewed" && sub) {
  // The head and base tip the previous round reviewed, from its summary comment: the next round's since_sha and --since-base.
  console.log(JSON.stringify(reviewedTips(readFileSync(sub, "utf8"))));
} else if (command === "impact" && sub) {
  // Where the change may reach beyond its diff: changed exports, the files naming them, each changed source's tests.
  const patch = readFileSync(sub, "utf8");
  const changed = [...new Set(changedRanges(patch).map((r) => r.file))];
  const leads = leadsAt(repoRoot, patch, changed) ?? { symbols: [], sources: [], references: [] };

  console.log(JSON.stringify({ ...leads, lines: formatLeads(leads, (n) => n.replace(/[\n\r\t]+/g, " ")) }, null, 2));
} else if (command === "number" && sub) {
  console.log(numberDiff(readFileSync(sub, "utf8")));
} else if (command === "ci-log" && sub) {
  console.log(JSON.stringify(analyzeLog(readFileSync(sub, "utf8")), null, 2));
} else if (command === "interdiff" && sub && skillRef) {
  // A later round's focus: the PR's own change since the head swarm last reviewed, without the base's commits.
  console.log(JSON.stringify(orExit(() => prInterdiff(sub, opts.head ?? "HEAD", skillRef, repoRoot, opts["since-base"])), null, 2));
} else if (command === "workflows") {
  const problem = opts.model ? sharedModelProblem(opts.model) : null;

  if (problem) {
    console.error(problem);
    process.exit(2);
  }

  // Settings go in the team policy, reviewed and versioned, rather than in repository variables. Pinned before the
  // gate's init, which names the key for this model.
  if (opts.model) {
    orExit(() => pinModel(repoLensFile(repoRoot), "loop", opts.model!));
    console.log(`pinned    models.loop: ${opts.model} in ${path.relative(repoRoot, repoLensFile(repoRoot))}`);
  }

  // The one workflow and the reviewer's policy. No --model: the reviewer reads models.loop, so a later --model moves it.
  const gateArgs = ["init", ...(opts.upgrade ? ["--upgrade"] : []), ...(opts.environment ? ["--environment", opts.environment] : []), ...(opts["aws-region"] ? ["--region", opts["aws-region"]] : [])];

  if (spawnSync(process.execPath, [ENTRY, "gate", ...gateArgs], { cwd: repoRoot, stdio: "inherit" }).status !== 0) process.exitCode = 1;

} else if (command === "notify") {
  const pr = Number(opts.pr);
  const state = STATES.find((s) => s === opts.state);

  if (!Number.isInteger(pr) || pr <= 0 || !opts.repo || !opts.head || !state || !opts.file) orExit(() => {
    throw new Error("notify needs --pr, --repo, --head, --state success|failure|pending|error and --file");
  });

  // The description comes from a file: it can quote PR-authored text, which must never reach a shell.
  const description = orExit(() => readFileSync(opts.file ?? "", "utf8")).trim().slice(0, 300);
  const url = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${opts.repo}/pull/${pr}`;
  const event = { event: "shepherd.state" as const, repo: opts.repo ?? "", pr, url, head_sha: opts.head ?? "", state: state ?? "pending", description };

  // The variable, then ci.notify_on from the default branch, then the default: the same resolver CI uses.
  const on = (() => {
    try {
      return ciSettings(loadPolicy(defaultBranchReader(repoRoot), ghFetch, null), process.env).notify_on.value;
    } catch {
      return process.env.SHEPHERD_NOTIFY_ON; // no default branch to read (a bare checkout): the variable alone
    }
  })();

  console.log(`notify: ${await notify(process.env.SHEPHERD_NOTIFY_WEBHOOK, event, notifyOn(on), [fileLedger(repoRoot, pr), statusLedger(opts.repo ?? "", opts.head ?? "", repoRoot)])}`);
} else if (command === "init") {
  const file = path.join(repoRoot, TEAM_FILES[0]!);

  // With --stacks on an existing policy, add the detected stacks' lenses it lacks and keep everything else.
  if (existsSync(file) && opts.stacks) {
    addStackLenses(file);
    validate();
    console.log(MERGE_NOTE);
    process.exit(process.exitCode ?? 0);
  }

  const presetMode = Object.entries(PRESETS).find(([name]) => name === opts.preset)?.[1];

  if (opts.preset && !presetMode) orExit(() => { throw new Error(`--preset is one of ${Object.keys(PRESETS).join(", ")}`); });

  // Rerunnable: an existing policy is kept, and the rest of setup still runs. --preset on it changes only fixes.mode.
  const kept = existsSync(file);

  if (kept && presetMode) {
    const doc = parseDocument(readFileSync(file, "utf8"));

    doc.setIn(["fixes", "mode"], presetMode);
    writeFileSync(file, doc.toString());
    console.log(`set       fixes.mode: ${doc.getIn(["fixes", "mode"])} in ${TEAM_FILES[0]}`);
  } else if (kept) console.log(`kept      ${TEAM_FILES[0]}`);
  else {
    const legacy = workingTree(TEAM_FILES[1]!);
    const seed = legacy ? orExit(() => ConfigSchema.parse(parseYaml(legacy) ?? {})) : { lenses: {} };
    // Every repository starts review-only, a migration too: push needs SHEPHERD_TOKEN and lets the bot push, so it is
    // opted into, never inherited. A pack or a legacy fixes: keeps its mode.
    const preset = opts.preset ?? (opts.from || seed.fixes ? undefined : "review-only");

    const mode = Object.entries(PRESETS).find(([name]) => name === preset)?.[1];

    if (preset && !mode) orExit(() => { throw new Error(`--preset is one of ${Object.keys(PRESETS).join(", ")}`); });
    const config: Config = { ...seed };

    if (opts.from) config.extends = [opts.from, ...(seed.extends ?? [])];

    if (mode) config.fixes = { mode };

    if (opts.model) config.models = { ...config.models, loop: opts.model }; // the session model, in the reviewed policy
    const stacks = detectStacks(trackedFiles(), workingTree);

    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${schemaLine(bundleVersion())}\n# shepherd team policy. Presets: review-only (fixes.mode suggest), local-fix (local), push.\n${stringify(config)}`);
    console.log(`wrote ${TEAM_FILES[0]}${preset ? ` (preset ${preset})` : ""}${opts.model ? ` with models.loop ${opts.model}` : ""}${legacy ? ` from ${TEAM_FILES[1]} (delete it: ${TEAM_FILES[0]} now wins)` : ""}`);

    if (legacy && !opts.preset && !seed.fixes) console.log(`${TEAM_FILES[1]} pushed fixes; this policy starts review-only. To keep pushing: rm ${TEAM_FILES[0]} && shepherd init --preset push`);

    // After the file exists, so a pack named by --from counts as already providing its lenses.
    if (opts.stacks) addStackLenses(file);
    else {
      if (stacks.length) console.log(`detected ${stacks.join(", ")}: run shepherd init --stacks to add their lenses, or extend github:jagreehal/shepherd/packs/<stack>.yml@<sha>`);
      pstackHint("pstack" in policy(true).lenses);
    }
  }

  validate();

  // The rest of a first run: one model for the loop and the gate, the workflows and the gate's files, then GitHub.
  // Team policy only, packs included and no personal layer: what CI will read, so an inherited model or push mode
  // counts as the repository's own and a personal pin never does.
  const resolved = orExit(() => loadPolicy(workingTree, ghFetch, null));
  const pick = pickModel(opts.model, resolved.models.loop, process.env);
  const problem = pick && modelProblem(pick.model);

  if (problem) {
    console.error(problem);
    process.exit(2);
  }

  // Only a new choice is written: a rerun keeps the model the policy names.
  const wf = spawnSync(process.execPath, [ENTRY, "workflows", ...(pick?.chosen ? ["--model", pick.model] : [])], { cwd: repoRoot, encoding: "utf8" });

  for (const line of `${wf.stdout}${wf.stderr}`.split("\n")) if (/^(wrote|created|added|upgraded|pinned|scoped|Priced|No list price)\b/.test(line)) console.log(line); // a rerun's kept files are not news

  if (wf.status !== 0) orExit(() => { throw new Error(`writing the workflows failed:\n${wf.stderr}`); });
  console.log(pick ? `model     ${pick.model} (${pick.why})` : `model     none found: set ${KEY_MODELS.map(([k]) => k).join(", ")} or pass --model provider/model`);

  const secrets = (pick?.key ? [pick.key] : []).map((name) => ({ name, value: process.env[name]?.trim() || undefined }));

  const view = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: repoRoot, encoding: "utf8" });
  const repo = view.status === 0 ? view.stdout.trim() : "";
  const ask = () => opts.yes || (process.stdin.isTTY === true && /^(y|yes|)$/i.test((prompt(`\nOn ${repo}: set ${secrets.map((x) => x.name).join(" and ")}? [Y/n]`) ?? "n").trim()));
  const todo: string[] = [];

  if (repo && secrets.length && ask()) {
    const gh = (args: string[], input?: string) => {
      const r = spawnSync("gh", args, { cwd: repoRoot, encoding: "utf8", input });

      return { ok: r.status === 0, out: r.stdout ?? "" };
    };

    const done = githubSetup(gh, { repo, secrets });

    for (const line of done.lines) console.log(line);
    todo.push(...done.todo);
  } else todo.push(...secrets.map((x) => `gh secret set ${x.name}`));

  // Committing is the user's, like any change: one command, on a branch of their choosing.
  const fixMode = resolved.fixes.value.mode;
  const changed = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ".shepherd", ".github/workflows"], { cwd: repoRoot, encoding: "utf8" }).stdout?.split("\n").filter(Boolean).map((l) => l.slice(3)) ?? [];
  const MODES = { suggest: "reviews and suggests fixes, never pushes", local: "fixes stay in your working tree", push: "pushes fixes to the PR's branch" } as const;

  console.log(`\nmode      ${fixMode}: ${MODES[fixMode]} (fixes.mode in ${TEAM_FILES[0]})`);
  console.log(`commit    ${changed.length ? changed.join(", ") : "nothing new"}`);
  console.log(`missing   ${todo.length ? todo.join("; ") : "nothing"}`);
  console.log(["", "Next", ...(changed.length ? ["  git add .shepherd .github/workflows && git commit -m 'Set up shepherd', then open a PR and merge it"] : []), "  shepherd doctor        once merged: checks the workflows and the model key on GitHub", "  shepherd review <pr>   on any PR, then shepherd status <pr>"].join("\n"));

} else if (command === "working" && opts.pr && opts.repo) {
  // The workflow's "shepherd is reviewing" note: posted, or refreshed for a new run. The finalizer deletes it.
  const api = (args: string[]) => spawnSync("gh", ["api", ...args], { encoding: "utf8" });
  const listed = api([`repos/${opts.repo}/issues/${opts.pr}/comments`, "--paginate", "--jq", ".[] | {id, user: {login: .user.login}, body}"]);
  const note = (listed.stdout ?? "").split("\n").filter(Boolean).map((l) => z.object({ id: z.number(), user: z.object({ login: z.string() }), body: z.string() }).parse(JSON.parse(l))).find(isWorkingNote);

  // The default branch's branding, as every other comment uses; the defaults when it cannot be read.
  const look = (() => {
    try {
      const b = branding(loadPolicy(defaultBranchReader(repoRoot), ghFetch, null));

      return b.name === "Shepherd" && !b.avatarUrl ? DEFAULT_LOOK : { name: b.name, header: b.headers.swarm, image: b.avatarUrl || WORKING_IMAGE };
    } catch {
      return DEFAULT_LOOK;
    }
  })();

  const body = workingNote(opts.head ?? "", `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${opts.repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`, look);
  const posted = api(note ? ["-X", "PATCH", `repos/${opts.repo}/issues/comments/${note.id}`, "-f", `body=${body}`] : [`repos/${opts.repo}/issues/${opts.pr}/comments`, "-f", `body=${body}`]);

  if (posted.status !== 0) console.error(`could not post the note: ${posted.stderr.trim()}`);
} else if (command === "status" && sub) {
  const s = prStatus(orExit(() => prFacts(Number(sub))));

  for (const line of s.lines) console.log(line);
  console.log(`\nstage     ${s.stage}\nnext      ${s.next}`);
} else if (command === "review" && sub) {
  // The review runs in GitHub Actions, not here: a `/review` comment starts it, as one typed on the PR would.
  if (process.env.GITHUB_ACTIONS === "true") orExit(() => { throw new Error("shepherd review starts a review from a terminal; inside GitHub Actions the workflow already runs it"); });

  const since = new Date(Date.now() - 5_000).toISOString();
  const posted = spawnSync("gh", ["pr", "comment", sub, "--body", "/review"], { cwd: repoRoot, encoding: "utf8" });

  if (posted.status !== 0) orExit(() => { throw new Error(`could not comment on PR ${sub}: ${posted.stderr.trim()}`); });
  console.error(`commented /review on PR #${sub}; the review runs in GitHub Actions. Follow it with: shepherd status ${sub}`);
  // The comment starts the review's own run: the newest comment-started run since the comment is the one to follow.
  const Runs = z.array(z.object({ url: z.string(), createdAt: z.string(), event: z.string() }));
  let url = "";

  for (let i = 0; i < 20 && !url; i++) {
    Bun.sleepSync(3_000);
    const r = spawnSync("gh", ["run", "list", "--workflow", "shepherd.yml", "--event", "issue_comment", "--limit", "10", "--json", "url,createdAt,event"], { cwd: repoRoot, encoding: "utf8" });

    url = (r.status === 0 ? Runs.parse(JSON.parse(r.stdout)).find((x) => x.createdAt >= since)?.url : undefined) ?? "";
  }

  // Only the URL on stdout, so a script can open or pass it on.
  if (url) console.log(url);
  else console.error("no run for this PR yet: see the repository's Actions tab");
} else if (command === "config" && sub === "schema") {
  // The JSON Schema editors validate .shepherd/config.yml against; schema/config.json is this output.
  console.log(JSON.stringify(configJsonSchema(), null, 2));
} else if (command === "config" && sub === "validate") {
  validate();
} else if (command === "config" && sub === "explain") {
  const p = policy(opts["working-tree"]);

  // Each lens's skill directory on disk, for the skills, so none has to search for it (an agent's glob can skip
  // dot-directories such as .shepherd/): a pinned pack lens from its cached copy, a lens inside the repository from the
  // default branch, never the PR checkout. A team lens that resolves nowhere fails the command.
  if (opts.json) {
    const lenses = Object.fromEntries(Object.entries(p.lenses).map(([k, l]) => [k, { ...l, path: lensDir(l.value.skill) }]));
    const missing = Object.entries(lenses).filter(([, l]) => !l.path && l.scope !== "personal").map(([k, l]) => `lens ${k}: skill ${l.value.skill} not found${opts["working-tree"] ? "" : " on the default branch"}`);

    console.log(JSON.stringify({ ...p, lenses }, null, 2));

    for (const m of missing) console.error(m);

    if (missing.length) process.exitCode = 1;
  } else explain(p);
} else if (command === "branding") {
  // From the default branch, like the rest of the policy: a PR cannot restyle how its own review is posted.
  console.log(JSON.stringify(branding(policy(opts["working-tree"])), null, 2));
} else if (command === "summary" && sub) {
  // Swarm's summary comment, rendered from the round's JSON.
  const input = orExit(() => JSON.parse(readFileSync(sub, "utf8")));
  const b = branding(policy(opts["working-tree"]));
  const previous = opts.previous ? readFileSync(opts.previous, "utf8") : undefined;
  const fanoutFile = opts.fanout ?? process.env.SHEPHERD_FANOUT;

  if (opts.fanout && !existsSync(opts.fanout)) {
    console.error(`--fanout: no file at ${opts.fanout}`);
    process.exit(1);
  }

  const fanout = fanoutFile && existsSync(fanoutFile) ? orExit(() => JSON.parse(readFileSync(fanoutFile, "utf8"))) : undefined;

  // Read from the reviewed checkout, as inline does, so both place each suggestion on the same lines.
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  process.stdout.write(orExit(() => renderSummary(input, b.emoji, opts.body ? null : b.headers.swarm, previous, fanout, reviewThreads(), read, openThreads())));
} else if (command === "inline" && sub) {
  // Swarm's inline review, rendered from the same round JSON: the payload for POST /pulls/<n>/reviews.
  const input = orExit(() => JSON.parse(readFileSync(sub, "utf8")));
  const b = branding(policy(opts["working-tree"]));

  // The checkout is the reviewed head: suggestions are placed against its files, read from the working directory.
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

  // With --diff, a finding off the diff's hunks stays out of the review, which GitHub would reject whole.
  const diff = opts.diff ? readFileSync(opts.diff, "utf8") : undefined;
  const [commentable, removable] = diff === undefined ? [] : [commentableLines(diff), commentableLines(diff, "LEFT")];

  console.log(JSON.stringify(orExit(() => renderReview(input, b.emoji, b.headers.swarm, read, reviewThreads(), commentable, removable, openThreads())), null, 2));
} else if (command === "fanout") {
  // Swarm's first wave, dispatched in one message beside the router: correctness on the whole diff and every custom
  // lens whose applies_to matches a changed file, with its directory. The CLI lists them so no model skips one.
  const p = policy(opts["working-tree"]);
  const change = orExit(() => captureChange(repoRoot, opts.base));
  const custom = preview(p, change.files).lenses.flatMap((l) => (l.files.length ? [{ lens: l.name, scope: l.files, path: lensDir(p.lenses[l.name]!.value.skill), personal: l.scope === "personal" }] : []));

  const lenses = [{ lens: "correctness", scope: "full" as const, skill: "../review-correctness/SKILL.md" }, ...custom];

  const missing = custom.flatMap((l) => (!l.path && !l.personal ? [`lens ${l.lens}: not found${opts["working-tree"] ? "" : " on the default branch"}`] : []));

  console.log(JSON.stringify({ base_sha: change.base_sha, head_sha: change.head_sha, files: change.files, lenses }, null, 2));

  for (const m of missing) console.error(m);

  if (missing.length) process.exitCode = 1;
} else if (command === "preview") {
  const p = policy(opts["working-tree"]);
  const change = orExit(() => captureChange(repoRoot, opts.base));
  const plan = orExit(() => preview(p, change.files, opts.recipe));

  console.log(`changed   ${plan.files.length} file(s) against ${change.base_sha.slice(0, 7)}`);

  for (const l of plan.lenses) console.log(`lens      ${l.name.padEnd(18)} ${l.runs}${l.scope === "personal" ? " (personal preview, never posts)" : ""}`);

  for (const m of plan.models) console.log(`model     ${m.runner.padEnd(18)} ${m.model}  (${m.source})`);

  for (const c of plan.checks) console.log(`check     ${c}`);

  console.log(`fixes     ${plan.fixes}`);

  for (const f of plan.escalated) console.log(`escalate  ${f}: a person decides any change here`);

  console.log(`recipe    ${plan.recipe}: ${plan.steps.join(" > ")}${opts.recipe ? "" : " (what /shepherd runs under this fix mode)"}`);

  for (const w of plan.writes) console.log(`writes    ${w.step.padEnd(18)} ${w.writes}`);

  for (const u of plan.unavailable) console.log(`blocked   ${u}`);

  console.log(`completes ${plan.unavailable.length ? "cannot run under this policy" : plan.completes}`);
} else if (command === "doctor") {
  const checks = doctor(BUNDLE_ROOT, homedir(), repoRoot, orExit(personal));

  if (opts.json) console.log(JSON.stringify(checks, null, 2));
  else for (const c of checks) console.log(`${c.status.padEnd(5)} ${c.check.padEnd(28)} ${c.detail}${c.fix ? `\n${"".padEnd(34)} -> ${c.fix}` : ""}`);

  if (checks.some((c) => c.status === "fail")) process.exitCode = 1;
} else if (command === "eval" && sub === "run" && skillRef && rest.length && opts.config) {
  // Each case reviewed in a fresh copy of its head, so no PR comment can reach the reviewer; one file per run, in a
  // directory of this invocation's own, so a later run never overwrites an earlier one.
  const casesDir = path.resolve(skillRef);
  const cases = orExit(() => loadCases(casesDir));
  const caseRoot = execFileSync("git", ["-C", casesDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const out = path.resolve(opts.out ?? path.join(repoRoot, "evals", "runs"), opts.config.replace(/[^\w.-]/g, "_"), new Date().toISOString().replace(/[:.]/g, "-"));

  const commit = (() => {
    try {
      return execFileSync("git", ["-C", BUNDLE_ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "unknown";
    }
  })();

  mkdirSync(out, { recursive: true });

  for (const c of cases) {
    for (let n = 0; n < Number(opts.repeat); n++) {
      const scratch = mkdtempSync(path.join(tmpdir(), `shepherd-eval-${c.id}-`));
      const run = orExit(() => runCase(c, prepare(c, caseRoot, scratch), rest, { config: opts.config!, run: n, shepherd: `${bundleVersion()}@${commit} skills:${treeHash(path.join(BUNDLE_ROOT, "skills"))}` }));

      writeFileSync(path.join(out, `${c.id}-${n}.json`), `${JSON.stringify(run, null, 2)}\n`);
      console.log(`${run.status.padEnd(10)} ${c.id} #${n}  ${run.findings.length} finding(s)  ${(run.duration_ms / 1000).toFixed(0)}s${run.cost_usd === null ? "" : `  $${run.cost_usd.toFixed(2)}`}${run.reason ? `  ${run.reason}` : ""}`);
    }
  }
} else if (command === "eval" && sub === "export" && skillRef && rest[0]) {
  // One case as a repository another reviewer can review as a PR: main at its base, pr at its head.
  const casesDir = path.resolve(opts.cases ?? path.join(repoRoot, "evals", "cases"));
  const c = orExit(() => loadCases(casesDir).find((x) => x.id === skillRef) ?? (() => { throw new Error(`no case ${skillRef} under ${casesDir}`); })());
  const caseRoot = execFileSync("git", ["-C", casesDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const done = orExit(() => exportCase(c, caseRoot, path.resolve(rest[0]!)));

  console.log(`${done.tree}: main at ${done.base.slice(0, 7)}, pr at ${done.head.slice(0, 7)}. Push both, open pr against main, then: shepherd eval import ${c.id} <comments.json> --config <label> --login <reviewer-login>`);
} else if (command === "eval" && sub === "import" && skillRef && rest[0] && opts.config && opts.login) {
  // Another reviewer's inline comments on an exported case PR, scored by eval score beside shepherd's runs.
  const cases = orExit(() => loadCases(path.resolve(opts.cases ?? path.join(repoRoot, "evals", "cases"))));
  const c = cases.find((x) => x.id === skillRef) ?? orExit(() => { throw new Error(`no case ${skillRef}`); });
  const out = path.resolve(opts.out ?? path.join(repoRoot, "evals", "runs"), opts.config.replace(/[^\w.-]/g, "_"), "imported");
  // Each import is the next run of this case: one more review, never a replacement for an earlier one.
  const n = existsSync(out) ? readdirSync(out).filter((f) => f.startsWith(`${c.id}-`) && /^\d+\.json$/.test(f.slice(c.id.length + 1))).length : 0;

  const run = orExit(() =>
    importRun(c, PostedComments.parse(JSON.parse(readFileSync(rest[0]!, "utf8"))), { config: opts.config!, run: n, login: opts.login!, cost_usd: opts.cost === undefined ? null : Number(opts.cost), duration_ms: Number(opts["duration-ms"] ?? 0) }),
  );

  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${c.id}-${n}.json`), `${JSON.stringify(run, null, 2)}\n`);
  console.log(`imported ${run.findings.length} finding(s) by ${opts.login} as ${path.join(out, `${c.id}-${n}.json`)}`);
} else if (command === "eval" && sub === "score" && skillRef) {
  const cases = orExit(() => loadCases(path.resolve(opts.cases ?? path.join(repoRoot, "evals", "cases"))));
  const rows = orExit(() => scoreRuns(cases, loadRuns(path.resolve(skillRef))));
  const choice = pick(rows);
  const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(0)}%`);

  if (opts.json) console.log(JSON.stringify({ rows, pick: choice }, null, 2));
  else {
    console.log(`${"split".padEnd(8)} ${"config".padEnd(24)} ${"runs".padStart(4)} ${"incomplete".padStart(10)} ${"recall".padStart(6)} ${"precision".padStart(9)} ${"fp".padStart(4)} ${"near".padStart(4)} ${"dup".padStart(4)} ${"cost".padStart(7)} ${"time".padStart(6)}`);

    for (const r of rows) console.log(`${r.split.padEnd(8)} ${r.config.padEnd(24)} ${String(r.runs).padStart(4)} ${String(r.not_complete).padStart(10)} ${pct(r.recall).padStart(6)} ${pct(r.precision).padStart(9)} ${String(r.false_positives).padStart(4)} ${String(r.near_misses).padStart(4)} ${String(r.duplicates).padStart(4)} ${(r.cost_usd === null ? "-" : `$${r.cost_usd.toFixed(2)}`).padStart(7)} ${(r.duration_ms === null ? "-" : `${(r.duration_ms / 1000).toFixed(0)}s`).padStart(6)}`);

    console.log(`\npick: ${choice.config ?? "none"} (${choice.reason})`);
  }
} else if (command === "acceptance" && (sub === "suggest" || sub === "local") && skillRef) {
  const threads = opts.pr ? ghThreads(Number(opts.pr)) : () => [];
  const before = orExit(() => snapshot(repoRoot, threads));
  const run = spawnSync(skillRef, rest, { cwd: repoRoot, stdio: "inherit" });
  const problems = orExit(() => verdict(repoRoot, sub, before, snapshot(repoRoot, threads, before.targets)));

  // A run that never finished proves nothing: an unchanged tree is what a missing binary leaves too.
  const crashed = run.error ? `the agent did not start: ${run.error.message}` : run.status !== 0 ? `the agent ${run.signal ? `was killed by ${run.signal}` : `exited ${run.status}`}` : null;

  for (const m of problems) console.log(`fail: ${m}`);

  if (crashed) console.log(`error: ${crashed}`);
  console.log(problems.length ? `failed fixes.mode ${sub}` : crashed ? "inconclusive: the agent did not finish" : `ok: the run kept to fixes.mode ${sub}`);
  process.exitCode = problems.length ? 1 : crashed ? 2 : 0;
} else if (command === "help" || !command) {
  console.log(opts.all ? USAGE : HELP);
} else {
  const known = USAGE.split("\n").filter((l) => l.trim().startsWith(`shepherd ${command} `) || l.trim() === `shepherd ${command}`);

  console.error(known.length ? `usage:\n${known.join("\n")}` : `unknown command: ${command}\n\n${HELP}`);
  process.exit(2);
}

/** What `shepherd status` folds into a stage: the PR, the gate's latest verdict, the `shepherd` status and CI on the head. */
function prFacts(pr: number): PrFacts {
  const run = (args: string[]) => {
    const r = spawnSync("gh", args, { cwd: repoRoot, encoding: "utf8" });

    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${r.stderr.trim()}`);

    return JSON.parse(r.stdout || "null");
  };

  const view = z.object({ state: z.string(), headRefOid: z.string(), baseRefName: z.string(), url: z.string() }).parse(run(["pr", "view", String(pr), "--json", "state,headRefOid,baseRefName,url"]));
  const head = view.headRefOid;
  const repo = z.string().parse(run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner | tojson"]));
  const reviews = listReviews(repo, pr, repoRoot);
  // A person's latest approving or blocking review stands until they review again; a comment changes nothing.
  const latestByPerson = new Map(reviews.filter((r) => !r.user.login.endsWith("[bot]") && /^(APPROVED|CHANGES_REQUESTED|DISMISSED)$/.test(r.state)).map((r) => [r.user.login, r.state]));

  // Commit statuses, latest per context: shepherd's own, and CI that reports outside Actions.
  const statuses = z.array(z.object({ context: z.string(), state: z.string(), description: z.string().nullable(), target_url: z.string().nullable() })).parse(run(["api", `repos/${repo}/commits/${head}/status`, "--jq", ".statuses"]));
  const own = statuses.find((s) => s.context === "shepherd");
  const external = statuses.flatMap((s) => (s.context === "shepherd" || s.context === LEDGER_CONTEXT ? [] : [{ name: s.context, status: s.state === "pending" ? "in_progress" : "completed", conclusion: s.state === "error" ? "failure" : s.state, url: s.target_url ?? "" }]));

  // Actions by workflow, newest run each; other apps' check runs (Actions' own are its jobs, already counted).
  const runs = z.array(z.object({ workflowName: z.string(), status: z.string(), conclusion: z.string(), url: z.string() })).parse(run(["run", "list", "--commit", head, "--json", "workflowName,status,conclusion,url"]));
  const workflows = runs.filter((r, i) => runs.findIndex((o) => o.workflowName === r.workflowName) === i);
  const checks = z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable(), html_url: z.string().nullable(), app: z.object({ slug: z.string() }).nullable() })).parse(run(["api", `repos/${repo}/commits/${head}/check-runs?per_page=100`, "--jq", ".check_runs"]));
  const otherApps = checks.flatMap((c) => (c.app?.slug === "github-actions" ? [] : [{ name: c.name, status: c.status, conclusion: c.conclusion ?? "", url: c.html_url ?? "" }]));

  // The gate keeps an approval across a push that leaves the PR's diff byte-identical, without a new review: check
  // the same thing it checks, so a kept approval reads as current and a stale one does not.
  const verdict = latestVerdict(reviews);

  const kept = verdict?.verdict === "APPROVED" && !head.startsWith(verdict.head) && verdict.base !== "" && !verdict.evidenceUnseen && (() => {
    try {
      return approvedDiffUnchanged(compareDiff(repo, verdict.base, verdict.head, repoRoot), compareDiff(repo, view.baseRefName, head, repoRoot));
    } catch {
      return false;
    }
  })();

  const threads = prThreads(repo, pr, repoRoot);

  return {
    pr,
    state: view.state,
    head,
    url: view.url,
    gate: verdict && { verdict: verdict.verdict, head: verdict.head, kept },
    shepherd: own && { state: own.state, description: own.description ?? "" },
    changesRequested: [...latestByPerson].flatMap(([login, state]) => (state === "CHANGES_REQUESTED" ? [login] : [])),
    openThreads: threads.filter((t) => !t.isResolved).length,
    runs: [...workflows.map((r) => ({ name: r.workflowName, status: r.status, conclusion: r.conclusion, url: r.url })), ...otherApps, ...external],
  };
}

function trackedFiles(): string[] {
  try {
    return execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function workingTree(rel: string): string | null {
  const file = path.join(repoRoot, rel);

  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function personal(): Config | null {
  const file = globalLensFile(homedir());

  return existsSync(file) ? ConfigSchema.parse(parseYaml(readFileSync(file, "utf8")) ?? {}) : null;
}

/**
 * Add a starter lens for each detected stack the effective team policy lacks. A lens a pack provides, or the
 * file declares, is kept as it is: its skill, scope and gate are the team's.
 */
function addStackLenses(file: string): void {
  const have = policy(true).lenses;
  const stacks = detectStacks(trackedFiles(), workingTree);

  for (const s of stacks) {
    const lens = have[s];

    if (lens?.scope === "team") {
      console.log(`lens ${s}: kept, from ${lens.source}`);
      continue;
    }

    orExit(() => addLens(file, s, stackLens(repoRoot, s)));
    console.log(`lens ${s}: .shepherd/lenses/${s} from the ${s} starter; trim its rules with only or disable`);
  }

  if (!stacks.length) console.log("no stack detected");
  pstackHint("pstack" in have);
}

/** pstack installed here: its principles are a lens away, so reviews check what its agents are told to do. */
function pstackHint(declared: boolean): void {
  if (!declared && pluginRoots(homedir()).has("pstack")) console.log("pstack is installed: review against its principles with shepherd lens new pstack --from pstack");
}

/** Team policy from the default branch, the source swarm reviews under, or from your working tree. */
function policy(fromTree: boolean) {
  const read: Read = fromTree ? workingTree : orExit(() => defaultBranchReader(repoRoot));

  const p = orExit(() => loadPolicy(read, ghFetch, personal()));

  orExit(() => fetchPackLenses(p, homedir(), ghFetchDir));

  return p;
}

/** A lens's skill directory: inside the repository, the default branch's copy unless --working-tree asks for yours. */
function lensDir(skill: string): string | null {
  const inRepo = (rel: string) => !rel.startsWith("..") && !path.isAbsolute(rel);

  // A bare name walks the skills directories in order, the repository's as the default branch has them: a PR can
  // neither delete the team's lens nor shadow it with one of its own.
  if (!opts["working-tree"] && !/[/:]/.test(skill)) {
    for (const d of skillDirs(homedir(), repoRoot)) {
      const rel = path.relative(repoRoot, d);
      const found = inRepo(rel) ? orExit(() => defaultBranchDir(repoRoot, path.join(rel, skill))) : existsSync(path.join(d, skill, "SKILL.md")) ? path.join(d, skill) : null;

      if (found) return found;
    }

    return null;
  }

  const dir = resolveSkill(skill, homedir(), repoRoot);
  const rel = dir ? path.relative(repoRoot, dir) : /^[^~/][^:]*\//.test(skill) ? path.normalize(skill) : null; // a repository path the checkout may lack

  if (opts["working-tree"] || rel === null || !inRepo(rel)) return dir;

  return orExit(() => defaultBranchDir(repoRoot, rel));
}

function choice(p: Effective) {
  return { ladder: p.ladder?.value ?? null, models: Object.fromEntries(Object.entries(p.models).map(([k, v]) => [k, v.value])) };
}

/** The working tree's policy, as you are about to merge it: every problem on one line, exit 1 if any. */
function validate(): void {
  const p = policy(true);

  const problems = [
    ...policyProblems(p),
    ...Object.entries(p.lenses).flatMap(([name, l]) => lensProblems(l.value, homedir(), repoRoot).map((m) => `lens ${name}: ${m}`)),
    ...(workingTree(TEAM_FILES[0]!) && workingTree(TEAM_FILES[1]!) ? [`${TEAM_FILES[1]} is ignored while ${TEAM_FILES[0]} exists; move its settings over and delete it`] : []),
  ];

  for (const m of [...problems, ...p.ignored]) console.log(`problem: ${m}`);

  if (problems.length) process.exitCode = 1;
  else console.log(`ok: ${p.teamFile ?? "no team policy file, built-in defaults"}`);
}

function explain(p: Effective & { teamFile: string | null }): void {
  const row = (key: string, value: string, source: string) => console.log(`${key.padEnd(24)} ${value.padEnd(48)} ${source}`);

  console.log(`policy file: ${p.teamFile ?? "none (built-in defaults)"}${opts["working-tree"] ? ", working tree" : ", default branch"}\n`);
  row("fixes.mode", p.fixes.value.mode, p.fixes.source);

  for (const [k, v] of Object.entries(p.tiers)) row(`tiers.${k}`, v.value, v.source);

  row("ladder", p.ladder?.value.join(" -> ") ?? "the harness's own", p.ladder?.source ?? "built-in");

  for (const [k, v] of Object.entries(p.models)) row(`models.${k}`, v.value, v.source);

  for (const [k, v] of Object.entries(p.lenses)) row(`lenses.${k}`, `${v.value.skill} [${v.value.applies_to?.join(", ") ?? "router picks"}]`, v.scope === "personal" ? "personal (preview, never posts)" : v.source);

  for (const [k, v] of Object.entries(p.checks)) row(`checks.${k}`, v.value.command, v.source);

  if (!Object.keys(p.checks).length) row("checks", "discovered by swarm from the repo's config", "built-in");

  if (p.escalate) row("escalate.paths", p.escalate.value.paths.join(", "), p.escalate.source);

  for (const [k, v] of Object.entries(p.recipes)) row(`recipes.${k}`, v.value.steps.join(" > "), v.source);

  // CI settings with where each came from; secrets only as set or unset, from this shell's environment.
  for (const [k, v] of Object.entries(ciSettings(p, process.env))) row(`ci.${k}`, v.value || "(none)", v.source === "variable" ? `variable ${v.variable}` : v.source);

  for (const name of SECRETS) row(name, process.env[name] ? "set" : "unset", "secret");

  for (const m of p.ignored) console.log(`\nignored: ${m}`);
}
