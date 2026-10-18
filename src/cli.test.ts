// The adoption path end to end, through the real CLI: a repository with an origin, a throwaway HOME.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runsStamp } from "./doctor.ts";
import { pinWorkflow } from "./install.ts";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "cli.ts");

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** A clone of a bare origin on `main`, with one commit, and its own HOME. */
function repo(files: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-cli-"));
  const home = path.join(root, "home");
  const dir = path.join(root, "repo");

  dirs.push(root);
  mkdirSync(home);
  const env = { ...process.env, ...ID, HOME: home };
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });

  spawnSync("git", ["init", "-q", "--bare", "-b", "main", path.join(root, "origin.git")]);
  spawnSync("git", ["clone", "-q", path.join(root, "origin.git"), dir], { env });
  write(dir, { "src/a.ts": "export const a = 1;\n", ...files });
  git("add", "-A");
  git("commit", "-qm", "init");
  git("push", "-q", "origin", "HEAD:main");

  const run = (...args: string[]) => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });

    return { code: r.status, out: r.stdout + r.stderr };
  };

  const merge = () => {
    git("add", "-A");
    git("commit", "-qm", "policy");
    git("push", "-q", "origin", "HEAD:main");
  };

  return { dir, home, run, merge };
}

function write(dir: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
}

