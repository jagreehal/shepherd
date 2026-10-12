#!/usr/bin/env bun
// shepherd install   [--project | --target <dir>] [--link] [--force]
// shepherd uninstall [--project | --target <dir>]
// shepherd lens new <name> [--from <template>] [--applies <glob>]... [--description <text>]   (templates: lenses/)
// shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
// shepherd lens list
// shepherd models [ladder <model>... | pin <lens-or-runner> <model>] [--global]
// shepherd opencode-agents [--file <lenses.yml>]   (agents for OpenCode 1.x, from the default branch's lenses.yml)
// shepherd garden <owner/repo>... [--since YYYY-MM-DD] [--min-prs <n>]
// shepherd local change [--base <ref>]              (the change before a PR: unpushed commits, staged, unstaged, untracked)
// shepherd local finish <record.json> [--base <ref>]  (check a local review against that change; complete writes a receipt)
// shepherd local status [--base <ref>]              (is the change on disk the one a complete review covered?)
// shepherd local demo [<dir>]                       (a repository with planted bugs to try /shepherd --local on)
// shepherd init [--preset review-only|local-fix|push] [--from <pack>]  (scaffold .shepherd/config.yml)
// shepherd config validate                          (the working tree's policy: exits 1 on a problem)
// shepherd config explain [--json] [--working-tree] (effective policy and where each setting came from)
// shepherd preview [--recipe <name>] [--base <ref>] [--working-tree]  (what would run on your change)
// shepherd doctor [--json]                          (is this machine and repository set up? each problem says what to do)
// shepherd acceptance <suggest|local> [--pr <n>] -- <agent command>...  (run it; check it kept to the mode)
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
import { type Config, ConfigSchema, defaultBranchReader, type Effective, fetchPackLenses, ghFetch, ghFetchDir, loadPolicy, policyProblems, PRESETS, preview, type Read, TEAM_FILES } from "./config.ts";
import { ghThreads, snapshot, verdict } from "./acceptance.ts";
import { doctor } from "./doctor.ts";
import { collect, score } from "./garden.ts";
import { install, uninstall, type Outcome } from "./install.ts";
import { buildDemo, captureChange, demoBugs, finish, receiptStatus } from "./local.ts";
import { addLens, BUILT_IN_LENSES, lensTemplates, globalLensFile, lensProblems, newLens, opencodeAgents, pinModel, repoLensFile, resolveSkill, setLadder, skillDescription, type Lens } from "./lens.ts";

const BUNDLE_ROOT = path.resolve(import.meta.dir, "..");

const USAGE = `usage: shepherd install   [--project | --target <dir>] [--link] [--force]
       shepherd uninstall [--project | --target <dir>]
       shepherd lens new <name> [--from <template>] [--applies <glob>]... [--description <text>]
       shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
       shepherd lens list
       shepherd models [ladder <model>... | pin <lens-or-runner> <model>] [--global]
       shepherd opencode-agents [--file <lenses.yml>]
       shepherd garden <owner/repo>... [--since YYYY-MM-DD] [--min-prs <n>]
       shepherd local change [--base <ref>]
       shepherd local finish <record.json> [--base <ref>]
       shepherd local status [--base <ref>]
       shepherd local demo [<dir>]
       shepherd init [--preset review-only|local-fix|push] [--from <pack>]
       shepherd config validate
       shepherd config explain [--json] [--working-tree]
       shepherd preview [--recipe <name>] [--base <ref>] [--working-tree]
       shepherd doctor [--json]
       shepherd acceptance <suggest|local> [--pr <n>] -- <agent command>...`;

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
    base: { type: "string" }, // local: the ref the change is measured from
    from: { type: "string" }, // lens new: a starter lens in lenses/; init: the pack to extend
    json: { type: "boolean", default: false },
    "working-tree": { type: "boolean", default: false }, // explain, preview: your edits instead of the default branch
    recipe: { type: "string" },
    preset: { type: "string" }, // init: how far fixes go
    pr: { type: "string" }, // acceptance: the PR whose threads must stay as they were
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
} else if (command === "models" && (sub === undefined || (sub === "ladder" && skillRef) || (sub === "pin" && skillRef && rest.length === 1))) {
  const file = opts.global ? globalLensFile(homedir()) : repoLensFile(repoRoot);

  if (sub === "ladder") orExit(() => setLadder(file, [skillRef!, ...rest]));

  if (sub === "pin") orExit(() => pinModel(file, skillRef!, rest[0]!));
  const { ladder, models } = choice(policy(true));

  console.log(`ladder  ${ladder?.join(" -> ") ?? "the harness's own (skills/shepherd/references/models.md)"}`);

  for (const [name, model] of Object.entries(models)) console.log(`pin     ${name.padEnd(18)} ${model}`);

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

  console.log(JSON.stringify(repos.map((repo) => ({ repo, since, ...score(orExit(() => collect(repo, since)), Number(opts["min-prs"])) })), null, 2));
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
} else if (command === "init") {
  const file = path.join(repoRoot, TEAM_FILES[0]!);

  if (existsSync(file)) orExit(() => { throw new Error(`${TEAM_FILES[0]} already exists; edit it, then run shepherd config validate`); });
  const legacy = workingTree(TEAM_FILES[1]!);
  const seed = legacy ? orExit(() => ConfigSchema.parse(parseYaml(legacy) ?? {})) : { lenses: {} };
  // A new repository starts review-only. A migration keeps pushing, as it did, and says so in the file; a pack keeps the pack's mode.
  const preset = opts.preset ?? (opts.from || seed.fixes ? undefined : legacy ? "push" : "review-only");

  const mode = Object.entries(PRESETS).find(([name]) => name === preset)?.[1];

  if (preset && !mode) orExit(() => { throw new Error(`--preset is one of ${Object.keys(PRESETS).join(", ")}`); });
  const config: Config = { ...seed };

  if (opts.from) config.extends = [opts.from, ...(seed.extends ?? [])];

  if (mode) config.fixes = { mode };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `# shepherd team policy. Presets: review-only (fixes.mode suggest), local-fix (local), push.\n${stringify(config)}`);
  console.log(`wrote ${TEAM_FILES[0]}${preset ? ` (preset ${preset})` : ""}${legacy ? ` from ${TEAM_FILES[1]} (delete it: ${TEAM_FILES[0]} now wins)` : ""}`);
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

function workingTree(rel: string): string | null {
  const file = path.join(repoRoot, rel);

  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function personal(): Config | null {
  const file = globalLensFile(homedir());

  return existsSync(file) ? ConfigSchema.parse(parseYaml(readFileSync(file, "utf8")) ?? {}) : null;
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
  row("ladder", p.ladder?.value.join(" -> ") ?? "the harness's own", p.ladder?.source ?? "built-in");

  for (const [k, v] of Object.entries(p.models)) row(`models.${k}`, v.value, v.source);

  for (const [k, v] of Object.entries(p.lenses)) row(`lenses.${k}`, `${v.value.skill} [${v.value.applies_to?.join(", ") ?? "router picks"}]`, v.scope === "personal" ? "personal (preview, never posts)" : v.source);

  for (const [k, v] of Object.entries(p.checks)) row(`checks.${k}`, v.value.command, v.source);

  if (!Object.keys(p.checks).length) row("checks", "discovered by swarm from the repo's config", "built-in");

  if (p.escalate) row("escalate.paths", p.escalate.value.paths.join(", "), p.escalate.source);

  for (const [k, v] of Object.entries(p.recipes)) row(`recipes.${k}`, v.value.steps.join(" > "), v.source);

  for (const m of p.ignored) console.log(`\nignored: ${m}`);
}
