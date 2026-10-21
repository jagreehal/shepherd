// Copies (or links) the bundled skills and commands into an agent's skills directory.
// A destination this installer did not create is never replaced without --force: it
// may be the user's own skill that happens to share a name.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const MARKER = ".shepherd-installed";

/** A workflow template with every `SHEPHERD_VERSION:` pin set to `version`, so each job runs the CLI that wrote it. */
export const pinWorkflow = (text: string, version: string) => text.replaceAll(/SHEPHERD_VERSION: \S+/g, `SHEPHERD_VERSION: ${version}`);

/** Run the model job in a GitHub environment, so model keys stored as its secrets reach that job and no other. */
export function environmentWorkflow(text: string, name: string): string {
  // The name lands in YAML: refuse anything that could end the scalar or start a new key.
  if (!/^[\w.-]+$/.test(name)) throw new Error(`--environment "${name}": use letters, digits, ".", "_" and "-"`);

  return text.replaceAll(/^( +)# environment: <name>.*$/gm, `$1environment: ${name} # the model keys are this environment's secrets: no other job reads them`);
}

/**
 * A workflow rewritten from its current template, keeping what the installer or the team chose in the old copy: the
 * model job's environment and the `workflows:` list naming their CI. Everything else is the template's.
 */
export function upgradeWorkflow(template: string, existing: string, version: string, environment?: string) {
  const kept: string[] = [];

  // Read as YAML, not by pattern: a quoted environment or a multiline workflows list is just as valid, and losing
  // either takes the model's keys away or stops reviews. Anything this cannot carry over refuses the upgrade.
  const old = z
    .object({
      on: z.object({ workflow_run: z.object({ workflows: z.array(z.string()).min(1) }).optional() }).optional(),
      jobs: z.record(z.string(), z.object({ environment: z.union([z.string(), z.object({ name: z.string() }).transform((e) => e.name)]).optional() })),
    })
    .safeParse(parse(existing));

  if (!old.success) throw new Error(`cannot read its environment and workflows list (${old.error.issues[0]?.path.join(".")}): update it by hand`);

  const envs = [...new Set(Object.values(old.data.jobs).flatMap((j) => (j.environment === undefined ? [] : [j.environment])))];

  if (!environment && envs.length > 1) throw new Error(`its jobs use different environments (${envs.join(", ")}): update it by hand`);

  const env = environment ?? envs[0];
  let text = pinWorkflow(template, version);

  if (env) {
    text = environmentWorkflow(text, env);
    kept.push(`environment ${env}`);
  }

  const workflows = old.data.on?.workflow_run?.workflows;

  if (workflows && /^ +workflows: \[.*\]\s*$/m.test(text)) {
    const list = `[${workflows.map((w) => (/^[\w.-]+$/.test(w) ? w : JSON.stringify(w))).join(", ")}]`;

    text = text.replace(/^( +workflows: )\[.*\]\s*$/m, `$1${list}`);
    kept.push(`workflows ${list}`);
  }

  return { text, kept };
}

// Command files are single files, so they carry the marker as a comment line instead.
const COMMAND_MARKER = "<!-- shepherd-installed -->";

export type Outcome = { name: string; dest: string; action: "installed" | "replaced" | "skipped" | "removed" };

export const bundledSkills = (skillsRoot: string) =>
  readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(skillsRoot, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();

/** True when `dest` came from this installer: a link into our bundle, or a copy carrying our marker. */
function ours(dest: string, bundleRoot: string): boolean {
  const stat = lstatSync(dest, { throwIfNoEntry: false });

  if (!stat) return false;

  if (stat.isSymbolicLink()) return path.resolve(path.dirname(dest), readlinkSync(dest)).startsWith(path.resolve(bundleRoot) + path.sep);

  return stat.isDirectory() ? existsSync(path.join(dest, MARKER)) : readFileSync(dest, "utf8").includes(COMMAND_MARKER);
}

function place(src: string, dest: string, bundleRoot: string, link: boolean, force: boolean): Outcome["action"] {
  const present = lstatSync(dest, { throwIfNoEntry: false }) !== undefined;

  if (present && !ours(dest, bundleRoot) && !force) return "skipped";

  if (present) rmSync(dest, { recursive: true, force: true });

  mkdirSync(path.dirname(dest), { recursive: true });

  if (link) symlinkSync(src, dest);
  else {
    cpSync(src, dest, { recursive: true });

    if (lstatSync(dest).isDirectory()) writeFileSync(path.join(dest, MARKER), "installed by @jagreehal/shepherd; safe to delete with `shepherd uninstall`\n");
  }

  return present ? "replaced" : "installed";
}

/** Install every bundled skill into `skillsDest`, and every command into `commandsDest` when given. */
export function install(bundleRoot: string, skillsDest: string, commandsDest: string | null, link: boolean, force: boolean): Outcome[] {
  const skillsRoot = path.join(bundleRoot, "skills");

  const outcomes = bundledSkills(skillsRoot).map((name) => {
    const dest = path.join(skillsDest, name);

    return { name, dest, action: place(path.join(skillsRoot, name), dest, bundleRoot, link, force) };
  });

  if (commandsDest === null) return outcomes;
  const commandsRoot = path.join(bundleRoot, "commands");

  for (const file of existsSync(commandsRoot) ? readdirSync(commandsRoot).filter((f) => f.endsWith(".md")) : []) {
    const dest = path.join(commandsDest, file);
    outcomes.push({ name: `/${path.basename(file, ".md")}`, dest, action: place(path.join(commandsRoot, file), dest, bundleRoot, link, force) });
  }

  return outcomes;
}

/** Remove what this installer placed; anything else with a bundled name stays. */
export function uninstall(bundleRoot: string, skillsDest: string, commandsDest: string | null): Outcome[] {
  const targets = bundledSkills(path.join(bundleRoot, "skills")).map((name) => ({ name, dest: path.join(skillsDest, name) }));
  const commandsRoot = path.join(bundleRoot, "commands");

  if (commandsDest !== null && existsSync(commandsRoot)) {
    for (const file of readdirSync(commandsRoot).filter((f) => f.endsWith(".md"))) targets.push({ name: `/${path.basename(file, ".md")}`, dest: path.join(commandsDest, file) });
  }

  return targets.map(({ name, dest }) => {
    if (!ours(dest, bundleRoot)) return { name, dest, action: "skipped" as const };
    rmSync(dest, { recursive: true, force: true });

    return { name, dest, action: "removed" as const };
  });
}
