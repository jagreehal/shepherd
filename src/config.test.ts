import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { branding, ciModel, ciSettings, type Fetch, type FetchDir, fetchPackLenses, modelPlan, lensCache, loadPolicy, policyProblems, preview, type Read, recipeProblems } from "./config.ts";
import { lensProblems, resolveSkill } from "./lens.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const files = (map: Record<string, string>): Read => (rel) => map[rel] ?? null;

const noFetch: Fetch = () => {
  throw new Error("no network in tests");
};

describe("policy layering", () => {
  test("built-in, then packs in order, then the repository file; every value says where it came from", () => {
    const read = files({
      ".shepherd/config.yml": "extends: [.shepherd/packs/acme.yml, .shepherd/packs/team.yml]\nchecks:\n  unit: { command: bun test }\nfixes: { mode: local }\n",
      ".shepherd/packs/acme.yml": "checks:\n  unit: { command: npm test }\n  types: { command: npm run typecheck }\nescalate: { paths: ['migrations/**'] }\nladder: [cheap, strong]\n",
      ".shepherd/packs/team.yml": "checks:\n  types: { command: tsc --noEmit }\n",
    });

    const p = loadPolicy(read, noFetch, null);

    expect(p.teamFile).toBe(".shepherd/config.yml");
    expect(p.checks.unit).toEqual({ value: { command: "bun test" }, source: ".shepherd/config.yml" });
    expect(p.checks.types).toEqual({ value: { command: "tsc --noEmit" }, source: "pack .shepherd/packs/team.yml" });
    expect(p.escalate?.source).toBe("pack .shepherd/packs/acme.yml");
    expect(p.fixes).toEqual({ value: { mode: "local" }, source: ".shepherd/config.yml" });
    expect(p.recipes.pr?.source).toBe("built-in");
  });

  test("the older lenses.yml still loads when there is no config.yml", () => {
    const p = loadPolicy(files({ ".shepherd/lenses.yml": "lenses:\n  react: { skill: react-rules }\n" }), noFetch, null);

    expect(p.teamFile).toBe(".shepherd/lenses.yml");
    expect(p.lenses.react?.source).toBe(".shepherd/lenses.yml");
  });

  test("personal settings preview lenses and fill an open ladder, and never change team policy", () => {
    const read = files({ ".shepherd/config.yml": "models: { security: strong }\nlenses:\n  house: { skill: team-house }\nfixes: { mode: suggest }\n" });
    const p = loadPolicy(read, noFetch, { ladder: ["mine"], models: { security: "weak", router: "mine" }, lenses: { house: { skill: "my-house" }, extra: { skill: "x" } }, fixes: { mode: "push" }, checks: { unit: { command: "true" } } });

    expect(p.ladder).toEqual({ value: ["mine"], source: "personal" });
    expect(p.models.security?.value).toBe("strong");
    expect(p.models.router?.source).toBe("personal");
    expect(p.lenses.house?.value.skill).toBe("team-house");
    expect(p.lenses.extra?.scope).toBe("personal");
    expect(p.fixes.value.mode).toBe("suggest");
    expect(p.checks).toEqual({});
    expect(p.ignored).toEqual([expect.stringContaining("personal checks"), expect.stringContaining("personal fixes")]);
  });

  test("a pack from another repository must be pinned to a commit, and is fetched at that commit", () => {
    const read = (ext: string) => files({ ".shepherd/config.yml": `extends: ['${ext}']\n` });

    expect(() => loadPolicy(read("github:acme/policy/shepherd.yml@main"), noFetch, null)).toThrow("pin a pack");

    const fetched: string[] = [];

    const fetch: Fetch = (owner, repo, file, sha) => {
      fetched.push(`${owner}/${repo}/${file}@${sha}`);

      return "fixes: { mode: suggest }\n";
    };

    expect(loadPolicy(read(`github:acme/policy/packs/shepherd.yml@${SHA}`), fetch, null).fixes.source).toBe(`pack github:acme/policy/packs/shepherd.yml@${SHA}`);
    expect(fetched).toEqual([`acme/policy/packs/shepherd.yml@${SHA}`]);
  });

  test("a pack extends packs before itself, with no cycle and a bounded depth", () => {
    const p = loadPolicy(files({ ".shepherd/config.yml": "extends: [next.yml]\n", "next.yml": "extends: [react.yml]\nchecks:\n  a: { command: next }\n", "react.yml": "checks:\n  a: { command: react }\n  b: { command: react }\n" }), noFetch, null);

    expect(p.checks.a).toEqual({ value: { command: "next" }, source: "pack next.yml" });
    expect(p.checks.b?.source).toBe("pack react.yml");
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "extends: [a.yml]\n", "a.yml": "extends: [b.yml]\n", "b.yml": "extends: [a.yml]\n" }), noFetch, null)).toThrow("a.yml > b.yml > a.yml: packs extend each other in a cycle");
    const chain = Object.fromEntries(["p0", "p1", "p2", "p3", "p4"].map((n, i) => [`${n}.yml`, `extends: [p${i + 1}.yml]\n`]));

    expect(() => loadPolicy(files({ ".shepherd/config.yml": "extends: [p0.yml]\n", ...chain }), noFetch, null)).toThrow("more than 4 deep");
  });

  test("a pinned pack's relative extends names its own repository at the same commit", () => {
    const fetched: string[] = [];

    const fetch: Fetch = (owner, repo, file, sha) => {
      fetched.push(`${owner}/${repo}/${file}@${sha}`);

      return file === "packs/next.yml" ? "extends: [packs/react.yml]\nlenses:\n  next: { skill: lenses/next }\n" : "lenses:\n  react: { skill: lenses/react }\n";
    };

    const p = loadPolicy(files({ ".shepherd/config.yml": `extends: ['github:acme/packs/packs/next.yml@${SHA}']\n` }), fetch, null);

    expect(fetched).toEqual([`acme/packs/packs/next.yml@${SHA}`, `acme/packs/packs/react.yml@${SHA}`]);
    expect(p.lenses.react?.value.skill).toBe(`github:acme/packs/lenses/react@${SHA}`);
    expect(() => loadPolicy(files({ ".shepherd/config.yml": `extends: ['github:acme/packs/x.yml@${SHA}']\n` }), () => "extends: [../y.yml]\n", null)).toThrow("relative to the pack's repository");
  });

  test("a repository trims a pack's lens without restating it; a lens with no skill anywhere is refused", () => {
    const read = files({
      ".shepherd/config.yml": "extends: [react.yml]\nlenses:\n  react: { disable: [rendering-*], applies_to: ['web/**'] }\n",
      "react.yml": "lenses:\n  react: { skill: lenses/react, applies_to: ['**/*.tsx'], gate: refuse }\n",
    });

    expect(loadPolicy(read, noFetch, null).lenses.react?.value).toEqual({ skill: "lenses/react", applies_to: ["web/**"], gate: "refuse", disable: ["rendering-*"] });
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "lenses:\n  react: { only: [x] }\n" }), noFetch, null)).toThrow("lens react: no skill");
  });

  test("a pack cannot escape the repository or be missing", () => {
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "extends: [../outside.yml]\n" }), noFetch, null)).toThrow("repository-relative");
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "extends: [gone.yml]\n" }), noFetch, null)).toThrow("pack not found");
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "fixes: { mode: yolo }\n" }), noFetch, null)).toThrow(".shepherd/config.yml: fixes.mode");
  });
});

