import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

// The publish job is the only place a write token meets model output. These run its push step, as the
// template has it, against real git repositories.
const Workflow = z.object({
  jobs: z.object({
    publish: z.object({
      env: z.record(z.string(), z.string()),
      steps: z.array(z.object({ name: z.string().optional(), run: z.string().optional() })),
    }),
  }),
});

const template = Workflow.parse(parse(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8")));

const pushScript = template.jobs.publish.steps.find((s) => s.name === "Push the handed-off commits")?.run ?? "";

const DENY = /'(.+)'/.exec(template.jobs.publish.env.DENY ?? "")?.[1] ?? "";

const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

const roots: string[] = [];

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...ID } });

  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);

  return r.stdout.trim();
}

function put(dir: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
}

/** origin with main and a PR branch `feat` at H0; an agent clone on `feat`; a publish workspace. */
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-publish-"));

  roots.push(root);
  const origin = path.join(root, "origin.git");

  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const seed = path.join(root, "seed");

  git(root, "clone", "-q", origin, seed);
  put(seed, "src/a.ts", "export const a = 1;\n");
  put(seed, ".github/workflows/ci.yml", "name: ci\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "base");
  git(seed, "push", "-q", "origin", "HEAD:main");
  git(seed, "checkout", "-q", "-b", "feat");
  put(seed, "src/b.ts", "export const b = 2;\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "feature");
  git(seed, "push", "-q", "origin", "feat");
  const h0 = git(seed, "rev-parse", "HEAD");

  const agent = path.join(root, "agent");

  git(root, "clone", "-q", "-b", "feat", origin, agent);
  const ws = path.join(root, "ws");

  mkdirSync(path.join(ws, "handoff"), { recursive: true });

  const commit = (rel: string, text: string) => {
    put(agent, rel, text);
    git(agent, "add", "-A");
    git(agent, "commit", "-qm", "fix", "--trailer", "Shepherd: triage");
  };

  const publish = (live = h0, branch = "feat", hasPat = "true") => {
    git(agent, "branch", "-f", "shepherd-handoff", "HEAD");
    git(agent, "bundle", "create", path.join(ws, "handoff", "fix.bundle"), `${h0}..shepherd-handoff`);
    git(ws, "clone", "-q", "-b", "feat", origin, "repo");
    const bin = path.join(root, "bin");

    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho ${live}\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
    const output = path.join(root, "output");

    writeFileSync(output, "");

    const r = spawnSync("bash", ["-eo", "pipefail", "-c", pushScript], {
      cwd: path.join(ws, "repo"),
      encoding: "utf8",
      env: { ...process.env, ...ID, PATH: `${bin}:${process.env.PATH}`, PR: "1", BRANCH: branch, BASE: "main", DEFAULT_BRANCH: "main", H0: h0, HAS_PAT: hasPat, DENY, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "acme/x" },
    });

    return { code: r.status, out: r.stdout + r.stderr, output: readFileSync(output, "utf8"), remote: git(origin, "rev-parse", "feat") };
  };

  return { h0, agent, seed, origin, commit, publish };
}

describe("publish: pushing what the model handed off", () => {
  test("the template carries the push step and a deny list", () => {
    expect(pushScript).toContain("git merge-base --is-ancestor");
    expect(DENY).toContain(".github/");
  });

  test("a fix in the code is pushed to the PR branch as a fast-forward", () => {
    const { agent, commit, publish } = setup();

    commit("src/b.ts", "export const b = 3;\n");
    const r = publish();

    expect(r.code).toBe(0);
    expect(r.remote).toBe(git(agent, "rev-parse", "HEAD"));
    expect(r.output).toContain("pushed=1");
  });

  test("a fix that touches a workflow is refused and nothing is pushed", () => {
    const { h0, commit, publish } = setup();

    commit(".github/workflows/ci.yml", "name: ci\non: push\n");
    const r = publish();

    expect(r.code).toBe(0);
    expect(r.output).toContain("refused=the fixes touch protected paths: .github/workflows/ci.yml");
    expect(r.remote).toBe(h0);
  });

  test("install hooks, package manager config, manifests and lockfiles are refused too", () => {
    for (const rel of ["package.json", "package-lock.json", ".npmrc", ".husky/pre-commit", "web/bun.lockb", "yarn.lock", "Cargo.lock", "pnpm-lock.yaml", "go.sum", ".terraform.lock.hcl", "packages.lock.json", "gradle.lockfile", "conda-lock.yml", "Package.resolved", ".cargo/config.toml", "pnpm-workspace.yaml", "Pipfile", "deno.jsonc", "go.mod", "Cargo.toml", "pyproject.toml", "requirements-dev.txt", "Gemfile", "build.gradle.kts", "Makefile", "GNUmakefile", ".justfile", "Taskfile.dist.yml", "Package.JSON"]) {
      const { h0, commit, publish } = setup();

      commit(rel, "x\n");
      const r = publish();

      expect(r.output).toContain(`refused=the fixes touch protected paths: ${rel}`);
      expect(r.remote).toBe(h0);
    }
  }, 60_000);

  test("a path with a newline cannot inject a workflow output", () => {
    const { h0, commit, publish } = setup();

    commit(".github/x\nhead=evil", "x\n");
    const r = publish();

    expect(r.output).toContain("refused=the fixes touch protected paths: .github/x?head=evil");
    expect(r.output.split("\n").filter((l) => l.startsWith("head="))).toEqual([`head=${h0}`]);
    expect(r.remote).toBe(h0);
  });

  test("any path with a control character is refused, protected or not", () => {
    const { h0, commit, publish } = setup();

    commit("src/a\tb.ts", "x\n");
    const r = publish();

    expect(r.output).toContain("refused=the fixes touch protected paths: src/a?b.ts");
    expect(r.remote).toBe(h0);
  });

  test("ordinary source files with 'lock' in their name are pushed", () => {
    const { agent, commit, publish } = setup();

    for (const rel of ["src/clock.ts", "src/Blocking.ts", "src/file-lock.ts", "src/read_lock.py", "src/dead-lock.test.ts", "docs/lockout.md"]) commit(rel, "export const x = 1;\n");
    const r = publish();

    expect(r.output).not.toContain("refused=");
    expect(r.remote).toBe(git(agent, "rev-parse", "HEAD"));
  });

  test("without SHEPHERD_TOKEN there is nothing to push with, and the refusal names the secret", () => {
    const { h0, commit, publish } = setup();

    commit("src/b.ts", "export const b = 3;\n");
    const r = publish(h0, "feat", "false");

    expect(r.output).toContain("refused=set the SHEPHERD_TOKEN secret so shepherd can push");
    expect(r.remote).toBe(h0);
  });

  test("a head branch that is the default branch is never pushed to", () => {
    const { h0, commit, publish } = setup();

    commit("src/b.ts", "export const b = 3;\n");
    const r = publish(h0, "main");

    expect(r.output).toContain("refused=will not push to main");
    expect(r.remote).toBe(h0);
  });

  test("a base merge passes even though the base changed a workflow", () => {
    const { agent, seed, publish } = setup();

    git(seed, "checkout", "-q", "main");
    put(seed, ".github/workflows/ci.yml", "name: ci\non: [push]\n");
    git(seed, "commit", "-qam", "base moves");
    git(seed, "push", "-q", "origin", "main");
    git(agent, "fetch", "-q", "origin");
    git(agent, "merge", "-q", "--no-edit", "origin/main");
    const r = publish();

    expect(r.code).toBe(0);
    expect(r.remote).toBe(git(agent, "rev-parse", "HEAD"));
  });

  test("when someone pushed first, nothing is pushed and the status is left alone", () => {
    const { h0, commit, publish } = setup();

    commit("src/b.ts", "export const b = 3;\n");
    const r = publish("f".repeat(40));

    expect(r.code).toBe(0);
    expect(r.output).toContain("stale=true");
    expect(r.remote).toBe(h0);
  });

  test("rewritten history is refused", () => {
    const { h0, agent, origin, publish } = setup();

    git(agent, "reset", "-q", "--hard", "origin/main");
    put(agent, "src/c.ts", "export const c = 1;\n");
    git(agent, "add", "-A");
    git(agent, "commit", "-qm", "rewrite");
    const r = publish();

    expect(r.output).toContain("refused=the fixes are not a fast-forward");
    expect(git(origin, "rev-parse", "feat")).toBe(h0);
  });
});

describe("publish: an iteration that failed or timed out", () => {
  test("the finalizer sets error on the starting head, never leaving pending or an older green", () => {
    const script = template.jobs.publish.steps.find((s) => s.name === "Report a stopped iteration")?.run ?? "";

    const root = mkdtempSync(path.join(tmpdir(), "shepherd-stopped-"));

    roots.push(root);
    const bin = path.join(root, "bin");

    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/gh-args"\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
    writeFileSync(path.join(root, "output"), "");

    const r = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ITERATED: "failure", H0: "abc", RUN_URL: "https://x/run", GITHUB_OUTPUT: path.join(root, "output"), GITHUB_REPOSITORY: "acme/x" },
    });

    expect(r.status).toBe(0);
    const args = readFileSync(path.join(root, "gh-args"), "utf8");

    expect(args).toContain("repos/acme/x/statuses/abc");
    expect(args).toContain("state=error");
    expect(readFileSync(path.join(root, "output"), "utf8")).toContain("state=error");
  });
});

