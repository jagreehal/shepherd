// Custom lenses: any skill, wrapped by swarm as a review-only reviewer whose `## Fix` section steers
// triage. This file reads and writes the lens files and finds skills on disk; swarm itself reads the
// repository's file from the default branch at review time (skills/swarm/references/custom-lenses.md).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { type Config, ConfigSchema, type Lens, LensSchema, lensCache, ModelId, SEVERITIES, TEAM_FILES } from "./config.ts";

type Severity = (typeof SEVERITIES)[number];

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

export const readLenses = (file: string) => readFile(file).lenses;

/**
 * OpenCode agents for a harness whose subagent tool takes no model (OpenCode 1.x): one per rung,
 * `shepherd-r<i>`, and one per pin, `shepherd-pin-<name>`, each fixed to its model. Merge the result into
 * OPENCODE_CONFIG_CONTENT; swarm and the loop then dispatch by agent name.
 */
export function opencodeAgents(choice: { ladder: string[] | null; models: Record<string, string> }) {
  const agent = (model: string, about: string) => ({ mode: "subagent", model: opencodeModel(model), description: `shepherd runner on ${model} (${about})` });

  return {
    agent: Object.fromEntries([
      ...(choice.ladder ?? []).map((model, i) => [`shepherd-r${i}`, agent(model, `rung ${i}`)] as const),
      ...Object.entries(choice.models).map(([name, model]) => [`shepherd-pin-${name}`, agent(model, `pinned for ${name}`)] as const),
    ]),
  };
}

// stamp's `provider:model` names where OpenCode's provider id differs; every other provider keeps its name.
const OPENCODE_PROVIDER = new Map([["bedrock", "amazon-bedrock"], ["vertex", "google-vertex"]]);

/**
 * A model id as OpenCode spells it. stamp's canonical `provider:model` (`bedrock:eu.anthropic.claude-…-v1:0`)
 * becomes `provider/model` (`amazon-bedrock/eu.anthropic.claude-…-v1:0`), so one ladder serves both tools.
 * An OpenCode id or a Claude Code alias passes through.
 */
export function opencodeModel(id: string): string {
  const m = /^([a-z][a-z0-9-]*):(.+)$/.exec(id);

  return m ? `${OPENCODE_PROVIDER.get(m[1]!) ?? m[1]}/${m[2]}` : id;
}

/** Pin `name` (a lens or runner) to `model`, keeping everything else in the file. */
export function pinModel(file: string, name: string, model: string): void {
  if (!LENS_NAME.test(name)) throw new Error(`"${name}" must be lowercase letters, digits, and dashes`);
  const current = readFile(file);

  write(file, { ...current, models: { ...current.models, [name]: ModelId.parse(model) } });
}

/** Name a model: `tier` becomes usable in the ladder and in pins, and swapping its model swaps it everywhere. */
export function setTier(file: string, tier: string, model: string): void {
  if (!LENS_NAME.test(tier)) throw new Error(`"${tier}" must be lowercase letters, digits, and dashes`);
  const current = readFile(file);

  write(file, { ...current, tiers: { ...current.tiers, [tier]: ModelId.parse(model) } });
}

// The environment variable each OpenCode provider reads its key from. SHEPHERD_API_KEY fills the one the session
// model's provider needs, so a single-provider team sets one secret.
const PROVIDER_KEY_ENV = new Map([
  ["opencode", "OPENCODE_API_KEY"],
  ["opencode-go", "OPENCODE_API_KEY"],
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["openrouter", "OPENROUTER_API_KEY"],
  ["deepseek", "DEEPSEEK_API_KEY"],
  ["groq", "GROQ_API_KEY"],
  ["mistral", "MISTRAL_API_KEY"],
  ["google", "GOOGLE_GENERATIVE_AI_API_KEY"],
  ["xai", "XAI_API_KEY"],
  ["amazon-bedrock", "AWS_BEARER_TOKEN_BEDROCK"],
]);

/** The key variable for an OpenCode model id's provider, or null when shepherd does not know it. */
export const providerKeyEnv = (opencodeId: string): string | null => PROVIDER_KEY_ENV.get(opencodeId.split("/")[0]!) ?? null;

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

// `- **<id>**: <rule>`, or `- **<id>** [refuse|escalate|note]: <rule>` to set that rule's severity for stamp.
const RULE = /^- \*\*([a-z0-9][a-z0-9-]*)\*\*(?: \[(refuse|escalate|note)\])?:/gm;

