// Custom lenses: any skill, wrapped by swarm as a review-only reviewer. This file reads and writes
// the lens files and finds skills on disk; swarm itself reads the repository's file from the
// default branch at review time (skills/swarm/references/custom-lenses.md).
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

/** What swarm will load: your own lenses, then the repository's, which win on a name clash. */
export const catalog = (home: string, repoRoot: string) => ({ ...readLenses(globalLensFile(home)), ...readLenses(repoLensFile(repoRoot)) });

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
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path.join(skillDir, "SKILL.md"), "utf8"))?.[1];

  if (front === undefined) return null;
  const parsed = z.object({ description: z.string() }).passthrough().safeParse(parse(front));

  return parsed.success ? parsed.data.description.replace(/\s+/g, " ").trim() : null;
}