describe("publish: the status the model asked for", () => {
  const statusScript = template.jobs.publish.steps.find((s) => s.name === "Set the shepherd status")?.run ?? "";

  function run(statusJson: string | null, pushed = "", refused = "") {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-status-"));

    roots.push(root);
    mkdirSync(path.join(root, "handoff"));

    if (statusJson !== null) writeFileSync(path.join(root, "handoff", "status.json"), statusJson);
    const bin = path.join(root, "bin");

    mkdirSync(bin);
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/gh-args"\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
    writeFileSync(path.join(root, "output"), "");

    const r = spawnSync("bash", ["-eo", "pipefail", "-c", statusScript], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HEAD_SHA: "abc", PUSHED: pushed, REFUSED: refused, GITHUB_OUTPUT: path.join(root, "output"), GITHUB_REPOSITORY: "acme/x" },
    });

    return { code: r.status, args: readFileSync(path.join(root, "gh-args"), "utf8"), description: readFileSync(path.join(root, "description.txt"), "utf8").trim() };
  }

  test("a known state and one line of text pass through", () => {
    const r = run(JSON.stringify({ state: "failure", description: "stamp refused: retry loop" }));

    expect(r.code).toBe(0);
    expect(r.args).toContain("state=failure");
    expect(r.description).toBe("stamp refused: retry loop");
  });

  test("an unknown state becomes pending, and text is held to one short line", () => {
    const r = run(JSON.stringify({ state: "success\nstate=success", description: `line one\nline two ${"x".repeat(300)}` }));

    expect(r.args).toContain("state=pending");
    expect(r.description).not.toContain("\n");
    expect(r.description.length).toBeLessThan(140);
  });

  test("after a push the status is pending whatever the model said, and a missing file is pending too", () => {
    expect(run(JSON.stringify({ state: "success", description: "done" }), "2").args).toContain("state=pending");
    expect(run(JSON.stringify({ state: "success", description: "done" }), "2").description).toStartWith("pushed 2 commit(s) for review");
    expect(run(null).args).toContain("state=pending");
    expect(run("[]").args).toContain("state=pending");
    expect(run('"success"').args).toContain("state=pending");
  });

  test("a refused push is a failure that names why, whatever the model said", () => {
    const r = run(JSON.stringify({ state: "success", description: "done" }), "", "the fixes touch protected paths: package.json");

    expect(r.args).toContain("state=failure");
    expect(r.description).toBe("fixes not pushed, a person should look: the fixes touch protected paths: package.json");
  });
});