export type LensRule = { id: string; severity?: Severity };

/** The rules in a lens's `## Review` section, with any severity tag; null when the section is missing. */
export function reviewRules(text: string): LensRule[] | null {
  const review = /^## Review\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text.replace(/\r\n/g, "\n"))?.[1];

  if (review === undefined) return null;

  return [...review.matchAll(RULE)].map((m) => {
    const rule: LensRule = { id: m[1]! };
    const severity = z.enum(SEVERITIES).optional().parse(m[2]);

    if (severity) rule.severity = severity;

    return rule;
  });
}

/** Whether a lens entry's `only` and `disable` keep this rule. */
export const keepsRule = (lens: Pick<Lens, "only" | "disable">, id: string) => {
  const hit = (globs: string[]) => globs.some((g) => new Bun.Glob(g).match(id));

  return (!lens.only || hit(lens.only)) && !(lens.disable && hit(lens.disable));
};

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
  const ownLens = path.posix.normalize(lens.skill.replaceAll("\\", "/")).startsWith(".shepherd/lenses/");

  // Rule ids are required under .shepherd/lenses/, and wherever only or disable must match them.
  if (!ownLens && !lens.only && !lens.disable) return problems;
  const rules = reviewRules(text);

  if (rules === null) return [...problems, `${file}: add a "## Review" section`];
  const ids = rules.map((r) => r.id);

  if (ids.length === 0) problems.push(`${file}: "## Review" has no rules; write each as "- **<id>**: <rule>", the id lowercase with dashes`);

  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`${file}: rule id "${id}" is used more than once`);

  for (const g of [...(lens.only ?? []), ...(lens.disable ?? [])]) {
    if (!ids.some((id) => new Bun.Glob(g).match(id))) problems.push(`${file}: "${g}" in only or disable matches no rule id`);
  }

  if (ids.length && !ids.some((id) => keepsRule(lens, id))) problems.push(`${file}: only and disable leave no rule`);

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

/** The bundled packs (packs/<name>.yml): one starter lens each, with the files it applies to and its gate. */
export const PACKS_DIR = path.resolve(import.meta.dir, "..", "packs");

/** The lens entry a bundled pack declares for its own lens, minus the skill path. */
export function packLens(stack: string): Omit<Lens, "skill"> {
  const { skill: _, ...rest } = LensSchema.parse(ConfigSchema.parse(parse(readFileSync(path.join(PACKS_DIR, `${stack}.yml`), "utf8"))).lenses[stack]);

  return rest;
}

// A dependency in any package.json that marks a stack. next implies react: its pack extends react's.
const NPM_STACKS: [RegExp, string[]][] = [
  [/^next$/, ["react", "nextjs"]],
  [/^(react|react-dom)$/, ["react"]],
  [/^(express|fastify|hono|koa|@nestjs\/core)$/, ["node-api"]],
];

// A tracked file, anywhere in the repository, that marks a stack.
const FILE_STACKS: [RegExp, string][] = [
  [/(^|\/)go\.mod$/, "go"],
  [/(^|\/)Cargo\.toml$/, "rust"],
  [/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/, "java"],
  [/\.(csproj|fsproj|sln)$/, "dotnet"],
  [/(^|\/)(pyproject\.toml|setup\.py|requirements\.txt)$/, "python"],
  [/(^|\/)nx\.json$/, "nx-monorepo"],
];

const PackageJson = z.object({ dependencies: z.record(z.string(), z.string()).optional(), devDependencies: z.record(z.string(), z.string()).optional() });

/** JSON, or null when malformed: a broken package.json marks nothing. */
const parseJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The bundled stack packs this repository's tracked files point at, sorted by name. `files` is `git ls-files`. */
export function detectStacks(files: string[], read: (rel: string) => string | null): string[] {
  const found = new Set<string>();

  for (const f of files) {
    for (const [re, stack] of FILE_STACKS) if (re.test(f)) found.add(stack);

    if (!/(^|\/)package\.json$/.test(f)) continue;
    const pkg = PackageJson.safeParse(parseJson(read(f) ?? "{}"));
    const deps = pkg.success ? Object.keys({ ...pkg.data.dependencies, ...pkg.data.devDependencies }) : [];

    for (const [re, stacks] of NPM_STACKS) if (deps.some((d) => re.test(d))) for (const s of stacks) found.add(s);
  }

  // ASVS holds for every language, so any detected stack brings it.
  if (found.size) found.add("owasp-asvs");

  return lensTemplates().filter((t) => found.has(t));
}

