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
//
// Default: skills to ~/.claude/skills, the /shepherd command to ~/.claude/commands.
// --project installs into ./.claude of the current repository instead.
// --target <dir> installs skills only, into any agent's skills directory (e.g. ~/.codex/skills, ./.agents/skills).
// A lens wraps any skill as a swarm reviewer: .shepherd/lenses.yml for the repository, --global for a
// personal preview that prints locally and never posts. Model ids pass straight to the harness's agent
// tool (`haiku` on Claude Code, `provider/model` on OpenCode); --model on a lens pins it to one.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { collect, score } from "./garden.ts";
import { install, uninstall, type Outcome } from "./install.ts";
import { buildDemo, captureChange, demoBugs, finish, receiptStatus } from "./local.ts";
import { addLens, BUILT_IN_LENSES, lensTemplates, catalog, defaultBranchLensFile, globalLensFile, lensProblems, modelChoice, newLens, opencodeAgents, pinModel, repoLensFile, resolveSkill, setLadder, skillDescription, type Lens } from "./lens.ts";

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
       shepherd local demo [<dir>]`;

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
    from: { type: "string" }, // lens new: start from a starter lens in lenses/
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

const MERGE_NOTE = "swarm reads the repository's lens file from the default branch: commit and merge it before it takes effect.";

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

  for (const [name, lens] of Object.entries(catalog(homedir(), repoRoot))) {
    const found = resolveSkill(lens.skill, homedir(), repoRoot);
    const about = lens.description ?? (found ? skillDescription(found) : null) ?? "";

    console.log(`${name.padEnd(18)} ${lens.scope === "personal" ? "personal preview  " : ""}${found ?? `MISSING ${lens.skill}`}  [${lens.applies_to?.join(", ") ?? "router picks"}]  ${about.slice(0, 80)}`);

    for (const p of lensProblems(lens, homedir(), repoRoot)) {
      console.log(`${"".padEnd(18)} problem: ${p}`);
      process.exitCode = 1;
    }
  }
} else if (command === "models" && (sub === undefined || (sub === "ladder" && skillRef) || (sub === "pin" && skillRef && rest.length === 1))) {
  const file = opts.global ? globalLensFile(homedir()) : repoLensFile(repoRoot);

  if (sub === "ladder") orExit(() => setLadder(file, [skillRef!, ...rest]));

  if (sub === "pin") orExit(() => pinModel(file, skillRef!, rest[0]!));
  const { ladder, models } = modelChoice(homedir(), repoRoot);

  console.log(`ladder  ${ladder?.join(" -> ") ?? "the harness's own (skills/shepherd/references/models.md)"}`);

  for (const [name, model] of Object.entries(models)) console.log(`pin     ${name.padEnd(18)} ${model}`);

  if (sub) console.log(`\nwritten to ${file}${opts.global ? "" : `\n${MERGE_NOTE}`}`);
} else if (command === "opencode-agents") {
  // The models come from the default branch, never the working tree: on a PR checkout that is PR content.
  const file = opts.file ? path.resolve(opts.file) : orExit(() => defaultBranchLensFile(repoRoot));

  console.log(JSON.stringify(opencodeAgents(orExit(() => modelChoice(homedir(), repoRoot, file)))));
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
} else {
  console.error(USAGE);
  process.exit(2);
}
