// Custom lenses: any skill, wrapped by swarm as a review-only reviewer whose `## Fix` section steers
// triage. This file reads and writes the lens files and finds skills on disk; swarm itself reads the
// repository's file from the default branch at review time (skills/swarm/references/custom-lenses.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

export const BUILT_IN_LENSES = ["correctness", "security", "simplicity", "maintainability", "slop"];

const LENS_NAME = /^[a-z][a-z0-9-]*$/;

const LensSchema = z
  .object({
    skill: z.string().min(1),
    applies_to: z.array(z.string().min(1)).optional(),
    description: z.string().min(1).optional(),
  })
  .strict();

const LensFileSchema = z.object({ lenses: z.record(z.string().regex(LENS_NAME), LensSchema).default({}) }).strict();

export type Lens = z.infer<typeof LensSchema>;

export const globalLensFile = (home: string) => path.join(home, ".config", "shepherd", "lenses.yml");

export const repoLensFile = (repoRoot: string) => path.join(repoRoot, ".shepherd", "lenses.yml");

export function readLenses(file: string): Record<string, Lens> {
  if (!existsSync(file)) return {};

  return LensFileSchema.parse(parse(readFileSync(file, "utf8")) ?? {}).lenses;
}

/** Add or replace one lens, keeping every other entry in the file. */
export function addLens(file: string, name: string, lens: Lens): void {
  if (!LENS_NAME.test(name)) throw new Error(`lens name "${name}" must be lowercase letters, digits, and dashes`);

  if (BUILT_IN_LENSES.includes(name)) throw new Error(`"${name}" is a built-in lens; pick another name`);
  const lenses = { ...readLenses(file), [name]: LensSchema.parse(lens) };

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringify({ lenses }));
}

/** What swarm will load. Repository lenses post and steer fixes; personal ones are a local preview. The repository wins on a name clash. */
export const catalog = (home: string, repoRoot: string) => {
  const tag = (lenses: Record<string, Lens>, scope: "repo" | "personal") => Object.fromEntries(Object.entries(lenses).map(([name, lens]) => [name, { ...lens, scope }]));

  return { ...tag(readLenses(globalLensFile(home)), "personal"), ...tag(readLenses(repoLensFile(repoRoot)), "repo") };
};

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

  if (!dir) return [`no SKILL.md found for "${lens.skill}"`];
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
export function newLens(repoRoot: string, name: string, lens: Omit<Lens, "skill">): string {
  const skill = path.posix.join(".shepherd", "lenses", name); // lenses.yml paths are posix on every OS
  const dir = path.join(repoRoot, skill);

  if (existsSync(dir)) throw new Error(`${skill} already exists`);
  addLens(repoLensFile(repoRoot), name, { skill, ...lens });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), lensTemplate(name, lens.description ?? `Reviews code against the team's ${name} rules.`));

  return dir;
}

/** The directory holding the skill's SKILL.md: a path against the repository, or a name in the usual skills directories. */
export function resolveSkill(ref: string, home: string, repoRoot: string): string | null {
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
