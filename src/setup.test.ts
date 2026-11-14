import { describe, expect, test } from "bun:test";
import { type Gh, githubSetup, pickModel } from "./setup.ts";

describe("first-run setup", () => {
  test("the flag wins, then the policy's model, so a rerun never moves it; then SHEPHERD_MODEL; then the first key present", () => {
    expect(pickModel("bedrock/eu.amazon.nova-pro-v1:0", { value: "openai/gpt-5.5", source: ".shepherd/config.yml" }, {})).toEqual({ model: "bedrock/eu.amazon.nova-pro-v1:0", key: "AWS_BEARER_TOKEN_BEDROCK", why: "--model", chosen: true });
    expect(pickModel(undefined, { value: "openai/gpt-5.5", source: ".shepherd/packs/team.yml" }, { ANTHROPIC_API_KEY: "a", SHEPHERD_MODEL: "opencode-go/beam-free" })).toEqual({ model: "openai/gpt-5.5", key: "OPENAI_API_KEY", why: "models.loop from .shepherd/packs/team.yml", chosen: false });
    expect(pickModel(undefined, undefined, { SHEPHERD_MODEL: "opencode-go/beam-free", ANTHROPIC_API_KEY: "a" })).toMatchObject({ model: "opencode-go/beam-free", key: "OPENCODE_API_KEY", chosen: true });
    expect(pickModel(undefined, undefined, { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })).toMatchObject({ model: "anthropic/claude-opus-5", key: "ANTHROPIC_API_KEY", chosen: true });
    expect(pickModel(undefined, undefined, { OPENCODE_API_KEY: "  " })).toBeNull(); // what a workflow passes for an unset secret
  });

  test("sets each secret on stdin and allows Actions to approve; a step that cannot run becomes a todo", () => {
    const calls: { args: string[]; input?: string }[] = [];

    const gh: Gh = (args, input) => {
      calls.push({ args, input });

      return { ok: !args.includes("PUT"), out: args.includes("--jq") ? "read\n" : "" };
    };

    const done = githubSetup(gh, { repo: "o/r", secrets: [{ name: "OPENCODE_API_KEY", value: "secret-value" }, { name: "SHEPHERD_TOKEN", value: undefined }] });
    const secret = calls.find((c) => c.args[0] === "secret")!;

    expect(secret.input).toBe("secret-value");
    expect(secret.args).not.toContain("secret-value"); // never in arguments, where ps can read it
    expect(calls.find((c) => c.args.includes("PUT"))?.args).toEqual(expect.arrayContaining(["default_workflow_permissions=read", "can_approve_pull_request_reviews=true"]));
    expect(done.todo).toEqual(["gh secret set SHEPHERD_TOKEN --repo o/r", expect.stringContaining("repository admin")]);
    expect(calls.some((c) => c.args[0] === "pr" || c.args[0] === "push")).toBe(false); // setup never commits, pushes or opens PRs
  });
});