test("the model never holds a write credential: github.token only, no persisted checkout token, no contents write", () => {
  const Iterate = z.object({
    jobs: z.object({
      iterate: z.object({
        permissions: z.record(z.string(), z.string()),
        steps: z.array(z.object({ name: z.string().optional(), uses: z.string().optional(), with: z.record(z.string(), z.unknown()).optional(), env: z.record(z.string(), z.string()).optional() })),
      }),
    }),
  });

  const { iterate } = Iterate.parse(parse(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8"))).jobs;

  const model = iterate.steps.find((s) => s.name === "One shepherd iteration");

  expect(iterate.permissions.contents).toBe("read");
  expect(model?.env?.GH_TOKEN).toBe("${{ github.token }}");
  expect(Object.values(model?.env ?? {}).join(" ")).not.toContain("SHEPHERD_TOKEN");
  expect(iterate.steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["persist-credentials"]).toBe(false);
  // No step of the model's job names the PAT: a secret any step uses sits in the job's runner memory.
  expect(iterate.steps.filter((s) => JSON.stringify(s).includes("SHEPHERD_TOKEN"))).toEqual([]);
});

test("the gate marks the head pending before the model runs, and publish runs whatever the iteration's result", () => {
  const Jobs = z.object({
    jobs: z.object({
      gate: z.object({ steps: z.array(z.object({ name: z.string().optional(), run: z.string().optional() })) }),
      publish: z.object({ if: z.string() }),
    }),
  });

  const { jobs } = Jobs.parse(parse(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8")));

  expect(jobs.gate.steps.find((s) => s.name === "Mark the head pending")?.run).toContain("state=pending");
  expect(jobs.publish.if).toContain("always()");
});

test("one run per PR from gate to publish: the workflow's group is keyed on the gate's own condition", () => {
  const Workflow = z.object({
    concurrency: z.object({ group: z.string(), "cancel-in-progress": z.boolean() }),
    jobs: z.record(z.string(), z.object({ if: z.string().optional(), concurrency: z.unknown().optional() })),
  });

  const wf = Workflow.parse(parse(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8")));

  const squash = (t: string) => t.replace(/\s+/g, " ").trim();

  expect(squash(wf.concurrency.group)).toContain(squash(wf.jobs.gate?.if ?? "unset"));
  expect(wf.concurrency.group).toContain("shepherd-skip-");
  expect(wf.concurrency["cancel-in-progress"]).toBe(false);
  // A job-level group would let another run's gate or publish interleave with this one.
  expect(Object.entries(wf.jobs).filter(([, j]) => j.concurrency !== undefined).map(([name]) => name)).toEqual([]);
});

test("the finalizer reports a stopped iteration before any setup that could fail", () => {
  const names = template.jobs.publish.steps.map((s) => s.name ?? "");

  expect(names[0]).toBe("Report a stopped iteration");
  const status = names.indexOf("Set the shepherd status");

  const setupAt = template.jobs.publish.steps.findIndex((s) => (s.run ?? "").includes("bun add -g"));

  expect(setupAt).toBeGreaterThan(status);
});

test("a failed publish step reports error, so the sweep never reruns the model on a stuck pending", () => {
  const last = template.jobs.publish.steps.at(-1);

  expect(last?.name).toBe("Report a failed publish");
  expect(readFileSync(path.resolve(import.meta.dir, "../templates/shepherd.yml"), "utf8")).toContain("- name: Report a failed publish\n        if: always() && failure()");
  expect(last?.run).toContain("state=error");
});

describe("the scheduled audit", () => {
  const Step = z.object({ name: z.string().optional(), uses: z.string().optional(), run: z.string().optional(), with: z.record(z.string(), z.unknown()).optional(), env: z.record(z.string(), z.string()).optional() });
  const Job = z.object({ if: z.string().optional(), permissions: z.record(z.string(), z.string()), env: z.record(z.string(), z.string()).optional(), steps: z.array(Step) });
  const text = readFileSync(path.resolve(import.meta.dir, "../templates/shepherd-audit.yml"), "utf8");
  const { audit, report } = z.object({ jobs: z.object({ audit: Job, report: Job }) }).parse(parse(text)).jobs;

  test("the model reads and reports: no write permission, no persisted token, the playbook pinned and checked out inside the workspace", () => {
    expect(audit.permissions).toEqual({ contents: "read" });
    const checkouts = audit.steps.filter((s) => s.uses?.startsWith("actions/checkout"));

    expect(checkouts.map((s) => s.with?.["persist-credentials"])).toEqual([false, false]);
    // actions/checkout refuses a path outside GITHUB_WORKSPACE.
    expect(checkouts.map((s) => String(s.with?.path ?? ".")).filter((p) => p.startsWith("/") || p.includes("runner.temp") || p.split("/").includes(".."))).toEqual([]);
    expect(audit.env?.PLAYBOOK_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(audit)).not.toContain("SHEPHERD_TOKEN");
    expect(JSON.stringify(report)).not.toMatch(/opencode|OPENCODE/);
  });

  test("a public repository runs the audit only when it opts in, since its artifacts and issues are public", () => {
    expect(audit.if).toBe("needs.repo.outputs.private == 'true' || vars.AUDIT_PUBLIC == 'true'");
  });

  test("a report carrying a credential shape is withheld before anything is uploaded", () => {
    const names = audit.steps.map((s) => s.name ?? s.uses ?? "");
    const withhold = names.indexOf("Withhold a report that carries a credential");

    expect(withhold).toBeGreaterThan(names.indexOf("Audit"));
    expect(withhold).toBeLessThan(names.findIndex((n) => n.startsWith("actions/upload-artifact")));
    const run = audit.steps[withhold]!.run!;
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-audit-"));

    mkdirSync(path.join(dir, "audit"));

    const check = (report: string) => {
      writeFileSync(path.join(dir, "audit", "report.md"), report);
      const r = spawnSync("bash", ["-eo", "pipefail", "-c", run], { encoding: "utf8", env: { ...process.env, RUNNER_TEMP: dir } });

      return { code: r.status, out: r.stdout + r.stderr };
    };

    for (const leak of ["key AKIAABCDEFGHIJKLMNOP in a.ts:3", `token ghp_${"a".repeat(36)}`, "-----BEGIN RSA PRIVATE KEY-----"]) {
      const r = check(leak);

      expect(r.code).toBe(1);
      expect(r.out).toContain("was withheld");
      expect(r.out).not.toContain(leak);
      expect(existsSync(path.join(dir, "audit", "report.md"))).toBe(false);
    }

    expect(check("## Findings\n- aws key in a.ts:3 (AKIA...)").code).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("the report job files an issue on a private repository and only summarises on a public one", () => {
    const run = report.steps.find((s) => s.run)!.run!;
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-audit-"));
    const bin = path.join(dir, "bin");

    mkdirSync(path.join(dir, "audit"), { recursive: true });
    mkdirSync(bin);
    writeFileSync(path.join(dir, "audit", "report.md"), "## Findings\n- aws key in a.ts:3 (AKIA...)");
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${dir}/gh-args"\n`);
    chmodSync(path.join(bin, "gh"), 0o755);

    const post = (priv: string) => {
      rmSync(path.join(dir, "gh-args"), { force: true });
      const r = spawnSync("bash", ["-eo", "pipefail", "-c", run], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PRIVATE: priv, REPO: "o/r", RUN_URL: "u", GITHUB_STEP_SUMMARY: path.join(dir, "summary") } });

      return { code: r.status, gh: existsSync(path.join(dir, "gh-args")) ? readFileSync(path.join(dir, "gh-args"), "utf8") : "" };
    };

    expect(post("false")).toEqual({ code: 0, gh: "" });
    expect(post("true").gh).toContain("issue create --repo o/r --label shepherd-audit");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("models in the model jobs", () => {
  const Step = z.object({ name: z.string().optional(), run: z.string().optional(), env: z.record(z.string(), z.string()).optional() });
  const Wf = z.object({ permissions: z.record(z.string(), z.string()).optional(), jobs: z.record(z.string(), z.object({ permissions: z.record(z.string(), z.string()).optional(), steps: z.array(Step).optional() })) });
  const templates = ["shepherd.yml", "shepherd-incident.yml", "shepherd-audit.yml"].map((name) => ({ name, wf: Wf.parse(parse(readFileSync(path.resolve(import.meta.dir, "../templates", name), "utf8"))) }));
  const modelStep = (wf: z.infer<typeof Wf>) => Object.values(wf.jobs).flatMap((j) => j.steps ?? []).find((s) => s.run?.includes("opencode run"))!;

  test("every model step takes one SHEPHERD_API_KEY or each provider's own, and the team's models from ci-models", () => {
    for (const { name, wf } of templates) {
      const step = modelStep(wf);

      expect({ name, key: step.env?.SHEPHERD_API_KEY, bedrock: step.env?.AWS_BEARER_TOKEN_BEDROCK, model: step.env?.SHEPHERD_MODEL }).toEqual({ name, key: "${{ secrets.SHEPHERD_API_KEY }}", bedrock: "${{ secrets.AWS_BEARER_TOKEN_BEDROCK }}", model: "${{ vars.SHEPHERD_MODEL }}" });
      expect(step.run).toContain("plan=$(shepherd ci-models)");
      expect(step.run).toContain('opencode run --auto -m "$model"');
    }
  });

  // The model runs a shell. With id-token: write it could mint an OIDC token and assume any role that trusts
  // this repository, not only a Bedrock one, so these jobs take an API key instead.
  test("no shepherd workflow grants id-token: write", () => {
    for (const { name, wf } of templates) {
      expect({ name, top: wf.permissions?.["id-token"], jobs: Object.values(wf.jobs).map((j) => j.permissions?.["id-token"]).filter(Boolean) }).toEqual({ name, top: undefined, jobs: [] });
    }
  });

  test("the step routes SHEPHERD_API_KEY to the provider's variable, drops blank keys, and hands OpenCode the ladder agents", () => {
    const run = modelStep(templates[0]!.wf).run!;
    const dir = mkdtempSync(path.join(tmpdir(), "shepherd-models-"));
    const bin = path.join(dir, "bin");

    mkdirSync(bin);
    const plan = JSON.stringify({ model: "amazon-bedrock/eu.amazon.nova-micro-v1:0", source: "models.loop", key_env: "AWS_BEARER_TOKEN_BEDROCK", key_envs: ["AWS_BEARER_TOKEN_BEDROCK", "OPENCODE_API_KEY"], opencode: { agent: { "shepherd-r0": { mode: "subagent", model: "opencode/deepseek-v4.1-flash-free" } } } });

    writeFileSync(path.join(bin, "shepherd"), `#!/bin/sh\necho '${plan}'\n`);
    // opencode reports what it was given: its model, which keys it can see, and its config.
    writeFileSync(path.join(bin, "opencode"), `#!/bin/sh\necho "model=$4"\nenv | grep -E '^(AWS_BEARER_TOKEN_BEDROCK|OPENCODE_API_KEY|OPENAI_API_KEY|SHEPHERD_API_KEY|OPENCODE_CONFIG_CONTENT)=' | sort\n`);
    chmodSync(path.join(bin, "shepherd"), 0o755);
    chmodSync(path.join(bin, "opencode"), 0o755);

    const go = (env: Record<string, string>) => spawnSync("bash", ["-eo", "pipefail", "-c", run], { encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, PR: "1", ...env } }).stdout;

    const one = go({ SHEPHERD_API_KEY: "k1", AWS_BEARER_TOKEN_BEDROCK: "", OPENCODE_API_KEY: "" });

    expect(one).toContain("model=amazon-bedrock/eu.amazon.nova-micro-v1:0");
    expect(one).toContain("AWS_BEARER_TOKEN_BEDROCK=k1");
    expect(one).not.toContain("SHEPHERD_API_KEY=");
    expect(one).not.toContain("OPENCODE_API_KEY="); // blank: unset
    expect(one).toContain('OPENCODE_CONFIG_CONTENT={"agent":{"shepherd-r0"');
    // A key no model in the plan reads never reaches the model.
    const scoped = go({ OPENCODE_API_KEY: "oc", OPENAI_API_KEY: "unused" });

    expect(scoped).toContain("OPENCODE_API_KEY=oc");
    expect(scoped).not.toContain("OPENAI_API_KEY=");
    // The provider's own secret wins over the shared one.
    expect(go({ SHEPHERD_API_KEY: "k1", AWS_BEARER_TOKEN_BEDROCK: "own" })).toContain("AWS_BEARER_TOKEN_BEDROCK=own");
    rmSync(dir, { recursive: true, force: true });
  });
});
