// Custom lenses: any skill, wrapped by swarm as a review-only reviewer whose `## Fix` section steers
// triage. This file reads and writes the lens files and finds skills on disk; swarm itself reads the
// repository's file from the default branch at review time (skills/swarm/references/custom-lenses.md).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { type Config, ConfigSchema, type Lens, LensSchema, lensCache, ModelId, TEAM_FILES } from "./config.ts";

export const BUILT_IN_LENSES = ["correctness", "security", "simplicity", "maintainability", "slop", "spec"];

const LENS_NAME = /^[a-z][a-z0-9-]*$/;

// The lens file is the team policy file: lens commands write lenses, ladder and pins and keep every other key.
const LensFileSchema = ConfigSchema;

type LensFile = Config;

export type { Lens };

export const globalLensFile = (home: string) => path.join(home, ".config", "shepherd", "lenses.yml");

/** The repository's policy file: `.shepherd/config.yml`, or the older `.shepherd/lenses.yml` when only that exists. */
export const repoLensFile = (repoRoot: string) => {
  const [config, legacy] = TEAM_FILES.map((f) => path.join(repoRoot, f));

  return existsSync(config!) || !existsSync(legacy!) ? config! : legacy!;
};

const readFile = (file: string): LensFile => (existsSync(file) ? LensFileSchema.parse(parse(readFileSync(file, "utf8")) ?? {}) : { lenses: {} });

export const readLenses = (file: string): Record<string, Lens> => readFile(file).lenses;

/**
 * OpenCode agents for a harness whose subagent tool takes no model (OpenCode 1.x): one per rung,
 * `shepherd-r<i>`, and one per pin, `shepherd-pin-<name>`, each fixed to its model. Merge the result into
 * OPENCODE_CONFIG_CONTENT; swarm and the loop then dispatch by agent name.
 */
export function opencodeAgents(choice: { ladder: string[] | null; models: Record<string, string> }) {
  const agent = (model: string, about: string) => ({ mode: "subagent", model, description: `shepherd runner on ${model} (${about})` });

  return {
    agent: Object.fromEntries([
      ...(choice.ladder ?? []).map((model, i) => [`shepherd-r${i}`, agent(model, `rung ${i}`)] as const),
      ...Object.entries(choice.models).map(([name, model]) => [`shepherd-pin-${name}`, agent(model, `pinned for ${name}`)] as const),
    ]),
  };
}

/** Pin `name` (a lens or runner) to `model`, keeping everything else in the file. */
export function pinModel(file: string, name: string, model: string): void {
  if (!LENS_NAME.test(name)) throw new Error(`"${name}" must be lowercase letters, digits, and dashes`);
  const current = readFile(file);

  write(file, { ...current, models: { ...current.models, [name]: ModelId.parse(model) } });
}

/** Replace the ladder, cheapest model first. */
export function setLadder(file: string, ladder: string[]): void {
  write(file, { ...readFile(file), ladder: z.array(ModelId).min(1).parse(ladder) });
}

function write(file: string, contents: LensFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringify(contents));
}

/** Add or replace one lens, keeping every other entry in the file. */
export function addLens(file: string, name: string, lens: Lens): void {
  if (!LENS_NAME.test(name)) throw new Error(`lens name "${name}" must be lowercase letters, digits, and dashes`);

  if (BUILT_IN_LENSES.includes(name)) throw new Error(`"${name}" is a built-in lens; pick another name`);
  const current = readFile(file);

  write(file, { ...current, lenses: { ...current.lenses, [name]: LensSchema.parse(lens) } });
}

const lensTemplate = (name: string, description: string) => `---
${stringify({ name, description })}---

# ${name}

## Review

What to flag, most important first. Give each rule an id so findings read
\`[${name}/<id>]\`.

- **<id>**: <the rule>. Flag: <what breaking it looks like>. Why: <the cost>.

## Fix

How triage should fix a \`[${name}/...]\` finding. Optional; without it triage
fixes by its own rules. Nothing here can loosen shepherd's rules.

- Prefer: <the pattern or existing helper to reach for>.
- Never touch: <files or APIs a fix must leave alone>.
- Escalate: <changes that go to the author instead of being fixed>.
`;

