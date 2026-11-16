// The adoption path end to end, through the real CLI: a repository with an origin, a throwaway HOME.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import Ajv from "ajv";
import { ConfigSchema, configJsonSchema } from "./config.ts";
import { runsGate, uncoveredByOwners } from "./doctor.ts";
import { checkFor, PERSON_DECIDES } from "../gate/src/github.ts";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";

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
  test("help lists the everyday commands; --help on a command shows its forms and runs nothing", () => {
    const { dir, run } = repo();

    expect(run().out).toMatch(/commands:\n {2}init .*\n {2}doctor .*\n {2}review .*\n {2}status /);
    expect(run("help", "--all").out).toContain("shepherd fanout");
    expect(run("init", "--help").out).toContain("shepherd init [--preset");
    expect(existsSync(path.join(dir, ".shepherd/config.yml"))).toBe(false);
    expect(run("status")).toEqual({ code: 2, out: expect.stringContaining("shepherd status <pr>") });
  });

  test("init picks the model from team policy and the keys present, never from a personal pin CI cannot see", () => {
    const { dir, home } = repo();

    write(home, { ".config/shepherd/lenses.yml": "models:\n  loop: openai/gpt-5.5\n" });
    const env = { ...process.env, ...ID, HOME: home, OPENCODE_API_KEY: "k", SHEPHERD_MODEL: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "" };
    const r = spawnSync("bun", [CLI, "init"], { cwd: dir, env, encoding: "utf8" });

    expect(r.stdout).toContain("model     opencode-go/deepseek-v4.1-flash (OPENCODE_API_KEY is set)");
    expect(r.stdout).toContain("gh secret set OPENCODE_API_KEY");
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toContain("loop: opencode-go/deepseek-v4.1-flash");
  });

  test("init -> validate -> explain -> preview: a new repository starts review-only and sees the whole plan", () => {
    const { dir, run, merge } = repo();

    const init = run("init");

    expect(init.code).toBe(0);
    expect(init.out).toContain("preset review-only");
    expect(init.out).toContain("created .github/workflows/shepherd.yml"); // one command writes the one workflow
    // One config file: the reviewer's policy sits under review: next to the lenses, and no gate.yml is written.
    expect(init.out).toContain("review: in .shepherd/config.yml");
    expect(existsSync(path.join(dir, ".shepherd/gate.yml"))).toBe(false);
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toMatch(/^review:\n(?: {2}.*\n|\n)* {2}version: 1$/m);
    expect(init.out).toContain("shepherd doctor");
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

  test("name models once as tiers and pin roles to them", () => {
    const { run } = repo();

    expect(run("init").code).toBe(0);
    expect(run("models", "tier", "fast", "opencode/deepseek-v4.1-flash-free").code).toBe(0);
    expect(run("models", "tier", "smart", "bedrock:eu.amazon.nova-micro-v1:0").code).toBe(0);
    expect(run("models", "ladder", "fast", "smart").code).toBe(0);
    expect(run("models", "pin", "reviewers", "fast").code).toBe(0);
    const shown = run("models", "pin", "loop", "smart").out;

    expect(shown).toContain("tier    smart");
    expect(shown).toContain("amazon-bedrock/eu.amazon.nova-micro-v1:0");
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
    expect(local.run("preview", "--working-tree", "--recipe", "pr").out).toContain("gate cannot see ci-repair's fixes");

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

  test("workflows writes the one workflow pinned to this version, keeps a file you edited, and names the old ones to delete", () => {
    const { dir, run } = repo({ ".github/workflows/shepherd-incident.yml": "name: mine\n" });
    const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dir, "../package.json"), "utf8"));
    const out = run("workflows").out;

    expect(out).toContain("created .github/workflows/shepherd.yml");
    expect(readFileSync(path.join(dir, ".github/workflows/shepherd.yml"), "utf8")).toContain(`SHEPHERD_VERSION: \${{ vars.SHEPHERD_VERSION || '${version}' }} `);
    // A workflow from before shepherd was one reviewer would post a second review: the installer names it, never deletes it.
    expect(out).toContain("Delete .github/workflows/shepherd-incident.yml: .github/workflows/shepherd.yml replaces it.");
    expect(readFileSync(path.join(dir, ".github/workflows/shepherd-incident.yml"), "utf8")).toBe("name: mine\n");
    expect(run("workflows").out).toContain("kept    .github/workflows/shepherd.yml (exists)");
  });

  test("--upgrade moves an older gate.yml under review: in config.yml, and removes it only once it reads back", () => {
    const policy = readFileSync(path.resolve(import.meta.dir, "../gate/.shepherd/gate.yml"), "utf8").replace("max_lines: 800", "max_lines: 640");
    const { dir, run } = repo({ ".shepherd/gate.yml": policy, ".shepherd/config.yml": "lenses: {}\n" });

    expect(run("workflows").out).toContain("kept    .shepherd/gate.yml: run `shepherd gate init --upgrade` to move it");
    expect(run("workflows", "--upgrade").out).toContain("moved   .shepherd/gate.yml to review: in .shepherd/config.yml");
    expect(existsSync(path.join(dir, ".shepherd/gate.yml"))).toBe(false);
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toMatch(/^lenses: \{\}\n\nreview:\n[\s\S]* {4}max_lines: 640$/m);
    expect(run("workflows", "--upgrade").out).toContain("kept    review: in .shepherd/config.yml");
  });

  test("--upgrade reads a gate.yml that opens with a document marker, and leaves both files alone when the move would not parse", () => {
    const policy = readFileSync(path.resolve(import.meta.dir, "../gate/.shepherd/gate.yml"), "utf8");
    const marked = repo({ ".shepherd/gate.yml": `---\n${policy}`, ".shepherd/config.yml": "lenses: {}\n" });

    expect(marked.run("workflows", "--upgrade").out).toContain("moved   .shepherd/gate.yml to review: in .shepherd/config.yml");

    const broken = repo({ ".shepherd/gate.yml": policy.replace("max_lines: 800", "max_lines: lots"), ".shepherd/config.yml": "lenses: {}\n" });

    broken.run("workflows", "--upgrade");
    expect(readFileSync(path.join(broken.dir, ".shepherd/config.yml"), "utf8")).toBe("lenses: {}\n");
    expect(existsSync(path.join(broken.dir, ".shepherd/gate.yml"))).toBe(true);
  });

  test("workflows --upgrade rewrites the workflow from the template, keeping its environment", () => {
    const { dir, run } = repo();
    const file = path.join(dir, ".github/workflows/shepherd.yml");

    run("workflows", "--environment", "ai-review");
    writeFileSync(file, readFileSync(file, "utf8").replace(/SHEPHERD_VERSION: .*?(?= #|$)/gm, "SHEPHERD_VERSION: 0.0.1"));
    expect(run("workflows", "--upgrade").out).toContain("upgraded .github/workflows/shepherd.yml");
    expect(readFileSync(file, "utf8")).not.toContain("SHEPHERD_VERSION: 0.0.1");
    expect(readFileSync(file, "utf8")).toContain("environment: ai-review");
  });

  test("setup names the key for the gate policy's own model before the loop's", () => {
    const { run } = repo({ ".shepherd/gate.yml": 'version: 1\nmodel: "bedrock/openai.gpt-oss-120b-1:0"\n', ".shepherd/config.yml": "models:\n  loop: claude-opus-5\n" });

    expect(run("workflows").out).toContain("Next: add your provider key as the AWS_BEARER_TOKEN_BEDROCK secret");
  });

  test("setup names the key for a SHEPHERD_MODEL override before the gate policy's model", () => {
    const { dir } = repo({ ".shepherd/gate.yml": 'version: 1\nmodel: "openai/gpt-5.5"\n' });
    const r = spawnSync("bun", [CLI, "workflows"], { cwd: dir, env: { ...process.env, ...ID, HOME: path.join(dir, "..", "home"), SHEPHERD_MODEL: "bedrock/openai.gpt-oss-120b-1:0" }, encoding: "utf8" });

    expect(r.stdout).toContain("Next: add your provider key as the AWS_BEARER_TOKEN_BEDROCK secret");
  });

  test("workflows --model names the reviewer's model in the team policy, and --environment scopes the model keys", () => {
    const { dir, run } = repo();
    const out = run("workflows", "--model", "bedrock:minimax.minimax-m2.5", "--environment", "ai-review").out;

    expect(out).toContain("pinned    models.loop: bedrock:minimax.minimax-m2.5 in .shepherd/config.yml");
    expect(out).toContain("Next: add your provider key as the AWS_BEARER_TOKEN_BEDROCK secret");
    expect(readFileSync(path.join(dir, ".shepherd/config.yml"), "utf8")).toContain("loop: bedrock:minimax.minimax-m2.5");
    expect(readFileSync(path.join(dir, ".github/workflows/shepherd.yml"), "utf8")).toContain("environment: ai-review");

    const fresh = repo();

    expect(fresh.run("init", "--model", "bedrock:minimax.minimax-m2.5").out).toContain("with models.loop bedrock:minimax.minimax-m2.5");
    expect(readFileSync(path.join(fresh.dir, ".shepherd/config.yml"), "utf8")).toMatch(/^# yaml-language-server: \$schema=.*\n# shepherd team policy[\s\S]*loop: bedrock:minimax\.minimax-m2\.5/);
  });

  test("review refuses inside GitHub Actions, where its /shepherd comment would be the loop asking to run itself", () => {
    const { dir } = repo();
    const r = spawnSync("bun", [CLI, "review", "4"], { cwd: dir, env: { ...process.env, ...ID, HOME: path.join(dir, "..", "home"), GITHUB_ACTIONS: "true" }, encoding: "utf8" });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("inside GitHub Actions the workflow already runs it");
  });

  test("the workflow holds no personal token: the model's job cannot change code, and the job that can holds no keys", () => {
    const text = readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8");
    const wf = parse(text);
    const { review, settle } = wf.jobs;

    expect(text).not.toContain("SHEPHERD_TOKEN");
    expect(text).not.toMatch(/pull_request_target|workflow_run|schedule:/);
    expect(Object.keys(wf.jobs)).toEqual(["review", "settle"]);
    // The job with the model keys reads code; contents write lives only in settle, which has no secret, no checkout
    // and no action: only the gh on the runner.
    expect(wf.permissions.contents).toBe("read");
    expect(review.permissions).toBeUndefined();
    expect(settle.permissions.contents).toBe("write");
    // An ERROR exits non-zero after writing its settlement: both still run, so the check leaves pending.
    expect(review.steps.find((s: { id?: string }) => s.id === "settle").if).toBe("${{ !cancelled() }}");
    expect(settle.if).toContain("!cancelled()");
    expect(JSON.stringify(settle)).not.toContain("secrets.");
    expect(settle.steps.every((s: { uses?: string }) => s.uses === undefined)).toBe(true);
    expect(review.steps.find((s: { uses?: string }) => s.uses?.startsWith("actions/checkout"))?.with?.["persist-credentials"]).toBe(false);
    // The model runs nothing, so no step builds, installs or runs the PR's code.
    expect(JSON.stringify(wf)).not.toMatch(/npm (ci|install|run)|pnpm |yarn |bun (install|run)|make /);

    for (const [, ref] of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) if (!ref!.startsWith("actions/")) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  test("the review job hands settle checked values, and the check's words arrive whole", () => {
    type Settlement = { head: string; retire: string[]; verdict: string; check: { state: string; description: string } };

    const step = parse(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8")).jobs.review.steps.find((x: { id?: string }) => x.id === "settle");

    const outputs = (settlement: Settlement) => {
      const dir = mkdtempSync(path.join(tmpdir(), "shepherd-out-"));

      dirs.push(dir);
      write(dir, { "settle.json": JSON.stringify(settlement), out: "" });
      const run = spawnSync("bash", ["-eo", "pipefail", "-c", z.string().parse(step.run)], { env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: path.join(dir, "out") }, encoding: "utf8" });

      return { code: run.status, out: readFileSync(path.join(dir, "out"), "utf8") };
    };

    const head = "a".repeat(40);

    expect(outputs({ head, retire: ["PRRT_x"], verdict: "ERROR", check: checkFor("ERROR", "", 0) }).out).toContain("description=the review did not finish; comment /review to run it again\n");
    expect(outputs({ head, retire: [], verdict: "REFUSED", check: { state: "failure", description: "changes needed: a\tb\u0001c é" } }).out).toContain("description=changes needed: abc é\n");
    expect(outputs({ head: "x; rm -rf /", retire: [], verdict: "REFUSED", check: { state: "failure", description: "x" } }).code).not.toBe(0); // checked before it is an output
  });

  test("settle reads the PR as it is: it resolves only shepherd's own threads, counts the open ones, and an escalation turns green only on an approval of this head from someone who can push", () => {
    const script = z.string().parse(parse(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8")).jobs.settle.steps[0].run);
    const bot = { login: "github-actions", __typename: "Bot" };
    const sam = { login: "sam", __typename: "User" };
    const ours = { author: bot, body: "x <!-- gate-run:1 -->" };
    const node = (nodes: object[]) => JSON.stringify({ data: { node: { isResolved: false, comments: { totalCount: nodes.length, nodes } } } });
    const threads = (...open: object[][]) => JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: open.map((nodes) => ({ isResolved: false, comments: { totalCount: nodes.length, nodes } })) } } } } });
    const shepherdReview = (verdict: string, head = "abc") => ({ user: { login: "github-actions[bot]", type: "Bot" }, state: "COMMENTED", commit_id: head, body: `## 🙋 shepherd: ${verdict} <sub>x</sub>\n<!-- gate-run:1 -->` });
    const approval = (login: string, head = "abc", state = "APPROVED") => ({ user: { login, type: "User" }, state, commit_id: head, body: "" });

    type World = { node?: Record<string, string>; open?: string; reviews?: object[]; perm?: Record<string, string>; now?: string };

    const settle = (world: World, env: Record<string, string>) => {
      const dir = mkdtempSync(path.join(tmpdir(), "shepherd-settle-"));

      dirs.push(dir);
      write(dir, { ...Object.fromEntries(Object.entries(world.node ?? {}).map(([id, json]) => [`node/${id}`, json])), open: world.open ?? threads(), reviews: JSON.stringify(world.reviews ?? []), now: world.now ?? "failure x", ...Object.fromEntries(Object.entries(world.perm ?? {}).map(([u, p]) => [`perm/${u}`, p])) });
      // gh: each read serves its fixture, already filtered as the step's --jq would; a resolve and the status are recorded.
      write(dir, { "bin/gh": `#!/bin/sh\ncase "$*" in *resolveReviewThread*) echo "$*" | grep -o 'id=[A-Za-z0-9_]*' >> ${dir}/resolved ;; *reviewThreads*) cat ${dir}/open ;; *PullRequestReviewThread*) id=$(echo "$*" | grep -o 'id=[A-Za-z0-9_]*' | cut -d= -f2); cat ${dir}/node/$id ;; *commits/*/statuses*) cat ${dir}/now ;; *pulls/*/reviews*) cat ${dir}/reviews ;; *collaborators/*) u=$(echo "$*" | sed 's|.*collaborators/\\([^/]*\\)/permission.*|\\1|'); cat ${dir}/perm/$u 2>/dev/null || echo read ;; *statuses/*) echo "$*" > ${dir}/status ;; esac\n` });
      chmodSync(path.join(dir, "bin/gh"), 0o755);
      spawnSync("bash", ["-eo", "pipefail", "-c", script], { cwd: dir, env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_REPOSITORY: "o/r", PR: "7", HEAD_SHA: "abc", RETIRE: "", VERDICT: "", STATE: "", DESCRIPTION: "", ...env }, encoding: "utf8" });
      const read = (f: string) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), "utf8") : "");

      return { resolved: read("resolved"), status: read("status") };
    };

    const approved = { VERDICT: "APPROVED", STATE: "success", DESCRIPTION: "approved; no open thread" };

    // After a review: shepherd's own thread resolves; a person's reply keeps one open, and the approval waits on it.
    const clean = settle({ node: { PRRT_a: node([ours]) } }, { ...approved, RETIRE: "PRRT_a" });

    expect(clean.resolved).toContain("id=PRRT_a");
    expect(clean.status).toContain("state=success");
    const joined = settle({ node: { PRRT_a: node([ours, { author: sam, body: "not yet" }]) }, open: threads([ours, { author: sam }]) }, { ...approved, RETIRE: "PRRT_a" });

    expect(joined.resolved).toBe("");
    expect(joined.status).toContain("approved; 1 open thread(s) to resolve");
    expect(settle({ open: threads([{ author: { login: "coderabbitai", __typename: "Bot" } }]) }, approved).status).toContain("state=success"); // another tool's thread is its own
    // A refusal keeps its own state and words, and an approval never changes it.
    expect(settle({ reviews: [approval("sam")], perm: { sam: "admin" } }, { VERDICT: "REFUSED", STATE: "failure", DESCRIPTION: "changes needed: x" }).status).toContain("description=changes needed: x");

    // An escalation: an approval of this head from someone who can push, given during the review or after it.
    const escalated = { VERDICT: "ESCALATE", STATE: "failure", DESCRIPTION: `${PERSON_DECIDES}: touches auth` };

    expect(settle({ reviews: [approval("sam")], perm: { sam: "write" } }, escalated).status).toContain("description=approved by sam");
    expect(settle({ reviews: [approval("sam")], perm: { sam: "write" }, open: threads([ours]) }, escalated).status).toContain("approved by sam; 1 open thread(s) to resolve");
    expect(settle({ reviews: [approval("sam")], perm: { sam: "read" } }, escalated).status).toContain(`description=${PERSON_DECIDES}: touches auth`);
    expect(settle({ reviews: [approval("sam", "old")], perm: { sam: "write" } }, escalated).status).toContain(`${PERSON_DECIDES}: touches auth`);
    expect(settle({ reviews: [approval("sam"), approval("sam", "abc", "DISMISSED")], perm: { sam: "write" } }, escalated).status).toContain(`${PERSON_DECIDES}: touches auth`);

    // On a person's review the verdict comes from shepherd's own review of this head, and a review in flight settles itself.
    expect(settle({ reviews: [shepherdReview("ESCALATE"), approval("sam")], perm: { sam: "write" } }, {}).status).toContain("description=approved by sam");
    expect(settle({ reviews: [shepherdReview("REFUSED"), approval("sam")], perm: { sam: "admin" } }, {}).status).toBe("");
    expect(settle({ reviews: [shepherdReview("ESCALATE"), approval("sam")], perm: { sam: "write" }, now: "pending reviewing" }, {}).status).toBe("");
    expect(settle({ reviews: [shepherdReview("ESCALATE"), approval("sam", "abc", "DISMISSED")], now: "success approved by sam" }, {}).status).toContain(`${PERSON_DECIDES}: no approval of this head`);
    expect(settle({ reviews: [shepherdReview("APPROVED")], open: threads([{ author: sam }]) }, {}).status).toContain("approved; 1 open thread(s) to resolve");
    expect(script).toContain(`"${PERSON_DECIDES}: `);
    expect(checkFor("ESCALATE", "touches auth", 0).description).toStartWith(`${PERSON_DECIDES}: `);
  });

  test("doctor reads which of shepherd's directories CODEOWNERS leaves uncovered", () => {
    expect(uncoveredByOwners("/.shepherd/ @t\n/.github/ @t\n")).toEqual([]);
    expect(uncoveredByOwners("* @t\n")).toEqual([]);
    expect(uncoveredByOwners(".github/** @t\n# /.shepherd/ @t\n")).toEqual(["/.shepherd/"]);
    expect(uncoveredByOwners("/.shepherd/\n/src/ @t\n")).toEqual(["/.shepherd/", "/.github/"]); // a pattern with no owner covers nothing
    // The last matching line wins, and a line with no owner removes ownership.
    expect(uncoveredByOwners("* @team\n/.github/workflows/\n")).toEqual(["/.github/"]);
    expect(uncoveredByOwners("* @team\n/.shepherd/\n/.github/ @ops\n")).toEqual(["/.shepherd/"]);
    expect(uncoveredByOwners("/.github/\n* @team\n")).toEqual([]);
  });

  test("doctor names what is missing and how to fix it", () => {
    const { dir, run } = repo({ ".shepherd/config.yml": "ladder: [haiku, mystery]\n" });
    const checks = JSON.parse(run("doctor", "--json").out);
    const by = (name: string) => checks.find((c: { check: string }) => c.check === name);

    expect(by("default branch")?.status).toBe("ok");
    expect(by("skills")).toMatchObject({ status: "fail", fix: expect.stringContaining("shepherd install") });
    expect(by("model haiku")?.status).toBe("ok");
    expect(by("model mystery")?.status).toBe("warn");
    expect(by("review workflow")?.status).toBe("warn");

    write(dir, { ".github/workflows/shepherd-gate.yml": "name: gate\non: pull_request\njobs:\n  review:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bunx \"@jagreehal/shepherd@1\" gate \"$PR\" --post\n" });
    run("install", "--project");
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "gate"], { cwd: dir, env: { ...process.env, ...ID } });
    spawnSync("git", ["push", "-q", "origin", "HEAD:main"], { cwd: dir });
    const after = JSON.parse(run("doctor", "--json").out);

    expect(after.find((c: { check: string }) => c.check === "skills")?.status).toBe("ok");
    expect(after.find((c: { check: string }) => c.check === "review workflow")?.status).toBe("ok");
    expect(after.find((c: { check: string }) => c.check === "review runs")?.status).toBe("warn"); // no GitHub here
    expect(after.find((c: { check: string }) => c.check === "code owners")).toMatchObject({ status: "warn", detail: expect.stringContaining("no CODEOWNERS file") });
    expect(after.find((c: { check: string }) => c.check === "code owner review")?.status).toBe("warn");
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

test("only a workflow that invokes gate on pull requests counts as running it", () => {
  const steps = (s: string) => `on: [pull_request]\njobs:\n  r:\n    steps:\n${s}`;

  expect(runsGate("name: gate\n")).toBe(false);
  expect(runsGate(steps("      - run: echo gate\n"))).toBe(false);
  expect(runsGate(steps('      - run: bunx "@jagreehal/shepherd@$SHEPHERD_VERSION" gate "$PR" --post\n'))).toBe(true);
  expect(runsGate(steps("      - run: shepherd gate 1 --post\n"))).toBe(true);
  expect(runsGate(steps("      - uses: actions/checkout@v4\n        with: { repository: jagreehal/shepherd, path: .gate-tool }\n      - run: bun .gate-tool/src/bin.ts gate 1\n"))).toBe(true);
  expect(runsGate(steps("      - uses: actions/checkout@v4\n        with: { repository: jagreehal/shepherd, path: .gate-tool }\n"))).toBe(false);
  expect(runsGate(steps("      - run: bunx @jagreehal/shepherd install\n"))).toBe(false);
  expect(runsGate("on: { push: {} }\njobs:\n  r:\n    steps:\n      - run: shepherd gate 1\n")).toBe(false);
});
