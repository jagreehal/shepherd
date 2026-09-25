#!/usr/bin/env bun
// shepherd install   [--project | --target <dir>] [--link] [--force]
// shepherd uninstall [--project | --target <dir>]
// shepherd lens new <name> [--applies <glob>]... [--description <text>]
// shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
// shepherd lens list
//
// Default: skills to ~/.claude/skills, the /shepherd command to ~/.claude/commands.
// --project installs into ./.claude of the current repository instead.
// --target <dir> installs skills only, into any agent's skills directory (e.g. ~/.codex/skills, ./.agents/skills).
// A lens wraps any skill as a swarm reviewer: .shepherd/lenses.yml for the repository, --global for a
// personal preview that prints locally and never posts.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { install, uninstall, type Outcome } from "./install.ts";
import { addLens, BUILT_IN_LENSES, catalog, globalLensFile, lensProblems, newLens, repoLensFile, resolveSkill, skillDescription, type Lens } from "./lens.ts";

const BUNDLE_ROOT = path.resolve(import.meta.dir, "..");

const USAGE = `usage: shepherd install   [--project | --target <dir>] [--link] [--force]
       shepherd uninstall [--project | --target <dir>]
       shepherd lens new <name> [--applies <glob>]... [--description <text>]
       shepherd lens add <skill> [--name <name>] [--applies <glob>]... [--description <text>] [--global]
       shepherd lens list`;

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

const [command, sub, skillRef] = positionals;

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

  console.log("\nNext: in a repository with an open PR, run /shepherd <pr> (or /swarm, /triage, /ci-repair on their own).");
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
  console.log(`lens "${name}" -> ${found}\nwritten to ${file}`);

  console.log(opts.global ? "personal lens: swarm prints its findings locally and never posts them." : MERGE_NOTE);
} else if (command === "lens" && sub === "new" && skillRef) {
  const lens: Omit<Lens, "skill"> = {};

  if (opts.applies?.length) lens.applies_to = opts.applies;

  if (opts.description) lens.description = opts.description;
  const dir = orExit(() => newLens(repoRoot, skillRef, lens));

  console.log(`lens "${skillRef}" -> ${path.join(dir, "SKILL.md")}\nfill in its Review and Fix sections, try it with /swarm --preview, then: ${MERGE_NOTE}`);
} else if (command === "lens" && sub === "list") {
  for (const name of BUILT_IN_LENSES) console.log(`${name.padEnd(18)} built-in`);

  for (const [name, lens] of Object.entries(catalog(homedir(), repoRoot))) {
    const found = resolveSkill(lens.skill, homedir(), repoRoot);
    const about = lens.description ?? (found ? skillDescription(found) : null) ?? "";

    console.log(`${name.padEnd(18)} ${lens.scope === "personal" ? "personal preview  " : ""}${found ?? `MISSING ${lens.skill}`}  [${lens.applies_to?.join(", ") ?? "router picks"}]  ${about.slice(0, 80)}`);

    for (const p of lensProblems(lens, homedir(), repoRoot)) {
      console.log(`${"".padEnd(18)} problem: ${p}`);
      process.exitCode = 1;
    }
  }
} else {
  console.error(USAGE);
  process.exit(2);
}
