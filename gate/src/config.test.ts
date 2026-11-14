import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { configSummary, effectiveConfig, resolve } from "./config.ts";
import { PolicySchema, SHEPHERD_VERSION, parsePolicy, policyJsonSchema, policyWithSettings } from "./policy.ts";

const bundled = () => readFileSync(path.resolve(import.meta.dir, "../.shepherd/gate.yml"), "utf8");

describe("settings", () => {
  test("a non-blank variable wins, then the policy, then the default; a blank or whitespace variable counts as unset", () => {
    const policy = { model: "bedrock:minimax.minimax-m2.5", provider: { region: "eu-west-1" } };

    expect(resolve("model", policy, { SHEPHERD_MODEL: "openai/gpt-5.5" })).toMatchObject({ value: "openai/gpt-5.5", source: "env", env: "SHEPHERD_MODEL" });
    expect(resolve("model", policy, { SHEPHERD_MODEL: "" })).toMatchObject({ value: "bedrock:minimax.minimax-m2.5", source: "policy" });
    expect(resolve("model", policy, { SHEPHERD_MODEL: "  " }).source).toBe("policy");
    expect(resolve("model", {}, {})).toMatchObject({ value: "claude-opus-5", source: "default" });
    expect(resolve("region", policy, {}).value).toBe("eu-west-1");
    // only the model and the OpenAI-compatible endpoint have variables: every other setting is the policy's
    expect(resolve("backends", { backends: ["api", "codex"] }, { SHEPHERD_BACKEND: "claude" }).value).toBe("api,codex");
    expect(configSummary(policy, { SHEPHERD_MODEL: "openai/gpt-5.5" })).toBe("config: model from SHEPHERD_MODEL, provider.region from policy (shepherd gate config shows every value)");
  });

  test("guard: structured in the policy, any rule left out keeps its default, ", () => {
    expect(resolve("guard", {}, {}).value).toBe("budget:$2,tokens:3m,loop:4/12,max-tools:80,timeout:15m");
    expect(resolve("guard", { guard: { budget_usd: 0.5, timeout: "5m" } }, {}).value).toBe("budget:$0.5,tokens:3m,loop:4/12,max-tools:80,timeout:5m");

    const valid = (guard: Record<string, string | number>) => PolicySchema.safeParse({ ...parseYaml(bundled()), guard }).success;

    expect(valid({ budget_usd: 1, tokens: "500k", loop: "3/10", max_tools: 40, timeout: "10m" })).toBe(true);
    expect(valid({ tokens: 2_000_000 })).toBe(true);
    expect(valid({ budget_usd: -1 })).toBe(false);
    expect(valid({ timeout: "soon" })).toBe(false);
    expect(valid({ max_tool: 40 })).toBe(false);
  });

  test("shepherd gate config shows settings and where they came from, secrets only as set or unset, and no URL credentials", () => {
    const canary = "sk-ant-api03-gate-config-canary-value";
    const config = effectiveConfig({ provider: { base_url: "https://user:hunter2@llm.internal/v1" } }, { ANTHROPIC_API_KEY: canary, OPENAI_COMPATIBLE_API_KEY: "" });

    expect(config.secrets.ANTHROPIC_API_KEY).toBe("set");
    expect(config.secrets.OPENAI_COMPATIBLE_API_KEY).toBe("unset");
    expect(config.settings.base_url!.value).toBe("https://[redacted]@llm.internal/v1");
    expect(effectiveConfig({ provider: { base_url: "https://user:p@ss@llm.internal/v1" } }, {}).settings.base_url!.value).toBe("https://[redacted]@llm.internal/v1");

    const cli = Bun.spawnSync(["bun", "run", path.resolve(import.meta.dir, "cli.ts"), "config", "--json"], { env: { ...process.env, ANTHROPIC_API_KEY: canary, SHEPHERD_MODEL: "openai/gpt-5.5" }, cwd: import.meta.dir });
    const out = cli.stdout.toString();

    expect(cli.exitCode).toBe(0);
    expect(out).not.toContain(canary);
    expect(JSON.parse(out)).toMatchObject({ settings: { model: { value: "openai/gpt-5.5", source: "env" } }, secrets: { ANTHROPIC_API_KEY: "set" } });
  });

  test("config --policy-dir fails on a gate.yml it cannot read, so CI can check an edit before it merges", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gate-config-"));
    const run = () => Bun.spawnSync(["bun", "run", path.resolve(import.meta.dir, "cli.ts"), "config", "--policy-dir", dir], { cwd: import.meta.dir });

    const shipped = readFileSync(path.resolve(import.meta.dir, "../.shepherd/gate.yml"), "utf8");

    writeFileSync(path.join(dir, "gate.yml"), shipped);
    expect(run().exitCode).toBe(0);

    writeFileSync(path.join(dir, "gate.yml"), shipped.replace("max_lines: 800", 'max_lines: "lots"'));
    const bad = run();

    expect(bad.exitCode).toBe(1);
    expect(bad.stdout.toString()).toContain("max_lines");
    rmSync(dir, { recursive: true, force: true });
  });

  test("--help prints the usage, and a bad option gets one line and the usage, never a stack trace", () => {
    const run = (...a: string[]) => Bun.spawnSync(["bun", "run", path.resolve(import.meta.dir, "cli.ts"), ...a], { cwd: import.meta.dir });

    for (const a of [["init", "--help"], ["--help"], ["config", "-h"]]) {
      const help = run(...a);

      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString()).toContain("shepherd gate init [--model <id>]");
    }

    const bad = run("init", "--bogus");
    const err = bad.stderr.toString();

    expect(bad.exitCode).toBe(2);
    expect(err).toStartWith("shepherd gate: Unknown option '--bogus'\nusage: shepherd gate");
    expect(err).not.toContain("    at ");
    expect(resolve("advise_on_deny", { advise_on_deny: true }, {}).value).toBe("true");
    expect(resolve("advise_on_deny", {}, {}).value).toBe("false");
    expect(resolve("effort", {}, {}).value).toBe("");
    expect(resolve("effort", { effort: "high" }, { SHEPHERD_EFFORT: "low" })).toMatchObject({ value: "high", source: "policy" });
  });

  test("init writes the settings it was given into the policy, and refuses ones the policy would", () => {
    const text = policyWithSettings(bundled(), { model: "bedrock:minimax.minimax-m2.5", region: "eu-west-1" });

    expect(parseYaml(text)).toMatchObject({ model: "bedrock:minimax.minimax-m2.5", provider: { region: "eu-west-1" } });
    expect(policyWithSettings(bundled(), {})).toBe(bundled());
    expect(() => policyWithSettings(bundled(), { region: "europe" })).toThrow();
  });

  test("the published schema is PolicySchema at this version, and a bad policy names its line", () => {
    const read = (rel: string) => readFileSync(path.resolve(import.meta.dir, "..", rel), "utf8");

    expect(JSON.parse(read(".shepherd/gate.schema.json"))).toEqual(JSON.parse(JSON.stringify(policyJsonSchema()))); // else: bun tools/policy-schema.ts

    for (const rel of [".shepherd/gate.yml", "templates/policy-strict.yml"]) expect(read(rel)).toStartWith(`# yaml-language-server: $schema=https://unpkg.com/@jagreehal/shepherd@${SHEPHERD_VERSION}/gate/.shepherd/gate.schema.json\n`);
    expect(() => parsePolicy(bundled().replace("max_lines: ", "max_lines: -"))).toThrow(/^\.shepherd\/gate\.yml:\d+:\d+ size_gate\.max_lines: /);
    expect(() => parsePolicy(bundled().replace("version: 1\n", "version: 1\nnope: true\n"))).toThrow(/^\.shepherd\/gate\.yml:8:\d+ .*"nope"/);
    expect(() => parsePolicy(`${bundled()}\n  bad: [`)).toThrow(/^\.shepherd\/gate\.yml:\d+:\d+ /);
    // each YAML error gets its own line, and so does an alias to a missing anchor
    expect(() => parsePolicy(bundled().replace("version: 1\n", "version: 1\nversion: 1\n").replace("allow:\n", "allow:\n  path_patterns: []\n"))).toThrow(/^\.shepherd\/gate\.yml:8:1 Map keys must be unique\n\.shepherd\/gate\.yml:\d+:3 Map keys must be unique$/);
    expect(() => parsePolicy(bundled().replace("version: 1\n", "version: *missing\n"))).toThrow(/^\.shepherd\/gate\.yml:7:10 unresolved alias \*missing$/);
    // the schema requires deny.gate_policy, so an editor flags its removal
    expect(policyJsonSchema()).toMatchObject({ properties: { deny: { required: ["gate_policy"] } } });
    expect(() => parsePolicy(bundled().replace("  gate_policy:", "  gate_polcy:"))).toThrow(/:\d+:\d+ deny\.gate_policy: required: the gate cannot approve edits to itself/);
  });
});
