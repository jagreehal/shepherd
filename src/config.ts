// Team policy. `.shepherd/config.yml` (or the older `.shepherd/lenses.yml`) is layered in one fixed order:
// built-in defaults, then each pack it `extends`, then the file itself; a later layer replaces a scalar and
// merges a map by name. Every effective value carries the layer it came from. Personal settings
// (~/.config/shepherd/lenses.yml) are a preview: lenses that print locally, and a ladder or model pins that
// fill in only where the team sets none. Team files are read from the default branch, so a PR cannot change
// the policy it is reviewed under, and a pack from another repository is pinned to a commit.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parse } from "yaml";

const NAME = /^[a-z][a-z0-9-]*$/;

export const SEVERITIES = ["refuse", "escalate", "note"] as const;

export const LensSchema = z
  .object({
    skill: z.string().min(1),
    applies_to: z.array(z.string().min(1)).optional(),
    description: z.string().min(1).optional(),
    gate: z.enum(SEVERITIES).optional(), // stamp's on_break for this lens's untagged rules; swarm reads the tags only
    only: z.array(z.string().min(1)).min(1).optional(), // rule id globs to keep
    disable: z.array(z.string().min(1)).min(1).optional(), // rule id globs to drop
  })
  .strict();

export type Lens = z.infer<typeof LensSchema>;

// In one layer a lens may leave out its skill: it then trims or rescopes the lens of that name an earlier layer defined.
const LensLayerSchema = LensSchema.partial({ skill: true });

// A model id is whatever the harness's agent tool accepts: `haiku` on Claude Code, `provider/model` on OpenCode.
// stamp's canonical `provider:model` also works: opencode-agents spells it the OpenCode way (lens.ts opencodeModel).
export const ModelId = z.string().min(1);

/** The steps a recipe can run: shepherd's own runners and stamp's verdict. */
export const STEPS = ["swarm", "triage", "simplify", "ci-repair", "stamp", "incident"] as const;

type Step = (typeof STEPS)[number];

// Steps that change code, and the steps that review it. Success needs a review after the last change.
const FIXERS = new Set<Step>(["triage", "simplify", "ci-repair", "incident"]);

const REVIEWS = new Set<Step>(["swarm", "stamp"]);