// Claude Code's record of installed plugins, keyed `<plugin>@<marketplace>`.
const InstallRecord = z.object({ plugins: z.record(z.string(), z.array(z.object({ installPath: z.string() }))) });

// A skill an installed plugin ships, as Claude Code names it: `<plugin>:<skill>`, e.g. `pstack:principle-fix-root-causes`.
const PLUGIN_SKILL = /^([\w.-]+):([\w.-]+)$/;

const subdirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name)) : []);

/** The newest of a plugin's cached versions: harnesses keep old ones beside it until they prune. */
const newest = (dirs: string[]) => dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

/**
 * Each installed plugin's root, by plugin name: Claude Code's from its install record, Cursor's from its
 * plugin cache (`<marketplace>/<plugin>/<version>`) and local plugins. A plugin keeps its skills in `skills/`.
 */
export function pluginRoots(home: string): Map<string, string> {
  const roots = new Map<string, string>();
  const file = path.join(home, ".claude", "plugins", "installed_plugins.json");
  const record = InstallRecord.safeParse(existsSync(file) ? parseJson(readFileSync(file, "utf8")) : null);

  for (const [key, installs] of Object.entries(record.success ? record.data.plugins : {})) {
    const root = installs.at(-1)?.installPath;

    if (root) roots.set(key.split("@")[0]!, root);
  }

  const cursor = path.join(home, ".cursor", "plugins");

  for (const plugin of subdirs(path.join(cursor, "cache")).flatMap(subdirs)) {
    const root = newest(subdirs(plugin));

    if (root && !roots.has(path.basename(plugin))) roots.set(path.basename(plugin), root);
  }

  for (const root of subdirs(path.join(cursor, "local"))) if (!roots.has(path.basename(root))) roots.set(path.basename(root), root);

  return roots;
}

/** Where a harness looks for skills by bare name: Claude Code, the shared .agents layout, Codex, Cursor. */
export const skillDirs = (home: string, repoRoot: string) =>
  [".claude/skills", ".agents/skills", ".codex/skills", ".cursor/skills"].map((d) => path.join(home, d)).concat([".claude/skills", ".agents/skills", ".cursor/skills"].map((d) => path.join(repoRoot, d)));

/**
 * The directory holding the skill's SKILL.md: a pinned pack lens, a path against the repository, an
 * installed plugin's skill (`<plugin>:<skill>`), or a name in the usual skills directories.
 */
export function resolveSkill(ref: string, home: string, repoRoot: string): string | null {
  const pinned = lensCache(home, ref);

  if (pinned) return existsSync(path.join(pinned, "SKILL.md")) ? pinned : null;
  const plugin = PLUGIN_SKILL.exec(ref);

  if (plugin) {
    const root = pluginRoots(home).get(plugin[1]!);
    const dir = root && path.join(root, "skills", plugin[2]!);

    return dir && existsSync(path.join(dir, "SKILL.md")) ? dir : null;
  }

  const expanded = ref.startsWith("~/") ? path.join(home, ref.slice(2)) : ref;
  const candidates = expanded.includes("/") ? [path.resolve(repoRoot, expanded)] : skillDirs(home, repoRoot).map((d) => path.join(d, expanded));

  return candidates.find((dir) => existsSync(path.join(dir, "SKILL.md"))) ?? null;
}

/** The `description` from a skill's frontmatter, folded to one line. */
export function skillDescription(skillDir: string): string | null {
  const front = FRONTMATTER.exec(readFileSync(path.join(skillDir, "SKILL.md"), "utf8"))?.[1];

  if (front === undefined) return null;
  const parsed = z.object({ description: z.string() }).passthrough().safeParse(parse(front));

  return parsed.success ? parsed.data.description.replace(/\s+/g, " ").trim() : null;
}

/**
 * A detected stack's lens, copied from its starter into .shepherd/lenses/<stack> so the team owns and trims it,
 * with the pack's applies_to and gate. An existing lens directory is kept as it is.
 */
export function stackLens(repoRoot: string, stack: string): Lens {
  const skill = path.posix.join(".shepherd", "lenses", stack);
  const dir = path.join(repoRoot, skill);

  if (!existsSync(path.join(dir, "SKILL.md"))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), fromTemplate(stack, stack));
  }

  return { skill, ...packLens(stack) };
}
