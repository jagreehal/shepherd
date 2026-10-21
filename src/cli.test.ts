// The adoption path end to end, through the real CLI: a repository with an origin, a throwaway HOME.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Ajv from "ajv";
import { ConfigSchema, configJsonSchema } from "./config.ts";
import { runsStamp } from "./doctor.ts";
import { pinWorkflow } from "./install.ts";
import path from "node:path";
import { parse, stringify } from "yaml";

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

  test("init points a pstack user at the pstack lens, and stops once the policy has it", () => {
    const { home, run } = repo();
    const pstack = path.join(home, "plugins", "pstack");

    write(pstack, { "skills/principle-fix-root-causes/SKILL.md": "---\nname: principle-fix-root-causes\ndescription: Fix root causes\n---\n" });
    write(home, { ".claude/plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "pstack@cursor-plugins": [{ installPath: pstack }] } }) });

    expect(run("init").out).toContain("pstack is installed: review against its principles with shepherd lens new pstack --from pstack");
    expect(run("lens", "new", "pstack", "--from", "pstack").code).toBe(0);
    expect(run("init", "--stacks").out).not.toContain("pstack is installed");
    expect(run("lens", "add", "pstack:principle-fix-root-causes", "--name", "root-cause").out).toContain(path.join(pstack, "skills", "principle-fix-root-causes"));
  });

  test("init detects the stacks a repository uses and, with --stacks, adds a lens for each that validates", () => {
    const files = { "web/package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }), "svc/go.mod": "module x\n", "api/App.csproj": "<Project />\n" };

    const later = repo(files);

    expect(later.run("init").out).toContain("detected dotnet, go, nextjs, owasp-asvs, react: run shepherd init --stacks");
    // The follow-up it suggests works on the policy it just wrote, and keeps that policy's settings.
    const follow = later.run("init", "--stacks");

    expect(follow.code).toBe(0);
    expect(follow.out).toContain("lens go: .shepherd/lenses/go");
    expect(readFileSync(path.join(later.dir, ".shepherd/config.yml"), "utf8")).toMatch(/mode: suggest[\s\S]*skill: \.shepherd\/lenses\/go|skill: \.shepherd\/lenses\/go[\s\S]*mode: suggest/);
    expect(later.run("init", "--stacks").out).toContain("lens go: kept, from .shepherd/config.yml");
    const { dir, run } = repo(files);
    const init = run("init", "--stacks");

    expect(init.code).toBe(0);
    expect(init.out).toContain("lens go: .shepherd/lenses/go from the go starter");
    const config = readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8");

    expect(config).toContain("skill: .shepherd/lenses/nextjs");
    expect(config).toContain("gate: escalate");
    expect(readFileSync(path.join(dir, ".shepherd/lenses/dotnet/SKILL.md"), "utf8")).toMatch(/^name: dotnet$/m);
    expect(run("lens", "list").code).toBe(0);
  });

  test("--stacks keeps a lens a pack already provides: its skill, scope and gate stay the team's", () => {
    const pack = {
      "web/package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }),
      "svc/go.mod": "module x\n",
      "team/react-house/SKILL.md": "---\nname: react-house\ndescription: House React rules\n---\n\n## Review\n\n- **no-any-props**: typed props.\n",
      ".shepherd/packs/web.yml": "lenses:\n  react: { skill: team/react-house, applies_to: ['web/**'], gate: refuse }\n",
    };

    const expectKept = (run: (...args: string[]) => { code: number | null; out: string }, dir: string) => {
      const config = readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8");

      expect(config).not.toContain("react:");
      expect(config).toContain("skill: .shepherd/lenses/go");
      expect(existsSync(path.join(dir, ".shepherd/lenses/react"))).toBe(false);
      const explain = run("config", "explain", "--working-tree", "--json").out;
      const react = JSON.parse(explain).lenses.react;

      expect(react.value).toEqual({ skill: "team/react-house", applies_to: ["web/**"], gate: "refuse" });
      expect(react.source).toBe("pack .shepherd/packs/web.yml");
    };

    // An existing policy that extends the pack.
    const existing = repo({ ...pack, ".shepherd/config.yml": "extends: [.shepherd/packs/web.yml]\nfixes: { mode: suggest }\n" });
    const add = existing.run("init", "--stacks");

    expect(add.code).toBe(0);
    expect(add.out).toContain("lens react: kept, from pack .shepherd/packs/web.yml");
    expectKept(existing.run, existing.dir);

    // A new policy started from the pack.
    const fresh = repo(pack);
    const init = fresh.run("init", "--from", ".shepherd/packs/web.yml", "--stacks");

    expect(init.code).toBe(0);
    expect(init.out).toContain("lens react: kept, from pack .shepherd/packs/web.yml");
    expectKept(fresh.run, fresh.dir);
  });

  test("name models once as tiers, pin roles to them, and CI reads the result from the default branch", () => {
    const { run, merge } = repo();

    expect(run("init").code).toBe(0);
    expect(run("models", "tier", "fast", "opencode/deepseek-v4.1-flash-free").code).toBe(0);
    expect(run("models", "tier", "smart", "bedrock:eu.amazon.nova-micro-v1:0").code).toBe(0);
    expect(run("models", "ladder", "fast", "smart").code).toBe(0);
    expect(run("models", "pin", "reviewers", "fast").code).toBe(0);
    const shown = run("models", "pin", "loop", "smart").out;

    expect(shown).toContain("tier    smart");
    expect(shown).toContain("amazon-bedrock/eu.amazon.nova-micro-v1:0");
    merge();
    const plan = JSON.parse(run("ci-models").out);

    expect(plan.model).toBe("amazon-bedrock/eu.amazon.nova-micro-v1:0");
    expect(plan.key_env).toBe("AWS_BEARER_TOKEN_BEDROCK");
    expect(plan.key_envs).toEqual(["AWS_BEARER_TOKEN_BEDROCK", "OPENCODE_API_KEY"]);
    expect(plan.opencode.agent["shepherd-r0"].model).toBe("opencode/deepseek-v4.1-flash-free");
    expect(plan.opencode.agent["shepherd-pin-security"].model).toBe("opencode/deepseek-v4.1-flash-free"); // reviewers: fast
    expect(plan.opencode.enabled_providers).toEqual(["amazon-bedrock", "opencode"]); // the providers the team named, no others
  });

  // OpenCode's own agents and its small model choose for themselves when nothing names one. CI names one for each and
  // enables only the plan's providers.
  test("with only a session model, CI pins OpenCode's own agents and small model to it and enables no other provider", () => {
    const { run, merge } = repo();

    expect(run("init", "--model", "bedrock:minimax.minimax-m2.5").code).toBe(0);
    merge();
    const { model, opencode } = JSON.parse(run("ci-models").out);

    expect(model).toBe("amazon-bedrock/minimax.minimax-m2.5");
    expect(opencode.model).toBe(model);
    expect(opencode.small_model).toBe(model);
    expect(opencode.enabled_providers).toEqual(["amazon-bedrock"]);

    for (const name of ["build", "plan", "general", "explore", "title", "summary", "compaction"]) expect({ name, model: opencode.agent[name]?.model }).toEqual({ name, model });
  });

  // An agent's glob can skip dot-directories such as .shepherd/. explain hands each lens its directory, taken from the
  // default branch, and fails when a team lens is not there.
  test("explain --json gives a repository lens the default branch's copy, never the checkout's, and fails on a missing one", () => {
    const { dir, run, merge } = repo();

    expect(run("init").code).toBe(0);
    expect(run("lens", "new", "mine").code).toBe(0);
    merge();
    write(dir, { ".shepherd/lenses/mine/SKILL.md": "---\nname: mine\ndescription: rewritten by the PR\n---\n" });
    const explained = run("config", "explain", "--json");
    const lensPath: string = JSON.parse(explained.out).lenses.mine.path;

    expect(explained.code).toBe(0);
    expect(lensPath.startsWith(path.join(dir, ".shepherd"))).toBe(false);
    expect(readFileSync(path.join(lensPath, "SKILL.md"), "utf8")).not.toContain("rewritten by the PR");

    const config = parse(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8"));

    write(dir, { ".shepherd/config.yml": stringify({ ...config, lenses: { ...config.lenses, gone: { skill: ".shepherd/lenses/gone" } } }) });
    merge();
    const missing = run("config", "explain", "--json");

    expect(missing.code).toBe(1);
    expect(missing.out).toContain("lens gone: skill .shepherd/lenses/gone not found on the default branch");
  });

  test("explain --json resolves a bare-name repository lens and its siblings from the default branch when the PR deletes or shadows it", () => {
    const { dir, run, merge } = repo();

    expect(run("init").code).toBe(0);
    const config = parse(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8"));

    write(dir, {
      ".agents/skills/team-review/SKILL.md": "---\nname: team-review\ndescription: on main\n---\nSee ../shared/SKILL.md.\n",
      ".agents/skills/shared/SKILL.md": "---\nname: shared\ndescription: a sibling the lens points at\n---\n",
      ".shepherd/config.yml": stringify({ ...config, lenses: { ...config.lenses, team: { skill: "team-review" } } }),
    });
    merge();
    rmSync(path.join(dir, ".agents/skills/team-review"), { recursive: true });
    const explained = run("config", "explain", "--json");
    const lensPath: string = JSON.parse(explained.out).lenses.team.path;

    expect(explained.code).toBe(0);
    expect(readFileSync(path.join(lensPath, "SKILL.md"), "utf8")).toContain("on main");
    expect(existsSync(path.join(lensPath, "../shared/SKILL.md"))).toBe(true); // ../shared/SKILL.md from the same commit

    // .claude/skills comes first in the search: a PR adding the name there must not displace the team's lens.
    write(dir, { ".claude/skills/team-review/SKILL.md": "---\nname: team-review\ndescription: from the PR\n---\n" });
    const shadowed = run("config", "explain", "--json");

    expect(shadowed.code).toBe(0);
    expect(readFileSync(path.join(JSON.parse(shadowed.out).lenses.team.path, "SKILL.md"), "utf8")).toContain("on main");
  });

  test("fanout lists correctness on the whole diff and each custom lens on its matching files, from the default branch", () => {
    const { dir, run, merge } = repo();

    expect(run("init").code).toBe(0);
    expect(run("lens", "new", "robustness", "--applies", "src/**/*.ts").code).toBe(0);
    expect(run("lens", "new", "styles", "--applies", "**/*.css").code).toBe(0);
    merge();
    write(dir, { "src/b.ts": "export const b = 2;\n" });
    const out = run("fanout");
    const { files, lenses } = JSON.parse(out.out);

    expect(out.code).toBe(0);
    expect(files).toEqual(["src/b.ts"]);
    expect(JSON.parse(out.out).head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(lenses.map((l: { lens: string }) => l.lens)).toEqual(["correctness", "robustness"]);
    expect(lenses[0]).toEqual({ lens: "correctness", scope: "full", skill: "../review-correctness/SKILL.md" });
    expect(lenses[1].scope).toEqual(["src/b.ts"]);
    expect(lenses[1].path.startsWith(path.join(dir, ".shepherd"))).toBe(false); // the default branch's copy
  });

  test("init points editors at the schema of the version that wrote it, and later edits keep the line", () => {
    const { dir, run } = repo();
    const file = path.join(dir, ".shepherd/config.yml");
    const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dir, "../package.json"), "utf8"));

    expect(run("init").code).toBe(0);
    expect(readFileSync(file, "utf8").split("\n")[0]).toBe(`# yaml-language-server: $schema=https://unpkg.com/@jagreehal/shepherd@${version}/schema/config.json`);
    expect(run("models", "pin", "loop", "bedrock:minimax.minimax-m2.5").code).toBe(0);
    expect(readFileSync(file, "utf8")).toMatch(/^# yaml-language-server: \$schema=.*\n# shepherd team policy[\s\S]*loop: bedrock:minimax\.minimax-m2\.5/);
  });

  // Editors validate .shepherd/config.yml against schema/config.json: the committed file must be what the code accepts.
  test("schema/config.json is the schema config schema prints, and covers every top-level key", () => {
    const printed = repo().run("config", "schema").out;

    expect(readFileSync(path.join(import.meta.dir, "../schema/config.json"), "utf8")).toBe(printed);
    expect(Object.keys(JSON.parse(printed).properties)).toEqual(Object.keys(ConfigSchema.shape));
  });

  // The schema an editor reads must refuse what the CLI refuses, or a file that looks valid fails at run time.
  test("the schema and the CLI agree on representative configs", () => {
    const valid = new Ajv({ strict: false }).compile(configJsonSchema());

    const cases: [string, unknown][] = [
      ["a full policy", { fixes: { mode: "suggest" }, models: { loop: "bedrock:minimax.minimax-m2.5" }, ci: { label: "shepherd", max_commits: 20 }, branding: { name: "Acme", avatar: "https://acme.dev/a.png", emoji: { high: "🔥" } } }],
      ["an http avatar", { branding: { avatar: "http://acme.dev/a.png" } }],
      ["an https avatar with a query", { branding: { avatar: "https://acme.dev/a.png?s=64" } }],
      ["a whitespace-only name", { branding: { name: "   " } }],
      ["an unknown key", { fixes: { mode: "suggest", extra: true } }],
      ["a fix mode that does not exist", { fixes: { mode: "yolo" } }],
      ["a glyph with markup", { branding: { emoji: { high: "<b>" } } }],
    ];

    for (const [name, config] of cases) expect({ name, schema: valid(config) }).toEqual({ name, schema: ConfigSchema.safeParse(config).success });

    expect(cases.flatMap(([name, c]) => (valid(c) ? [name] : []))).toEqual(["a full policy", "an https avatar with a query"]);
  });

  // URL parsing takes forms no regex matches exactly. The editor schema's avatar is a subset of the CLI's: whatever an
  // editor passes, the CLI accepts, and the CLI keeps accepting what it always has.
  test("an avatar the schema accepts, the CLI accepts, across hosts, ports and paths", () => {
    const valid = new Ajv({ strict: false }).compile(configJsonSchema());
    const cli = (avatar: string) => ConfigSchema.safeParse({ branding: { avatar } }).success;
    const hosts = ["acme.dev", "localhost", "999.999.999.999", "1.2.3.4", "0x7f.1", "a..b", "-a.b", "a_b.c", "é.dev", "ac%20me.dev", "", "[::1]", "[:]", "u:p@acme.dev"];
    const ports = ["", ":", ":0", ":8443", ":65535", ":65536", ":x"];
    const paths = ["", "/a.png", "/a b", "?s=64", "#f"];
    const urls = hosts.flatMap((h) => ports.flatMap((p) => paths.map((x) => `https://${h}${p}${x}`)));
    const looser = urls.filter((u) => valid({ branding: { avatar: u } }) && !cli(u));

    expect(urls.length).toBe(490);
    expect(looser).toEqual([]);
    expect(valid({ branding: { avatar: "https://acme.dev:8443/a.png?s=64" } })).toBe(true);

    for (const kept of ["https://é.dev/a", "https://[::1]:8443/a", "https://u:p@acme.dev/a", "https://1.2.3.4/a"]) expect({ kept, cli: cli(kept) }).toEqual({ kept, cli: true });
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

  test("a legacy lenses.yml migrates keeping its settings, starts review-only with the push opt-in named, and validate wants it deleted", () => {
    const { dir, run } = repo({ ".shepherd/lenses.yml": "ladder: [haiku, sonnet]\n" });

    const init = run("init");

    expect(init.out).toContain("from .shepherd/lenses.yml");
    const config = readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8");

    expect(config).toContain("- haiku");
    expect(config).toContain("mode: suggest");
    expect(init.out).toContain("shepherd init --preset push");
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

  test("workflows --upgrade rewrites a kept workflow from the template, keeping its environment and CI list, and asks for SHEPHERD_TOKEN only when fixes push", () => {
    const { dir, run } = repo();
    const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dir, "../package.json"), "utf8"));
    const file = path.join(dir, ".github/workflows/shepherd.yml");

    expect(run("workflows", "--environment", "ai-review").out).toContain("add SHEPHERD_TOKEN as a repository secret");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^( +workflows: )\[ci, stamp\]/m, "$1[build, stamp]").replace(/SHEPHERD_VERSION: \S+/g, "SHEPHERD_VERSION: 0.0.1"));
    expect(run("workflows").out).toContain("(exists): run `shepherd workflows --upgrade` to update it");

    write(dir, { ".shepherd/config.yml": "fixes: { mode: suggest }\n" });
    const out = run("workflows", "--upgrade").out;
    const text = readFileSync(file, "utf8");

    expect(out).toContain(`upgraded  .github/workflows/shepherd.yml to ${version} (kept environment ai-review, workflows [build, stamp])`);
    expect(text).toContain(`SHEPHERD_VERSION: ${version} `);
    expect(text).toContain("    environment: ai-review #");
    expect(text).toContain("workflows: [build, stamp]");
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toBe("fixes: { mode: suggest }\n");
    expect(out).not.toContain("add SHEPHERD_TOKEN");
    expect(out).toContain("SHEPHERD_TOKEN is not needed until fixes.mode is push");
  });

  test("workflows --model names the session model in the team policy, and --environment scopes the model keys", () => {
    const { dir, run } = repo();
    const out = run("workflows", "--model", "bedrock:minimax.minimax-m2.5", "--environment", "ai-review", "--label", "shepherd", "--aws-region", "eu-west-1").out;

    expect(out).toContain("pinned    models.loop: bedrock:minimax.minimax-m2.5 in .shepherd/config.yml");
    expect(out).toContain("as secrets of the ai-review environment");
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toContain("loop: bedrock:minimax.minimax-m2.5");
    expect(readFileSync(path.join(dir, ".github/workflows/shepherd.yml"), "utf8")).toContain("    environment: ai-review #");
    expect(out).toContain("set       ci.label: shepherd, ci.aws_region: eu-west-1");
    // Every setting with its source, and a secret only as set or unset.
    const explained = run("config", "explain", "--working-tree").out;

    expect(explained).toMatch(/ci\.label\s+shepherd\s+config/);
    expect(explained).toMatch(/ci\.max_commits\s+20\s+default/);
    expect(explained).toMatch(/SHEPHERD_TOKEN\s+(set|unset)\s+secret/);

    const rerun = repo();

    rerun.run("workflows");
    expect(rerun.run("workflows", "--environment", "ai-review").out).toContain("scoped    .github/workflows/shepherd.yml to the ai-review environment");
    expect(readFileSync(path.join(rerun.dir, ".github/workflows/shepherd.yml"), "utf8")).toContain("    environment: ai-review #");
    write(rerun.dir, { ".github/workflows/shepherd-incident.yml": "name: mine\n" });
    expect(rerun.run("workflows", "--environment", "ai-review").out).toContain("shepherd-incident.yml (exists): add `environment: ai-review` to its model job by hand");

    const fresh = repo();

    expect(fresh.run("init", "--model", "bedrock:minimax.minimax-m2.5").out).toContain("with models.loop bedrock:minimax.minimax-m2.5");
    expect(readFileSync(path.join(fresh.dir, ".shepherd/config.yml"), "utf8")).toMatch(/^# yaml-language-server: \$schema=.*\n# shepherd team policy[\s\S]*loop: bedrock:minimax\.minimax-m2\.5/);
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