describe("adoption", () => {
  test("init -> validate -> explain -> preview: a new repository starts review-only and sees the whole plan", () => {
    const { dir, run, merge } = repo();

    const init = run("init");

    expect(init.code).toBe(0);
    expect(init.out).toContain("preset review-only");
    expect(init.out).toContain("shepherd preview --working-tree");
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toContain("mode: suggest");

    expect(run("config", "validate").out).toContain("ok: .shepherd/config.yml");
    expect(run("config", "explain", "--working-tree").out).toMatch(/fixes\.mode\s+suggest\s+\.shepherd\/config\.yml/);
    merge();
    expect(run("config", "explain").out).toContain("default branch");

    write(dir, { "src/a.ts": "export const a = 2;\n" });
    const plan = run("preview").out;

    expect(plan).toMatch(/model\s+correctness\s+harness rung 1/);
    expect(plan).toContain("recipe    review: swarm");
    expect(plan).toContain("posts review comments on the PR");
    expect(plan).toContain("says nothing about merge readiness");

    const pr = run("preview", "--recipe", "pr").out;

    expect(pr).toContain("blocked   recipe pr: fixes.mode is suggest");
    expect(pr).toContain("completes cannot run under this policy");
  });

  test("presets set how far fixes go, and preview says what each step writes", () => {
    const local = repo();

    expect(local.run("init", "--preset", "local-fix").code).toBe(0);
    const plan = local.run("preview", "--working-tree").out;

    expect(plan).toContain("recipe    fix: swarm > triage > simplify > swarm");
    expect(plan).toMatch(/writes\s+triage\s+edits your working tree/);
    expect(plan).toContain("fixes_uncommitted");
    expect(local.run("preview", "--working-tree", "--recipe", "pr").out).toContain("stamp cannot see ci-repair's fixes");

    const push = repo();

    push.run("init", "--preset", "push");
    expect(push.run("preview", "--working-tree").out).toMatch(/writes\s+triage\s+commits and pushes/);
    expect(push.run("init", "--preset", "yolo").code).toBe(1);
  });

  test("a legacy lenses.yml migrates keeping its settings and push mode, and validate wants it deleted", () => {
    const { dir, run } = repo({ ".shepherd/lenses.yml": "ladder: [haiku, sonnet]\n" });

    const init = run("init");

    expect(init.out).toContain("from .shepherd/lenses.yml");
    const config = readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8");

    expect(config).toContain("- haiku");
    expect(config).toContain("mode: push");
    expect(init.code).toBe(1);
    expect(init.out).toContain(".shepherd/lenses.yml is ignored while .shepherd/config.yml exists");

    rmSync(path.join(dir, ".shepherd/lenses.yml"));
    expect(run("config", "validate").code).toBe(0);
  });

  test("suggest mode rejects a team recipe that fixes", () => {
    const { dir, run } = repo();

    write(dir, { ".shepherd/config.yml": "fixes: { mode: suggest }\nrecipes:\n  quick: { steps: [swarm, triage, swarm] }\n" });
    const r = run("config", "validate");

    expect(r.code).toBe(1);
    expect(r.out).toContain("recipe quick: fixes.mode is suggest, so it cannot run triage");
  });

  test("lens list shows a pack's lenses with their source and problems, and a personal one as a preview", () => {
    const { dir, home, run } = repo();

    write(home, { ".config/shepherd/lenses.yml": "lenses:\n  mine: { skill: .shepherd/lenses/payments }\n" });
    write(dir, {
      ".shepherd/packs/org.yml": "lenses:\n  payments: { skill: .shepherd/lenses/payments, applies_to: ['src/pay/**'] }\n",
      ".shepherd/config.yml": "extends: [.shepherd/packs/org.yml]\n",
    });
    const r = run("lens", "list");

    expect(r.out).toMatch(/payments\s+MISSING \.shepherd\/lenses\/payments.*\(pack \.shepherd\/packs\/org\.yml\)/);
    expect(r.out).toContain("problem: no SKILL.md found");
    expect(r.out).toMatch(/mine\s+personal preview/);
    expect(r.code).toBe(1);
  });

  test("workflows copies the shepherd and incident workflows pinned to this version, and keeps a file you edited", () => {
    const { dir, run } = repo({ ".github/workflows/shepherd-incident.yml": "name: mine\n" });
    const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dir, "../package.json"), "utf8"));
    const out = run("workflows").out;

    expect(out).toContain("wrote     .github/workflows/shepherd.yml");
    expect(out).toContain("kept      .github/workflows/shepherd-incident.yml (exists)");
    expect(readFileSync(path.join(dir, ".github/workflows/shepherd.yml"), "utf8")).toContain(`SHEPHERD_VERSION: ${version} `);
    expect(readFileSync(path.join(dir, ".github/workflows/shepherd-incident.yml"), "utf8")).toBe("name: mine\n");
  });

  test("pinWorkflow sets every SHEPHERD_VERSION pin in both templates, not just the first", () => {
    for (const name of ["shepherd.yml", "shepherd-incident.yml"]) {
      const text = readFileSync(path.resolve(import.meta.dir, "../templates", name), "utf8");

      const pins = pinWorkflow(text, "9.9.9").match(/SHEPHERD_VERSION: \S+/g) ?? [];

      expect(pins.length).toBe(text.match(/SHEPHERD_VERSION: \S+/g)?.length ?? -1);
      expect(new Set(pins)).toEqual(new Set(["SHEPHERD_VERSION: 9.9.9"]));
    }
  });

  test("both workflow templates put the pinned CLI on PATH, so no skill step reaches an unpinned bunx", () => {
    for (const name of ["shepherd.yml", "shepherd-incident.yml"]) {
      const text = readFileSync(path.resolve(import.meta.dir, "../templates", name), "utf8");

      expect(text).toContain('bun add -g "@jagreehal/shepherd@$SHEPHERD_VERSION"');
      expect(text).toContain('echo "$HOME/.bun/bin" >> "$GITHUB_PATH"');
      expect(text).not.toMatch(/bunx\s+"?@jagreehal\/shepherd/);

      // Third-party actions run on a commit SHA, and the write token never sits in job-level env where they could read it.
      for (const [, ref] of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) if (!ref!.startsWith("actions/")) expect(ref).toMatch(/@[0-9a-f]{40}$/);
      expect(text).not.toMatch(/^ {6}GH_TOKEN: \$\{\{ secrets\.SHEPHERD_TOKEN/m);
    }
  });

  test("doctor names what is missing and how to fix it", () => {
    const { dir, run } = repo({ ".shepherd/config.yml": "ladder: [haiku, mystery]\n" });
    const checks = JSON.parse(run("doctor", "--json").out);
    const by = (name: string) => checks.find((c: { check: string }) => c.check === name);

    expect(by("default branch")?.status).toBe("ok");
    expect(by("skills")).toMatchObject({ status: "fail", fix: expect.stringContaining("shepherd install") });
    expect(by("model haiku")?.status).toBe("ok");
    expect(by("model mystery")?.status).toBe("warn");
    expect(by("stamp workflow")?.status).toBe("warn");

    write(dir, { ".github/workflows/stamp.yml": "name: stamp\non: pull_request\njobs:\n  review:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bunx \"@jagreehal/stamp@1\" \"$PR\" --post\n" });
    run("install", "--project");
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "stamp"], { cwd: dir, env: { ...process.env, ...ID } });
    spawnSync("git", ["push", "-q", "origin", "HEAD:main"], { cwd: dir });
    const after = JSON.parse(run("doctor", "--json").out);

    expect(after.find((c: { check: string }) => c.check === "skills")?.status).toBe("ok");
    expect(after.find((c: { check: string }) => c.check === "stamp workflow")?.status).toBe("ok");
    expect(after.find((c: { check: string }) => c.check === "stamp runs")?.status).toBe("warn"); // no GitHub here
  }, 60_000);

  test("acceptance fails, apart from any violation, when the agent did not finish", () => {
    const { run } = repo();
    const missing = run("acceptance", "suggest", "--", "/no/such/agent");

    expect(missing.code).toBe(2);
    expect(missing.out).toContain("error: the agent did not start");
    expect(missing.out).toContain("inconclusive");
    expect(run("acceptance", "suggest", "--", "false").out).toContain("error: the agent exited 1");
    expect(run("acceptance", "suggest", "--", "true").code).toBe(0);
  });

  test("OpenCode models a pack sets reach opencode-agents, models and preview", () => {
    const { dir, run, merge } = repo();

    write(dir, {
      ".shepherd/packs/org.yml": "ladder: [opencode-go/deepseek-v4-flash, opencode-go/kimi-k3]\nmodels: { security: opencode-go/qwen3.8-max }\n",
      ".shepherd/config.yml": "extends: [.shepherd/packs/org.yml]\n",
    });
    merge();

    const agents = JSON.parse(run("opencode-agents").out).agent;

    expect(agents["shepherd-r0"].model).toBe("opencode-go/deepseek-v4-flash");
    expect(agents["shepherd-pin-security"].model).toBe("opencode-go/qwen3.8-max");
    expect(run("models").out).toContain("opencode-go/deepseek-v4-flash -> opencode-go/kimi-k3");

    // A PR checkout rewrites the pack; --file still resolves it from the default branch.
    write(dir, { ".shepherd/packs/org.yml": "ladder: [attacker/model]\n", "given.yml": "extends: [.shepherd/packs/org.yml]\n" });
    expect(JSON.parse(run("opencode-agents", "--file", "given.yml").out).agent["shepherd-r0"].model).toBe("opencode-go/deepseek-v4-flash");

    const plan = run("preview").out;

    expect(plan).toMatch(/model\s+router\s+opencode-go\/deepseek-v4-flash\s+\(rung 0, pack \.shepherd\/packs\/org\.yml\)/);
    expect(plan).toMatch(/model\s+security\s+opencode-go\/qwen3\.8-max\s+\(pinned, pack/);
  });
});

test("only a workflow that invokes stamp on pull requests counts as running it", () => {
  const steps = (s: string) => `on: [pull_request]\njobs:\n  r:\n    steps:\n${s}`;

  expect(runsStamp("name: stamp\n")).toBe(false);
  expect(runsStamp(steps("      - run: echo stamp\n"))).toBe(false);
  expect(runsStamp(steps("      - uses: jagreehal/stamp@v1\n"))).toBe(true);
  expect(runsStamp(steps("      - run: bunx @jagreehal/stamp 1 --post\n"))).toBe(true);
  expect(runsStamp(steps("      - uses: actions/checkout@v4\n        with: { repository: jagreehal/stamp, path: .stamp-tool }\n      - run: bun .stamp-tool/src/cli.ts 1\n"))).toBe(true);
  expect(runsStamp(steps("      - uses: actions/checkout@v4\n        with: { repository: jagreehal/stamp, path: .stamp-tool }\n"))).toBe(false);
  expect(runsStamp("on: { push: {} }\njobs:\n  r:\n    steps:\n      - uses: jagreehal/stamp@v1\n")).toBe(false);
});
