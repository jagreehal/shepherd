#!/usr/bin/env bun
// shepherd install   [--project | --target <dir>] [--link] [--force]
// shepherd uninstall [--project | --target <dir>]
//
// Default: skills to ~/.claude/skills, the /shepherd command to ~/.claude/commands.
// --project installs into ./.claude of the current repository instead.
// --target <dir> installs skills only, into any agent's skills directory (e.g. ~/.codex/skills, ./.agents/skills).
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { install, uninstall, type Outcome } from "./install.ts";

const BUNDLE_ROOT = path.resolve(import.meta.dir, "..");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "boolean", default: false },
    target: { type: "string" },
    link: { type: "boolean", default: false }, // symlink instead of copy: for a local clone you edit, never for bunx
    force: { type: "boolean", default: false },
  },
});

const base = opts.project ? path.join(process.cwd(), ".claude") : path.join(homedir(), ".claude");

const skillsDest = opts.target ? path.resolve(opts.target) : path.join(base, "skills");

const commandsDest = opts.target ? null : path.join(base, "commands");

const report = (outcomes: Outcome[]) => {
  for (const o of outcomes) console.log(`${o.action.padEnd(9)} ${o.name.padEnd(24)} ${o.dest}`);

  return outcomes.some((o) => o.action === "skipped");
};

if (positionals[0] === "install") {
  if (report(install(BUNDLE_ROOT, skillsDest, commandsDest, opts.link, opts.force))) {
    console.log("\nskipped: something this installer did not create is in the way; rerun with --force to replace it.");
  }

  console.log("\nNext: in a repository with an open PR, run /shepherd <pr> (or /swarm, /triage, /ci-repair on their own).");
} else if (positionals[0] === "uninstall") {
  report(uninstall(BUNDLE_ROOT, skillsDest, commandsDest));
} else {
  console.error("usage: shepherd install   [--project | --target <dir>] [--link] [--force]\n       shepherd uninstall [--project | --target <dir>]");
  process.exit(2);
}