describe("recipes", () => {
  test("the built-in recipes are valid", () => {
    expect(policyProblems(loadPolicy(files({}), noFetch, null))).toEqual([]);
  });

  test("order, review after fixes, and the fix mode are enforced", () => {
    expect(recipeProblems("r", ["triage", "swarm"], "push")).toEqual([expect.stringContaining("a swarm must come before it")]);
    expect(recipeProblems("r", ["swarm", "triage"], "push")).toEqual([expect.stringContaining("triage changes code, so a swarm or stamp must review after it")]);
    expect(recipeProblems("r", ["swarm", "stamp", "swarm"], "push")).toEqual([expect.stringContaining("stamp gives the verdict on the final head")]);
    expect(recipeProblems("r", ["swarm", "incident", "swarm"], "push")).toEqual([expect.stringContaining("incident opens the PR")]);
    expect(recipeProblems("r", ["swarm", "triage", "swarm"], "suggest")).toEqual([expect.stringContaining("fixes.mode is suggest")]);
    expect(recipeProblems("r", ["swarm", "triage", "simplify", "swarm", "ci-repair", "stamp"], "push")).toEqual([]);
  });

  test("an unknown step is a schema error, not a silent skip", () => {
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "recipes:\n  r: { steps: [swarm, deploy] }\n" }), noFetch, null)).toThrow("recipes.r.steps.1");
  });
});

