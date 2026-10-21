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
// shepherd init [--preset review-only|local-fix|push] [--from <pack>] [--stacks]  (scaffold .shepherd/config.yml)
// shepherd config validate                          (the working tree's policy: exits 1 on a problem)
// shepherd config explain [--json] [--working-tree] (effective policy and where each setting came from)
// shepherd preview [--recipe <name>] [--base <ref>] [--working-tree]  (what would run on your change)
// shepherd doctor [--json]                          (is this machine and repository set up? each problem says what to do)
// shepherd acceptance <suggest|local> [--pr <n>] -- <agent command>...  (run it; check it kept to the mode)
// shepherd trace event <stage> <start|end> --pr <n> [--round <n>] [--outcome ok|failed|skipped] [--retries <n>] [--head <sha>]
// shepherd stack <pr>                              (JSON: a stacked parent and the range to review, or a wrong base)
// shepherd workflows [--audit]                     (copy the shepherd and incident workflows, and the audit one, into .github/workflows)
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";
import { CI_DEFAULT_MODEL, ciModel, type Config, ConfigSchema, defaultBranchReader, type Effective, fetchPackLenses, ghFetch, ghFetchDir, loadPolicy, policyProblems, PRESETS, preview, type Read, TEAM_FILES } from "./config.ts";
import { ghThreads, snapshot, verdict } from "./acceptance.ts";
import { doctor } from "./doctor.ts";
import { fileLedger, notify, notifyOn, STATES, statusLedger } from "./notify.ts";
import { collect, collectEscapes, score } from "./garden.ts";
import { collectTraces, tempoHeaders, traceLimits, traceScores } from "./garden-traces.ts";
import { install, type Outcome, pinWorkflow, uninstall } from "./install.ts";
import { buildDemo, captureChange, demoBugs, finish, receiptStatus } from "./local.ts";
import { prStack } from "./stack.ts";
import { flush, recordEvent, traceFile } from "./trace.ts";
import { addLens, BUILT_IN_LENSES, pluginRoots, lensTemplates, globalLensFile, lensProblems, newLens, opencodeAgents, opencodeModel, providerKeyEnv, setTier, detectStacks, stackLens, pinModel, repoLensFile, resolveSkill, setLadder, skillDescription, type Lens } from "./lens.ts";

const BUNDLE_ROOT = path.resolve(import.meta.dir, "..");

const USAGE = `usage: shepherd install   [--project | --target <dir>] [--link] [--force]
       shepherd uninstall [--project | --target <dir>]
       shepherd lens new <name> [--from <template>] [--applies <glob>]... [--description <text>]
       shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
       shepherd lens list
       shepherd models [tier <name> <model> | ladder <model-or-tier>... | pin <runner-lens-or-group> <model-or-tier>] [--global]
       shepherd ci-models
       shepherd opencode-agents [--file <lenses.yml>]
       shepherd garden <owner/repo>... [--since YYYY-MM-DD] [--min-prs <n>] [--traces <otlp.json>]... [--tempo-url <url>] [--trace-retries <n>] [--trace-wait-ms <ms>] [--trace-cost-usd <usd>]
       shepherd local change [--base <ref>]
       shepherd local finish <record.json> [--base <ref>]
       shepherd local status [--base <ref>]
       shepherd local demo [<dir>]
       shepherd init [--preset review-only|local-fix|push] [--from <pack>] [--stacks]
       shepherd config validate
       shepherd config explain [--json] [--working-tree]
       shepherd preview [--recipe <name>] [--base <ref>] [--working-tree]
       shepherd doctor [--json]
       shepherd acceptance <suggest|local> [--pr <n>] -- <agent command>...
       shepherd trace event <stage> <start|end> --pr <n> [--round <n>] [--outcome ok|failed|skipped] [--retries <n>] [--head <sha>]
       shepherd trace flush --pr <n> --repo <owner/repo> --head <sha> --outcome <how it ended> [--base <sha>] [--ci-run <id> --ci-attempt <n>] [--related <traceparent>]...
       shepherd stack <pr>
       shepherd model-id <provider:model | provider/model>
       shepherd workflows [--audit]
       shepherd notify --pr <n> --repo <owner/repo> --head <sha> --state success|failure|pending|error --file <description.txt>`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "boolean", default: false },
    target: { type: "string" },
    link: { type: "boolean", default: false }, // symlink instead of copy: for a local clone you edit, never for bunx
    force: { type: "boolean", default: false },
    name: { type: "string" },
    applies: { type: "string", multiple: true },
    description: { type: "string" },
    global: { type: "boolean", default: false },
    model: { type: "string" },
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
    "working-tree": { type: "boolean", default: false }, // explain, preview: your edits instead of the default branch
    recipe: { type: "string" },
    preset: { type: "string" }, // init: how far fixes go
    audit: { type: "boolean", default: false }, // workflows: also the scheduled OWASP playbook audit
    stacks: { type: "boolean", default: false }, // init: add a lens for each stack the repository uses
    pr: { type: "string" }, // acceptance: the PR whose threads must stay as they were; trace: the PR
    round: { type: "string" }, // trace: the quality-loop round
    outcome: { type: "string" }, // trace: how a step or iteration ended
    retries: { type: "string" },
    head: { type: "string" }, // trace, notify: the head SHA
    state: { type: "string" }, // notify: the commit status state just set
    repo: { type: "string" }, // trace flush: owner/repo
    "ci-run": { type: "string" },
    "ci-attempt": { type: "string" },
    related: { type: "string", multiple: true }, // trace flush: traceparent of a related trace, such as stamp's review
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

