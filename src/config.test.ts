import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Fetch, type FetchDir, fetchPackLenses, lensCache, loadPolicy, policyProblems, preview, type Read, recipeProblems } from "./config.ts";
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

  test("a pack cannot extend another, escape the repository, or be missing", () => {
    expect(() => loadPolicy(files({ ".shepherd/config.yml": "extends: [a.yml]\n", "a.yml": "extends: [b.yml]\n" }), noFetch, null)).toThrow("cannot extend another pack");
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