export const ConfigSchema = z
  .object({
    extends: z.array(z.string().min(1)).optional(),
    tiers: z.record(z.string().regex(NAME), ModelId).optional(), // a name for a model, defined once: ladder and models may use it
    ladder: z.array(ModelId).min(1).optional(), // cheapest first; replaces the harness's ladder
    models: z.record(z.string().regex(NAME), ModelId).optional(), // a runner, lens or role group -> the model or tier it runs on
    lenses: z.record(z.string().regex(NAME), LensLayerSchema).default({}),
    checks: z.record(z.string().regex(NAME), z.object({ command: z.string().min(1) }).strict()).optional(),
    fixes: z.object({ mode: z.enum(["suggest", "local", "push"]) }).strict().optional(),
    escalate: z.object({ paths: z.array(z.string().min(1)).min(1), reason: z.string().min(1).optional() }).strict().optional(),
    recipes: z.record(z.string().regex(NAME), z.object({ steps: z.array(z.enum(STEPS)).min(1) }).strict()).optional(),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export const TEAM_FILES = [".shepherd/config.yml", ".shepherd/lenses.yml"];

const BUILT_IN: Config = {
  lenses: {},
  fixes: { mode: "push" },
  recipes: {
    review: { steps: ["swarm"] },
    fix: { steps: ["swarm", "triage", "simplify", "swarm"] }, // runs under fixes.mode local: nothing it needs is pushed
    pr: { steps: ["swarm", "triage", "simplify", "swarm", "ci-repair", "stamp"] },
    incident: { steps: ["incident", "swarm", "triage", "simplify", "swarm", "ci-repair", "stamp"] }, // the fix PR gets the full loop
  },
};

// `github:owner/repo/path/to/pack.yml@<40-hex commit>`. A branch or tag can move under the team; a commit cannot.
// Path characters are limited so nothing in it can reach the API URL as a query or fragment (`?ref=`, `#`).
export const PINNED = /^github:([\w.-]+)\/([\w.-]+)\/([\w./-]+)@([0-9a-f]{40})$/;

type Sourced<T> = { value: T; source: string };

/** One layer of policy and where it came from. */
type Layer = { source: string; config: Config };

export type Effective = {
  /** Named models. The ladder and models below hold them resolved: a model id, never a tier name. */
  tiers: Record<string, Sourced<string>>;
  ladder: Sourced<string[]> | null;
  models: Record<string, Sourced<string>>;
  lenses: Record<string, Sourced<Lens> & { scope: "team" | "personal" }>;
  checks: Record<string, Sourced<{ command: string }>>;
  fixes: Sourced<{ mode: "suggest" | "local" | "push" }>;
  escalate: Sourced<{ paths: string[]; reason?: string }> | null;
  recipes: Record<string, Sourced<{ steps: Step[] }>>;
  /** Personal settings that would change team policy, so they were not applied. */
  ignored: string[];
};

/** Reads a repository file (default branch or working tree); null when it does not exist. */
export type Read = (rel: string) => string | null;

/** Fetches a pinned pack from another repository. */
export type Fetch = (owner: string, repo: string, file: string, sha: string) => string;

const parseConfig = (text: string, source: string): Config => {
  const result = ConfigSchema.safeParse(parse(text) ?? {});

  if (!result.success) throw new Error(`${source}: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);

  return result.data;
};

// How deep packs may extend packs. Enough for org > stack > framework; past it a chain is a mistake.
const MAX_PACK_DEPTH = 4;

/**
 * One `extends` entry as layers: the packs it extends, in order, then the pack itself. A pinned pack's own
 * relative entries name files in its repository at the same commit, so a pack travels with what it builds on.
 */
function readPack(ref: string, read: Read, fetch: Fetch, chain: string[] = []): Layer[] {
  if (chain.includes(ref)) throw new Error(`${[...chain, ref].join(" > ")}: packs extend each other in a cycle`);

  if (chain.length >= MAX_PACK_DEPTH) throw new Error(`${[...chain, ref].join(" > ")}: packs extend more than ${MAX_PACK_DEPTH} deep`);
  const pinned = PINNED.exec(ref);
  let text: string | null;

  if (pinned) text = fetch(pinned[1]!, pinned[2]!, pinned[3]!, pinned[4]!);
  else if (ref.startsWith("github:")) throw new Error(`${ref}: pin a pack from another repository to a full commit sha (github:owner/repo/path@<40 hex>)`);
  else if (pathEscapes(ref)) throw new Error(`${ref}: a pack path is repository-relative, with no leading / and no ..`);
  else text = read(ref);

  if (text === null) throw new Error(`${ref}: pack not found`);
  const config = parseConfig(text, ref);

  const inner = (config.extends ?? []).map((e) => {
    if (!pinned || e.startsWith("github:")) return e;

    if (pathEscapes(e)) throw new Error(`${ref}: extends ${e}: a path is relative to the pack's repository, with no leading / and no ..`);

    return `github:${pinned[1]}/${pinned[2]}/${e}@${pinned[4]}`;
  });

  // A pinned pack's lens paths name files in the pack's repository at the same commit, so the lens travels with it.
  if (pinned) {
    for (const [name, lens] of Object.entries(config.lenses)) {
      if (!lens.skill?.includes("/")) continue;

      if (pathEscapes(lens.skill)) throw new Error(`${ref}: lens ${name}: a skill path is relative to the pack's repository, with no leading / and no ..`);
      lens.skill = `github:${pinned[1]}/${pinned[2]}/${lens.skill.replace(/\/+$/, "")}@${pinned[4]}`;
    }
  }

  return [...inner.flatMap((e) => readPack(e, read, fetch, [...chain, ref])), { source: `pack ${ref}`, config }];
}

const pathEscapes = (rel: string) => rel.startsWith("/") || rel.split("/").includes("..");

/** Merge layers in order: a later layer replaces a scalar and merges a map by name; a lens merges field by field. */
function merge(layers: Layer[]): Effective {
  const out: Effective = { tiers: {}, ladder: null, models: {}, lenses: {}, checks: {}, fixes: { value: { mode: "push" }, source: "built-in" }, escalate: null, recipes: {}, ignored: [] };

  for (const { source, config } of layers) {
    const tag = <T>(value: T) => ({ value, source });

    if (config.ladder) out.ladder = tag(config.ladder);

    if (config.fixes) out.fixes = tag(config.fixes);

    if (config.escalate) out.escalate = tag(config.escalate);

    for (const [k, v] of Object.entries(config.tiers ?? {})) out.tiers[k] = tag(v);

    for (const [k, v] of Object.entries(config.models ?? {})) out.models[k] = tag(v);

    for (const [k, v] of Object.entries(config.lenses)) {
      // SAFETY: a lens without a skill is refused in loadPolicy unless an earlier layer gave it one.
      const lens = { ...out.lenses[k]?.value, ...v } as Lens;

      out.lenses[k] = { ...tag(lens), scope: "team" };
    }

    for (const [k, v] of Object.entries(config.checks ?? {})) out.checks[k] = tag(v);

    for (const [k, v] of Object.entries(config.recipes ?? {})) out.recipes[k] = tag(v);
  }

  return out;
}

/**
 * The effective policy: built-in defaults, the team file's packs in order, the team file, then the personal
 * preview. `personal` is the parsed ~/.config/shepherd/lenses.yml, or null.
 */
export function loadPolicy(read: Read, fetch: Fetch, personal: Config | null): Effective & { teamFile: string | null } {
  const teamFile = TEAM_FILES.find((f) => read(f) !== null) ?? null;
  const team = teamFile ? parseConfig(read(teamFile)!, teamFile) : null;
  const packs = (team?.extends ?? []).flatMap((ref) => readPack(ref, read, fetch));
  const effective = merge([{ source: "built-in", config: BUILT_IN }, ...packs, ...(team ? [{ source: teamFile!, config: team }] : [])]);

  for (const [name, l] of Object.entries(effective.lenses)) {
    if (!l.value.skill) throw new Error(`lens ${name}: no skill; name one, or extend the pack that defines ${name}`);
  }

  // A lens may name a pinned pack directly; any skill spelled github: must be one that stays in the cache.
  for (const [name, l] of [...Object.entries(effective.lenses), ...Object.entries(personal?.lenses ?? {}).map(([k, v]) => [k, { value: v }] as const)]) {
    if (l.value.skill?.startsWith("github:") && !safePinned(l.value.skill)) throw new Error(`lens ${name}: ${l.value.skill} is not github:owner/repo/<path>@<40-hex sha> with a path that stays in that repository`);
  }

  if (personal) {
    const source = "personal";

    // Personal fills in only what the team left open, and adds lenses that never post.
    if (!effective.ladder && personal.ladder) effective.ladder = { value: personal.ladder, source };

    for (const [k, v] of Object.entries(personal.tiers ?? {})) effective.tiers[k] ??= { value: v, source };

    for (const [k, v] of Object.entries(personal.lenses)) {
      if (!v.skill) throw new Error(`personal lens ${k}: no skill`);
      // SAFETY: skill checked on the line above.
      effective.lenses[k] ??= { value: v as Lens, source, scope: "personal" };
    }

    for (const key of ["extends", "checks", "fixes", "escalate", "recipes"] as const) {
      if (personal[key] !== undefined) effective.ignored.push(`personal ${key}: team policy, set it in ${TEAM_FILES[0]}`);
    }
  }

  // The team's groups expand before any personal pin, so a personal pin fills only a runner the team left open.
  effective.models = expandGroups(effective, effective.models);

  if (personal?.models) {
    const own = expandGroups(effective, Object.fromEntries(Object.entries(personal.models).map(([k, v]) => [k, { value: v, source: "personal" }])));

    for (const [k, v] of Object.entries(own)) effective.models[k] ??= v;
  }

  return { ...resolveModels(effective), teamFile };
}

/**
 * Role groups a `models` entry can pin at once. A pin on one runner or lens beats its group's, so a team
 * sets `reviewers: fast` and `security: smart` and gets both.
 */
export const ROLE_GROUPS = {
  reviewers: (p: Effective) => ["router", ...BUILT_IN_REVIEWERS, ...Object.keys(p.lenses)],
  fixers: () => ["triage", "simplify", "ci-repair", "incident"],
  validators: () => ["verifier", "validator"],
} as const;

/** The merged team pins with role groups expanded: a pin on a runner or lens beats its group. */
function expandGroups(p: Effective, pins: Effective["models"]): Effective["models"] {
  const out: Effective["models"] = {};

  for (const [group, members] of Object.entries(ROLE_GROUPS)) {
    const pin = pins[group];

    if (pin) for (const m of members(p)) out[m] = { value: pin.value, source: `${pin.source} (models.${group})` };
  }

  for (const [k, v] of Object.entries(pins)) if (!(k in ROLE_GROUPS)) out[k] = v;

  return out;
}

/** Turn every tier name in the ladder and pins into its model id. */
function resolveModels(p: Effective): Effective {
  const tier = (v: Sourced<string>) => {
    const t = p.tiers[v.value];

    return t ? { value: t.value, source: `${v.source}, tier ${v.value}` } : v;
  };

  return {
    ...p,
    ladder: p.ladder && { value: p.ladder.value.map((m) => p.tiers[m]?.value ?? m), source: p.ladder.source },
    models: Object.fromEntries(Object.entries(p.models).map(([k, v]) => [k, tier(v)])),
  };
}

/** The model CI runs the shepherd session on when nothing chooses one. */
export const CI_DEFAULT_MODEL = "opencode-go/kimi-k3";

/**
 * The session model for CI, in order: SHEPHERD_MODEL (a model id or a tier name), the `loop` pin, the top of the
 * ladder, then the default, which says so.
 */
export type CiModel = { model: string; source: string };

export function ciModel(p: Effective, override: string | undefined): CiModel {
  if (override) return p.tiers[override] ? { model: p.tiers[override]!.value, source: `SHEPHERD_MODEL, tier ${override}` } : { model: override, source: "SHEPHERD_MODEL" };

  if (p.models.loop) return { model: p.models.loop.value, source: `models.loop, ${p.models.loop.source}` };

  if (p.ladder) return { model: p.ladder.value.at(-1)!, source: `top of the ladder, ${p.ladder.source}` };

  return { model: CI_DEFAULT_MODEL, source: "default: name one with SHEPHERD_MODEL, models.loop or a ladder" };
}

type Mode = Effective["fixes"]["value"]["mode"];

/** `shepherd init --preset`: how far fixes go. */
export const PRESETS = { "review-only": "suggest", "local-fix": "local", push: "push" } as const satisfies Record<string, Mode>;

/** What is wrong with a recipe: an unknown order, a fix nothing reviews, or a step the fix mode forbids. */
export function recipeProblems(name: string, steps: Step[], mode: Mode): string[] {
  const problems: string[] = [];
  const at = (s: Step) => steps.indexOf(s);

  if (steps.includes("incident") && at("incident") !== 0) problems.push(`recipe ${name}: incident opens the PR, so it must come first`);

  if (steps.includes("stamp") && steps.lastIndexOf("stamp") !== steps.length - 1) problems.push(`recipe ${name}: stamp gives the verdict on the final head, so it must come last`);

  if (steps.includes("triage") && !steps.slice(0, at("triage")).includes("swarm")) problems.push(`recipe ${name}: triage works the threads swarm posts, so a swarm must come before it`);

  const lastFix = steps.map((s) => FIXERS.has(s)).lastIndexOf(true);

  if (lastFix >= 0 && !steps.slice(lastFix + 1).some((s) => REVIEWS.has(s))) problems.push(`recipe ${name}: ${steps[lastFix]} changes code, so a swarm or stamp must review after it`);
  // stamp reviews the pushed head; under local the fixes never reach it, so only a swarm of the working tree counts.
  else if (mode === "local" && lastFix >= 0 && !steps.slice(lastFix + 1).includes("swarm")) problems.push(`recipe ${name}: fixes.mode is local, so stamp cannot see ${steps[lastFix]}'s fixes; a swarm must review after it`);

  if (mode === "suggest") {
    const fixers = steps.filter((s) => FIXERS.has(s));

    if (fixers.length) problems.push(`recipe ${name}: fixes.mode is suggest, so it cannot run ${[...new Set(fixers)].join(", ")}`);
  }

  return problems;
}

/** Every problem in the effective policy that does not need the filesystem. A built-in recipe the fix mode rules out is unavailable, not a problem. */
export const policyProblems = (p: Effective): string[] =>
  Object.entries(p.recipes).flatMap(([name, r]) => (r.source === "built-in" ? [] : recipeProblems(name, r.value.steps, p.fixes.value.mode)));

/** The recipe a plain `/shepherd` run matches under each fix mode. */
export const DEFAULT_RECIPE: Record<Mode, string> = { suggest: "review", local: "fix", push: "pr" };

/** How a recipe finishes, which is not always "ready to merge". */
export function completion(steps: Step[], mode: Mode): string {
  if (!steps.some((s) => FIXERS.has(s))) return steps.at(-1) === "stamp" ? "ready when stamp approves this head, CI is green and no review thread is open" : "reviewed: findings posted for the author; says nothing about merge readiness";

  if (mode === "local") return "fixes_uncommitted: reviewed in your working tree; commit, push and run again before it can be ready";

  return steps.at(-1) === "stamp" ? "ready when stamp approves the final head, CI is green and no review thread is open; else pending" : "reviewed after the last fix; not ready until stamp approves, CI is green and no review thread is open";
}

// What each step can write. Swarm and stamp only post; the fixers' reach is the fix mode.
const WRITES: Record<Step, Record<Mode, string>> = {
  swarm: { suggest: "posts review comments on the PR", local: "posts review comments on the PR", push: "posts review comments on the PR" },
  stamp: { suggest: "posts a review (approve or request changes)", local: "posts a review (approve or request changes)", push: "posts a review (approve or request changes)" },
  triage: { suggest: "replies on threads, changes no code", local: "edits your working tree", push: "commits and pushes to the PR branch, resolves threads" },
  simplify: { suggest: "reports only", local: "edits your working tree", push: "commits and pushes to the PR branch" },
  "ci-repair": { suggest: "reports only", local: "edits your working tree", push: "commits and pushes to the PR branch" },
  incident: { suggest: "opens an incident issue", local: "opens an incident issue, edits your working tree", push: "opens an incident issue, pushes incident/<n>, opens a PR" },
};

// Built-in reviewers, and the ladder rung each runner starts on (skills/shepherd/references/models.md).
const BUILT_IN_REVIEWERS = ["correctness", "security", "simplicity", "maintainability", "slop", "spec"];

const RUNG = new Map([["router", 0], ["verifier", 1], ["triage", 1], ["simplify", 1], ["ci-repair", 1], ["validator", 2], ["loop", 99]]); // loop: the top rung

/** The model each runner uses: its pin, its rung of the team ladder, or the harness's own ladder. */
export function modelPlan(p: Effective): { runner: string; model: string; source: string }[] {
  const names = ["router", ...BUILT_IN_REVIEWERS, ...Object.keys(p.lenses), "verifier", "triage", "simplify", "ci-repair", "validator", "loop"];

  return [...new Set(names)].map((runner) => {
    const pin = p.models[runner];
    const rung = RUNG.get(runner) ?? 1; // a lens runs one rung above the router

    if (pin) return { runner, model: pin.value, source: `pinned, ${pin.source}` };

    if (p.ladder) {
      const at = Math.min(rung, p.ladder.value.length - 1);

      return { runner, model: p.ladder.value[at]!, source: `rung ${at}, ${p.ladder.source}` };
    }

    if (runner === "loop") return { runner, model: "the session model", source: `in CI, SHEPHERD_MODEL or ${CI_DEFAULT_MODEL}` };

    return { runner, model: `harness rung ${rung}`, source: "Claude Code: haiku > sonnet > opus; OpenCode with no ladder: the session model" };
  });
}

const globMatch = (pattern: string, file: string) => new Bun.Glob(pattern).match(file);

/** What would run on these changed files: which lenses, which checks, how fixes land, what goes to a person. */
export function preview(p: Effective, files: string[], recipe?: string) {
  const lenses = Object.entries(p.lenses).map(([name, l]) => {
    const hits = l.value.applies_to ? files.filter((f) => l.value.applies_to!.some((g) => globMatch(g, f))) : null;

    return { name, scope: l.scope, runs: hits === null ? "if the router calls it" : hits.length ? `on ${hits.length} file(s)` : "no matching files", files: hits ?? [] };
  });

  const escalated = p.escalate ? files.filter((f) => p.escalate!.value.paths.some((g) => globMatch(g, f))) : [];
  const mode = p.fixes.value.mode;
  const name = recipe ?? DEFAULT_RECIPE[mode];
  const steps = p.recipes[name]?.value.steps;

  if (!steps) throw new Error(`no recipe named ${name}; known: ${Object.keys(p.recipes).join(", ")}`);

  return {
    files,
    lenses,
    models: modelPlan(p),
    checks: Object.keys(p.checks).length ? Object.entries(p.checks).map(([name, c]) => `${name}: ${c.value.command}`) : ["discovered by swarm from the repo's config"],
    fixes: mode,
    escalated,
    recipe: name,
    steps,
    writes: [...new Set(steps)].map((s) => ({ step: s, writes: WRITES[s][mode] })),
    unavailable: recipeProblems(name, steps, mode),
    completes: completion(steps, mode),
  };
}

const gitIn = (repoRoot: string) => (...args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The fetched ref of `origin`'s default branch. The name comes from the remote, since a CI checkout sets no origin/HEAD. */
export function defaultBranchRef(repoRoot: string): string {
  const git = gitIn(repoRoot);
  // CI names it (SHEPHERD_DEFAULT_BRANCH), since a checkout without a persisted token cannot ask a private origin.
  const branch = process.env.SHEPHERD_DEFAULT_BRANCH || /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(git("ls-remote", "--symref", "origin", "HEAD"))?.[1];

  if (!branch) throw new Error("cannot tell origin's default branch");
  const ref = `refs/remotes/origin/${branch}`;

  try {
    git("rev-parse", "--verify", "--quiet", ref);
  } catch {
    throw new Error(`origin/${branch} is not fetched: run git fetch origin ${branch}`);
  }

  return ref;
}

/** A reader over the default branch of `origin`, the same source the skills use. */
export function defaultBranchReader(repoRoot: string): Read {
  const git = gitIn(repoRoot);
  const ref = defaultBranchRef(repoRoot);

  return (rel) => {
    try {
      return git("show", `${ref}:${rel}`);
    } catch {
      return null;
    }
  };
}

/** Every file under a directory of a repository at a commit, as paths relative to that directory. */
export type FetchDir = (owner: string, repo: string, dir: string, sha: string) => { path: string; content: string }[];

/** Where a pinned lens directory is kept: by commit, so a cached copy never goes stale. */
export const lensCache = (home: string, ref: string): string | null => {
  const m = safePinned(ref);

  return m ? path.join(home, ".cache", "shepherd", "packs", m[1]!, m[2]!, m[4]!, m[3]!) : null;
};

/** A pinned reference whose every part stays inside the cache: no `.` or `..` owner or repo, no escaping path. */
const safePinned = (ref: string) => {
  const m = PINNED.exec(ref);

  return m && ![m[1], m[2]].some((part) => part === "." || part === "..") && !pathEscapes(m[3]!) && !m[3]!.split("/").includes("") && !m[3]!.includes("\\") ? m : null;
};

/**
 * Fetch each pinned pack lens into the cache once. Each fetch writes a private temporary directory and
 * renames it into place, so a reader never sees half a lens; a failed fetch leaves nothing behind, and when
 * two fetch the same lens at once the first rename wins and the other's copy is dropped.
 */
export function fetchPackLenses(p: Effective, home: string, fetchDir: FetchDir): void {
  for (const { value } of Object.values(p.lenses)) {
    const m = safePinned(value.skill);
    const dest = lensCache(home, value.skill);

    if (!m || !dest || existsSync(path.join(dest, "SKILL.md"))) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    sweepStale(dest);
    const tmp = mkdtempSync(`${dest}.tmp-`);

    try {
      const files = fetchDir(m[1]!, m[2]!, m[3]!, m[4]!);

      if (!files.some((f) => f.path === "SKILL.md")) throw new Error(`${value.skill}: no SKILL.md in that directory`);

      for (const f of files) {
        if (pathEscapes(f.path)) throw new Error(`${value.skill}: unsafe file path ${f.path}`);
        mkdirSync(path.dirname(path.join(tmp, f.path)), { recursive: true });
        writeFileSync(path.join(tmp, f.path), f.content);
      }

      // A directory without SKILL.md is no lens: an older, interrupted layout. Nothing reads it; replace it.
      if (existsSync(dest) && !existsSync(path.join(dest, "SKILL.md"))) rmSync(dest, { recursive: true, force: true });

      try {
        renameSync(tmp, dest);
      } catch (error) {
        if (!existsSync(path.join(dest, "SKILL.md"))) throw error; // another fetch got there first otherwise
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

/** Remove temporary fetch directories for `dest` that a killed process left, once they are an hour old. */
function sweepStale(dest: string): void {
  const prefix = `${path.basename(dest)}.tmp-`;

  for (const name of readdirSync(path.dirname(dest))) {
    const dir = path.join(path.dirname(dest), name);

    if (name.startsWith(prefix) && Date.now() - statSync(dir).mtimeMs > 3_600_000) rmSync(dir, { recursive: true, force: true });
  }
}

/** A directory through `gh`, recursively, at that commit. */
export const ghFetchDir: FetchDir = (owner, repo, dir, sha) => {
  verifyPinned(owner, repo, sha);
  const api = (p: string, raw: boolean) => execFileSync("gh", ["api", ...(raw ? ["-H", "Accept: application/vnd.github.raw"] : []), `repos/${owner}/${repo}/contents/${p}?ref=${sha}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const Entries = z.array(z.object({ path: z.string(), type: z.string() }));

  const walk = (p: string): { path: string; content: string }[] =>
    Entries.parse(JSON.parse(api(p, false))).flatMap((e) => (e.type === "dir" ? walk(e.path) : e.type === "file" ? [{ path: path.posix.relative(dir, e.path), content: api(e.path, true) }] : []));

  return walk(dir);
};

const gh = (...args: string[]) => execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * GitHub serves any commit in a repository's fork network through that repository, so a pin alone could name
 * a commit someone pushed to a fork. A pin counts only when the commit is on the repository's default branch.
 */
export function verifyPinned(owner: string, repo: string, sha: string): void {
  const branch = gh(`repos/${owner}/${repo}`, "--jq", ".default_branch").trim();
  let status: string;

  try {
    status = gh(`repos/${owner}/${repo}/compare/${branch}...${sha}`, "--jq", ".status").trim();
  } catch (error) {
    // An unrelated history (say a fork's orphan commit) has no merge base: GitHub answers 404.
    if (!/No common ancestor/.test(String(Object(error).stderr))) throw error;
    status = "unrelated";
  }

  if (status !== "behind" && status !== "identical") throw new Error(`github:${owner}/${repo}@${sha}: that commit is not on ${owner}/${repo}'s ${branch} branch; pin a commit from its history`);
}

/** A pinned pack through `gh`, as raw file contents at that commit. */
export const ghFetch: Fetch = (owner, repo, file, sha) => {
  verifyPinned(owner, repo, sha);

  return gh("-H", "Accept: application/vnd.github.raw", `repos/${owner}/${repo}/contents/${file}?ref=${sha}`);
};