/** Print a lens error as one line and exit 1. */
const orExit = <T>(run: () => T): T => {
  try {
    return run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

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
} else if (command === "ci-models") {
  // Everything a workflow needs to run OpenCode on the team's models, read from the default branch: the session
  // model, the variable its key goes in, and the agents that carry the ladder and pins.
  const p = orExit(() => loadPolicy(orExit(() => defaultBranchReader(repoRoot)), ghFetch, null));
  const { model, source } = ciModel(p, process.env.SHEPHERD_MODEL || undefined);
  const session = opencodeModel(model);

  const opencode = opencodeAgents(choice(p));
  // Every key the plan's models read, so the workflow can drop the rest before the model runs.
  const keyEnvs = [...new Set([session, ...Object.values(opencode.agent).map((a) => a.model)].flatMap((m) => providerKeyEnv(m) ?? []))].sort();

  console.log(JSON.stringify({ model: session, source, key_env: providerKeyEnv(session), key_envs: keyEnvs, opencode }));
} else if (command === "model-id" && sub) {
  // A model id as OpenCode spells it, so stamp's provider:model spelling works in a local OpenCode run too.
  console.log(opencodeModel(sub));
} else if (command === "stack" && sub) {
  // Which diff to review: the delta over an open stacked parent, or nothing at all when the base is wrong.
  console.log(JSON.stringify(orExit(() => prStack(Number(sub), repoRoot)), null, 2));
} else if (command === "workflows") {
  const dest = path.join(repoRoot, ".github", "workflows");

  mkdirSync(dest, { recursive: true });

  for (const name of ["shepherd.yml", "shepherd-incident.yml", ...(opts.audit ? ["shepherd-audit.yml"] : [])]) {
    const to = path.join(dest, name);

    if (existsSync(to)) {
      console.log(`kept      .github/workflows/${name} (exists)`);
      continue;
    }

    // Pin the workflow to the version that wrote it, so its skills match this CLI.
    const version = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path.join(BUNDLE_ROOT, "package.json"), "utf8"))).version;

    writeFileSync(to, pinWorkflow(readFileSync(path.join(BUNDLE_ROOT, "templates", name), "utf8"), version));
    console.log(`wrote     .github/workflows/${name}`);
  }

  console.log("\nNext: name your CI workflow in each file's `workflows:` list, add the SHEPHERD_TOKEN and OPENCODE_API_KEY secrets, then merge.\nOptional: SHEPHERD_LABEL (handoff label), SHEPHERD_NOTIFY_WEBHOOK (Slack or any JSON endpoint).");
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

  console.log(`notify: ${await notify(process.env.SHEPHERD_NOTIFY_WEBHOOK, event, notifyOn(process.env.SHEPHERD_NOTIFY_ON), [fileLedger(repoRoot, pr), statusLedger(opts.repo ?? "", opts.head ?? "", repoRoot)])}`);
} else if (command === "init") {
  const file = path.join(repoRoot, TEAM_FILES[0]!);

  // With --stacks on an existing policy, add the detected stacks' lenses it lacks and keep everything else.
  if (existsSync(file) && opts.stacks) {
    addStackLenses(file);
    validate();
    console.log(MERGE_NOTE);
    process.exit(process.exitCode ?? 0);
  }

  if (existsSync(file)) orExit(() => { throw new Error(`${TEAM_FILES[0]} already exists; edit it, add stack lenses with shepherd init --stacks, then run shepherd config validate`); });
  const legacy = workingTree(TEAM_FILES[1]!);
  const seed = legacy ? orExit(() => ConfigSchema.parse(parseYaml(legacy) ?? {})) : { lenses: {} };
  // A new repository starts review-only. A migration keeps pushing, as it did, and says so in the file; a pack keeps the pack's mode.
  const preset = opts.preset ?? (opts.from || seed.fixes ? undefined : legacy ? "push" : "review-only");

  const mode = Object.entries(PRESETS).find(([name]) => name === preset)?.[1];

  if (preset && !mode) orExit(() => { throw new Error(`--preset is one of ${Object.keys(PRESETS).join(", ")}`); });
  const config: Config = { ...seed };

  if (opts.from) config.extends = [opts.from, ...(seed.extends ?? [])];

  if (mode) config.fixes = { mode };
  const stacks = detectStacks(trackedFiles(), workingTree);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# shepherd team policy. Presets: review-only (fixes.mode suggest), local-fix (local), push.\n${stringify(config)}`);
  console.log(`wrote ${TEAM_FILES[0]}${preset ? ` (preset ${preset})` : ""}${legacy ? ` from ${TEAM_FILES[1]} (delete it: ${TEAM_FILES[0]} now wins)` : ""}`);

  // After the file exists, so a pack named by --from counts as already providing its lenses.
  if (opts.stacks) addStackLenses(file);
  else {
    if (stacks.length) console.log(`detected ${stacks.join(", ")}: run shepherd init --stacks to add their lenses, or extend github:jagreehal/shepherd/packs/<stack>.yml@<sha>`);
    pstackHint("pstack" in policy(true).lenses);
  }

  const named = policy(true);

  if (!Object.keys(named.tiers).length && !named.ladder && !Object.keys(named.models).length) {
    console.log(`models: none named. Locally runners use your harness's models; in CI the session runs on ${CI_DEFAULT_MODEL}.\n  Name a cheap and a strong model, then give roles to them:\n    shepherd models tier fast <provider:model>\n    shepherd models tier smart <provider:model>\n    shepherd models ladder fast smart\n    shepherd models pin reviewers fast   (and: pin fixers smart, pin loop smart)`);
  }

  validate();
  console.log(`\nBefore you merge it:\n  shepherd config explain --working-tree   every setting and where it came from\n  shepherd preview --working-tree          what would run on your change, and what it can write\n${MERGE_NOTE}`);
} else if (command === "config" && sub === "validate") {
  validate();
} else if (command === "config" && sub === "explain") {
  const p = policy(opts["working-tree"]);

  // Each lens's skill directory on disk, for the skills: a pinned pack lens is read from its cached copy.
  if (opts.json) console.log(JSON.stringify({ ...p, lenses: Object.fromEntries(Object.entries(p.lenses).map(([k, l]) => [k, { ...l, path: resolveSkill(l.value.skill, homedir(), repoRoot) }])) }, null, 2));
  else explain(p);
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
} else {
  console.error(USAGE);
  process.exit(2);
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

  for (const m of p.ignored) console.log(`\nignored: ${m}`);
}