const RULE_ID = /^- \*\*([a-z0-9][a-z0-9-]*)\*\*/gm;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** What would stop swarm or triage using a lens, one line each; empty when it is ready. Section rules apply to lenses under .shepherd/lenses/. */
export function lensProblems(lens: Lens, home: string, repoRoot: string): string[] {
  const dir = resolveSkill(lens.skill, home, repoRoot);

  if (!dir) return [lensCache(home, lens.skill) ? `"${lens.skill}" is not fetched yet: shepherd config explain fetches pinned pack lenses` : `no SKILL.md found for "${lens.skill}"`];
  const file = path.join(dir, "SKILL.md");
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const front = FRONTMATTER.exec(text)?.[1];
  const problems: string[] = [];

  if (front === undefined || !skillDescription(dir)) problems.push(`${file}: frontmatter needs a description`);

  if (!path.posix.normalize(lens.skill.replaceAll("\\", "/")).startsWith(".shepherd/lenses/")) return problems;
  const review = /^## Review\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1];

  if (review === undefined) return [...problems, `${file}: add a "## Review" section`];
  const ids = [...review.matchAll(RULE_ID)].map((m) => m[1]);

  if (ids.length === 0) problems.push(`${file}: "## Review" has no rules; write each as "- **<id>**: <rule>", the id lowercase with dashes`);

  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`${file}: rule id "${id}" is used more than once`);

  return problems;
}

/** Scaffold a lens skill at .shepherd/lenses/<name> and register it. Returns the skill directory. */
/** Starter lenses shipped with shepherd, copied into a repository by `lens new --from`. */
export const TEMPLATES_DIR = path.resolve(import.meta.dir, "..", "lenses");

export const lensTemplates = (): string[] => readdirSync(TEMPLATES_DIR).filter((d) => existsSync(path.join(TEMPLATES_DIR, d, "SKILL.md"))).sort();

/** A starter lens's SKILL.md, renamed to `name` so its findings read `[<name>/<id>]`. */
function fromTemplate(template: string, name: string): string {
  if (!lensTemplates().includes(template)) throw new Error(`no lens template "${template}"; available: ${lensTemplates().join(", ")}`);

  return readFileSync(path.join(TEMPLATES_DIR, template, "SKILL.md"), "utf8").replace(/^name: .*$/m, `name: ${name}`).replace(/^# .*$/m, `# ${name}`);
}

export function newLens(repoRoot: string, name: string, lens: Omit<Lens, "skill">, template?: string): string {
  const skill = path.posix.join(".shepherd", "lenses", name); // lenses.yml paths are posix on every OS
  const dir = path.join(repoRoot, skill);

  if (existsSync(dir)) throw new Error(`${skill} already exists`);
  const text = template ? fromTemplate(template, name) : lensTemplate(name, lens.description ?? `Reviews code against the team's ${name} rules.`);

  addLens(repoLensFile(repoRoot), name, { skill, ...lens });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), text);

  return dir;
}

/** The directory holding the skill's SKILL.md: a path against the repository, or a name in the usual skills directories. */
export function resolveSkill(ref: string, home: string, repoRoot: string): string | null {
  const pinned = lensCache(home, ref);

  if (pinned) return existsSync(path.join(pinned, "SKILL.md")) ? pinned : null;
  const expanded = ref.startsWith("~/") ? path.join(home, ref.slice(2)) : ref;

  const candidates = expanded.includes("/")
    ? [path.resolve(repoRoot, expanded)]
    : [".claude/skills", ".agents/skills", ".codex/skills"].map((d) => path.join(home, d, expanded)).concat([".claude/skills", ".agents/skills"].map((d) => path.join(repoRoot, d, expanded)));

  return candidates.find((dir) => existsSync(path.join(dir, "SKILL.md"))) ?? null;
}

/** The `description` from a skill's frontmatter, folded to one line. */
export function skillDescription(skillDir: string): string | null {
  const front = FRONTMATTER.exec(readFileSync(path.join(skillDir, "SKILL.md"), "utf8"))?.[1];

  if (front === undefined) return null;
  const parsed = z.object({ description: z.string() }).passthrough().safeParse(parse(front));

  return parsed.success ? parsed.data.description.replace(/\s+/g, " ").trim() : null;
}
