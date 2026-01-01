// Copies (or links) the bundled skills and commands into an agent's skills directory.
// A destination this installer did not create is never replaced without --force: it
// may be the user's own skill that happens to share a name.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MARKER = ".shepherd-installed";

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