test("preview names the lenses, checks, fix mode and escalations a change would meet", () => {
  const read = files({
    ".shepherd/config.yml":
      "lenses:\n  payments: { skill: pay, applies_to: ['src/payments/**'] }\n  style: { skill: house }\n  ui: { skill: ui, applies_to: ['**/*.tsx'] }\nchecks:\n  unit: { command: bun test }\nescalate: { paths: ['migrations/**'] }\n",
  });

  const plan = preview(loadPolicy(read, noFetch, null), ["src/payments/charge.ts", "migrations/001.sql"], "pr");

  expect(plan.lenses).toEqual([
    { name: "payments", scope: "team", runs: "on 1 file(s)", files: ["src/payments/charge.ts"] },
    { name: "style", scope: "team", runs: "if the router calls it", files: [] },
    { name: "ui", scope: "team", runs: "no matching files", files: [] },
  ]);
  expect(plan.checks).toEqual(["unit: bun test"]);
  expect(plan.escalated).toEqual(["migrations/001.sql"]);
  expect(plan.steps).toEqual(["swarm", "triage", "simplify", "swarm", "ci-repair", "stamp"]);
  expect(() => preview(loadPolicy(read, noFetch, null), [], "nope")).toThrow("no recipe named nope");
});

describe("lenses that travel with a pinned pack", () => {
  const pack = `github:acme/policy/shepherd.yml@${SHA}`;
  const read = files({ ".shepherd/config.yml": `extends: ['${pack}']\n` });
  const fetch: Fetch = () => "lenses:\n  payments: { skill: lenses/payments/, applies_to: ['src/pay/**'] }\n  house: { skill: house-style }\n";

  test("a path in the pack names the pack's repository at its commit; a bare name stays an installed skill", () => {
    const p = loadPolicy(read, fetch, null);

    expect(p.lenses.payments?.value.skill).toBe(`github:acme/policy/lenses/payments@${SHA}`);
    expect(p.lenses.house?.value.skill).toBe("house-style");
    expect(() => loadPolicy(read, () => "lenses:\n  x: { skill: ../../etc }\n", null)).toThrow("relative to the pack's repository");

    for (const bad of [`github:../../x/y@${SHA}`, `github:acme/../x@${SHA}`, `github:acme/policy/../../x@${SHA}`, `github:acme/policy//etc@${SHA}`, `github:acme/policy/x?ref=main#@${SHA}`, "github:acme/policy/x@main"]) {
      expect(() => loadPolicy(files({ ".shepherd/config.yml": `lenses:\n  x: { skill: '${bad}' }\n` }), noFetch, null)).toThrow("lens x");
      expect(lensCache("/home", bad)).toBeNull();
    }
  });

  test("it is fetched once into a cache keyed by commit, and resolves there", () => {
    const home = mkdtempSync(path.join(tmpdir(), "shepherd-packlens-"));
    const p = loadPolicy(read, fetch, null);
    const calls: string[] = [];

    const fetchDir: FetchDir = (owner, repo, dir, sha) => {
      calls.push(`${owner}/${repo}/${dir}@${sha}`);

      return [
        { path: "SKILL.md", content: "---\ndescription: payments rules\n---\n\n# payments\n" },
        { path: "references/limits.md", content: "limits\n" },
      ];
    };

    try {
      const skill = p.lenses.payments!.value;

      expect(lensProblems(skill, home, "/nowhere")).toEqual([expect.stringContaining("not fetched yet")]);
      fetchPackLenses(p, home, fetchDir);
      fetchPackLenses(p, home, fetchDir);
      expect(calls).toEqual([`acme/policy/lenses/payments@${SHA}`]);
      const dir = resolveSkill(skill.skill, home, "/nowhere")!;

      expect(readFileSync(path.join(dir, "references/limits.md"), "utf8")).toBe("limits\n");
      expect(lensProblems(skill, home, "/nowhere")).toEqual([]);
      expect(() => fetchPackLenses(loadPolicy(read, () => "lenses:\n  y: { skill: lenses/y }\n", null), home, () => [{ path: "../x", content: "" }, { path: "SKILL.md", content: "" }])).toThrow("unsafe file path");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("the pinned lens cache recovers", () => {
  const pack = `github:acme/policy/shepherd.yml@${SHA}`;
  const p = () => loadPolicy(files({ ".shepherd/config.yml": `extends: ['${pack}']\n` }), () => "lenses:\n  pay: { skill: lenses/pay }\n", null);
  const good: FetchDir = () => [{ path: "SKILL.md", content: "---\ndescription: pay\n---\n" }];

  const withHome = (run: (home: string, dest: string) => void) => {
    const home = mkdtempSync(path.join(tmpdir(), "shepherd-cache-"));

    try {
      run(home, path.join(home, ".cache/shepherd/packs/acme/policy", SHA, "lenses/pay"));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };

  test("a failed download leaves nothing, and the next fetch succeeds", () => {
    withHome((home, dest) => {
      expect(() => fetchPackLenses(p(), home, () => { throw new Error("network down"); })).toThrow("network down");
      expect(() => fetchPackLenses(p(), home, () => [{ path: "SKILL.md", content: "x" }, { path: "../evil", content: "" }])).toThrow("unsafe");
      expect(readdirSync(path.dirname(dest))).toEqual([]);
      fetchPackLenses(p(), home, good);
      expect(readdirSync(path.dirname(dest))).toEqual(["pay"]);
    });
  });

  test("a concurrent fetch that lands first wins, and ours is dropped without an error", () => {
    withHome((home, dest) => {
      fetchPackLenses(p(), home, () => {
        mkdirSync(dest, { recursive: true });
        writeFileSync(path.join(dest, "SKILL.md"), "theirs");

        return [{ path: "SKILL.md", content: "ours" }];
      });
      expect(readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("theirs");
      expect(readdirSync(path.dirname(dest))).toEqual(["pay"]);
    });
  });

  test("an interrupted older copy is replaced, and an hour-old temporary directory is swept", () => {
    withHome((home, dest) => {
      mkdirSync(path.join(dest, "references"), { recursive: true });
      const stale = `${dest}.tmp-dead`;

      mkdirSync(stale);
      utimesSync(stale, new Date(0), new Date(0));
      fetchPackLenses(p(), home, good);
      expect(readFileSync(path.join(dest, "SKILL.md"), "utf8")).toContain("pay");
      expect(readdirSync(path.dirname(dest))).toEqual(["pay"]);
    });
  });
});

describe("model tiers and role groups", () => {
  const read = files({
    ".shepherd/config.yml": "extends: [org.yml]\nladder: [fast, smart]\nmodels:\n  reviewers: fast\n  fixers: smart\n  security: smart\n  loop: smart\nlenses:\n  house: { skill: h }\n",
    "org.yml": "tiers:\n  fast: opencode/deepseek-v4.1-flash-free\n  smart: bedrock:eu.anthropic.claude-sonnet-4-6\n",
  });

  test("a tier is named once, in a pack or the file, and the ladder and pins hold its model", () => {
    const p = loadPolicy(read, noFetch, null);

    expect(p.tiers.fast).toEqual({ value: "opencode/deepseek-v4.1-flash-free", source: "pack org.yml" });
    expect(p.ladder?.value).toEqual(["opencode/deepseek-v4.1-flash-free", "bedrock:eu.anthropic.claude-sonnet-4-6"]);
    expect(p.models.loop).toEqual({ value: "bedrock:eu.anthropic.claude-sonnet-4-6", source: ".shepherd/config.yml, tier smart" });
  });

  test("a group pins every member; a pin on one runner or lens beats its group", () => {
    const plan = Object.fromEntries(modelPlan(loadPolicy(read, noFetch, null)).map((r) => [r.runner, r.model]));

    expect(plan.router).toBe("opencode/deepseek-v4.1-flash-free");
    expect(plan.correctness).toBe("opencode/deepseek-v4.1-flash-free");
    expect(plan.house).toBe("opencode/deepseek-v4.1-flash-free"); // a custom lens is a reviewer too
    expect(plan.security).toBe("bedrock:eu.anthropic.claude-sonnet-4-6");
    expect(plan.triage).toBe("bedrock:eu.anthropic.claude-sonnet-4-6");
    expect(plan.verifier).toBe("bedrock:eu.anthropic.claude-sonnet-4-6"); // no validators pin: rung 1 of the ladder
    expect(loadPolicy(read, noFetch, null).models.reviewers).toBeUndefined();
  });

  test("swapping a tier's model swaps it everywhere; a personal tier fills only a name the team left open", () => {
    const p = loadPolicy(read, noFetch, { lenses: {}, tiers: { fast: "mine", spare: "haiku" } });

    expect(p.tiers.fast?.value).toBe("opencode/deepseek-v4.1-flash-free");
    expect(p.tiers.spare).toEqual({ value: "haiku", source: "personal" });
    const swapped = loadPolicy(files({ ".shepherd/config.yml": "tiers: { fast: groq:openai/gpt-oss-120b }\nladder: [fast]\nmodels: { reviewers: fast }\n" }), noFetch, null);

    expect(swapped.models.router?.value).toBe("groq:openai/gpt-oss-120b");
    expect(swapped.ladder?.value).toEqual(["groq:openai/gpt-oss-120b"]);
  });

  test("a personal pin never beats a team pin, even one the team set through a group", () => {
    const team = files({ ".shepherd/config.yml": "models:\n  reviewers: team-model\n  fixers: team-model\n" });
    const p = loadPolicy(team, noFetch, { lenses: {}, models: { security: "personal-model", triage: "personal-model", verifier: "personal-model", validators: "mine" } });

    expect(p.models.security).toEqual({ value: "team-model", source: ".shepherd/config.yml (models.reviewers)" });
    expect(p.models.triage?.value).toBe("team-model");
    // What the team left open, the personal file fills: a runner, or a group's members.
    expect(p.models.verifier).toEqual({ value: "personal-model", source: "personal" });
    expect(p.models.validator).toEqual({ value: "mine", source: "personal (models.validators)" });
  });

  test("CI's session model: SHEPHERD_MODEL (a model or a tier), then models.loop, then the top rung, then a default that says so", () => {
    const p = loadPolicy(read, noFetch, null);

    expect(ciModel(p, "fast")).toEqual({ model: "opencode/deepseek-v4.1-flash-free", source: "SHEPHERD_MODEL, tier fast" });
    expect(ciModel(p, "groq:openai/gpt-oss-120b")).toEqual({ model: "groq:openai/gpt-oss-120b", source: "SHEPHERD_MODEL" });
    expect(ciModel(p, undefined).source).toStartWith("models.loop");
    expect(ciModel(loadPolicy(files({ ".shepherd/config.yml": "ladder: [a, b]\n" }), noFetch, null), undefined)).toEqual({ model: "b", source: "top of the ladder, .shepherd/config.yml" });
    expect(ciModel(loadPolicy(files({}), noFetch, null), undefined).source).toStartWith("default: name one with SHEPHERD_MODEL");
  });
});

// Most comments are written by a model from the skill text, so the CLI resolves and escapes the branding for it.
test("branding: no block posts exactly as before; custom values are merged, escaped, and validated", () => {
  const load = (yml: string) => loadPolicy(files({ ".shepherd/config.yml": yml }), noFetch, null);
  const plain = branding(load("lenses: {}\n"));

  expect(plain.headers.swarm).toBe("> 🤖 Automated comment by **Shepherd swarm**, not written by a human");
  expect(plain.emoji).toEqual({ critical: "🔴", high: "🟠", medium: "🟡", low: "🟢", nit: "⚪", blocked: "🚫", changes_needed: "⚠️", approve_with_nits: "💬", looks_good: "✅", resolved: "✅" });

  const custom = branding(load('branding:\n  name: "Acme <b>*Bot*</b>"\n  avatar: "https://x.test/a.png?v=1&s=\\"y"\n  emoji: { low: "🔵" }\n'));

  expect(custom.headers.swarm).toBe('> 🤖 Automated comment by <img src="https://x.test/a.png?v=1&amp;s=&quot;y" alt="" width="16" height="16"> **Acme &lt;b&gt;\\*Bot\\*&lt;/b&gt; swarm**, not written by a human');
  expect(custom.emoji.low).toBe("🔵");
  expect(custom.emoji.high).toBe("🟠");
  expect(() => load("branding:\n  avatar: http://x.test/a.png\n")).toThrow("https");
  expect(() => load("branding:\n  emoji: { high: \"a b\" }\n")).toThrow();
  expect(() => load(`branding:\n  emoji: { high: "${"x".repeat(17)}" }\n`)).toThrow();
});

describe("CI settings", () => {
  const load = (map: Record<string, string>) => loadPolicy(files(map), noFetch, null);

  test("a non-blank variable beats the default branch's config, which beats the default; a blank variable is unset", () => {
    const p = load({ ".shepherd/config.yml": "ci:\n  label: from-config\n  notify_on: [failure]\n  audit: { public: true }\n" });
    const at = (env: Record<string, string>) => ciSettings(p, env);

    expect(at({}).label).toEqual({ value: "from-config", source: "config", variable: "SHEPHERD_LABEL" });
    expect(at({ SHEPHERD_LABEL: "from-var" }).label).toMatchObject({ value: "from-var", source: "variable" });
    expect(at({ SHEPHERD_LABEL: "  " }).label).toMatchObject({ value: "from-config", source: "config" }); // what GitHub passes for an unset variable
    expect(at({}).notify_on.value).toBe("failure");
    expect(at({}).audit_public.value).toBe("true");
    expect(at({}).max_commits).toMatchObject({ value: "20", source: "default" });
    expect(ciSettings(load({}), { AWS_REGION: "" }).aws_region).toMatchObject({ value: "", source: "default" });
    expect(() => at({ SHEPHERD_LABEL: "a\nrun=true" })).toThrow("one line");

    // The commit cap fails closed: a variable that is not a count stops the settings step, never the cap.
    for (const bad of ["abc", "0", "-1", "1e3", "2 0"]) expect(() => at({ SHEPHERD_MAX_COMMITS: bad })).toThrow("SHEPHERD_MAX_COMMITS");
    expect(at({ SHEPHERD_MAX_COMMITS: "5" }).max_commits.value).toBe("5");
  });

  // The push deny list is a security control: config can widen it, never narrow it, across packs too.
  test("push_deny only grows: a repository adds to its pack's patterns and cannot drop them", () => {
    const p = load({ ".shepherd/config.yml": "extends: [pack.yml]\nci:\n  push_deny: ['^infra/']\n", "pack.yml": "ci:\n  push_deny: ['^secrets/|^vault/']\n" });

    expect(ciSettings(p, {}).push_deny).toMatchObject({ value: "(^secrets/|^vault/)|(^infra/)", source: "config" });
    expect(ciSettings(load({}), {}).push_deny.value).toBe("");
    expect(() => load({ ".shepherd/config.yml": "ci:\n  push_deny: []\n" })).toThrow();
  });
});
