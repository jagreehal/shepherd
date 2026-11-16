// First-run setup on GitHub: what a hosted console does for other tools, done here through `gh`, so nothing outside
// the repository and the user's own credentials is involved.
import { providerKeyEnv, sharedModelProblem } from "./lens.ts";

/** The model `shepherd init` picks from the first key it finds, in this order. */
export const KEY_MODELS = [
  ["OPENCODE_API_KEY", "opencode-go/deepseek-v4.1-flash"],
  ["ANTHROPIC_API_KEY", "anthropic/claude-opus-5"],
  ["OPENAI_API_KEY", "openai/gpt-5.5"],
  ["OPENROUTER_API_KEY", "openrouter/moonshotai/kimi-k3"],
] as const;

export type Pick = { model: string; key: string | null; why: string; chosen: boolean };

/**
 * The model to set up. An explicit choice (the flag) wins; then the model the policy already names, so a rerun never
 * moves it; then SHEPHERD_MODEL; then the first provider key present. `chosen` is true only when it should be written.
 */
export function pickModel(flag: string | undefined, existing: { value: string; source: string } | undefined, env: Record<string, string | undefined>): Pick | null {
  const at = (model: string, why: string, chosen: boolean): Pick => ({ model, key: providerKeyEnv(model), why, chosen });

  if (flag) return at(flag, "--model", true);

  if (existing) return at(existing.value, `models.loop from ${existing.source}`, false);
  const named = env.SHEPHERD_MODEL?.trim();

  if (named) return at(named, "SHEPHERD_MODEL", true);
  const found = KEY_MODELS.find(([key]) => env[key]?.trim());

  return found ? { model: found[1], key: found[0], why: `${found[0]} is set`, chosen: true } : null;
}

/** Why the picked model cannot drive both halves, or null. */
export const modelProblem = (model: string) => sharedModelProblem(model);

export type Gh = (args: string[], input?: string) => { ok: boolean; out: string };

export type Secret = { name: string; value: string | undefined };

export type GithubSetup = { repo: string; secrets: Secret[] };

/** What setup did on GitHub: one line per step, and what is left for a person. */
export type SetupOutcome = { lines: string[]; todo: string[] };

/**
 * The repository-side step, safe to repeat and never fatal: each secret set from the environment, sent on stdin and
 * never in arguments. Committing the setup files stays with the user, as any other change does.
 */
export function githubSetup(gh: Gh, s: GithubSetup): SetupOutcome {
  const lines: string[] = [];
  const todo: string[] = [];

  for (const { name, value } of s.secrets) {
    if (value && gh(["secret", "set", name, "--repo", s.repo], value).ok) lines.push(`secret    ${name} set on ${s.repo}`);
    else {
      lines.push(`secret    ${name} ${value ? "could not be set" : "is not in your environment"}`);
      todo.push(`gh secret set ${name} --repo ${s.repo}`);
    }
  }

  return { lines, todo };
}
