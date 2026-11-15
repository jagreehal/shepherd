import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { catalogPrice } from "./prices.ts";
import { DEFAULTS_DIR, PolicySchema, policyWithSettings } from "./policy.ts";

const catalog = {
  "amazon-bedrock": { models: { "openai.gpt-oss-120b-1:0": { cost: { input: 0.15, output: 0.6 } }, "anthropic.claude-haiku-4-5-20251001-v1:0": { cost: { input: 1, output: 5, cache_read: 0.1 } } } },
  anthropic: { models: { "claude-opus-5": { cost: { input: 5, output: 25, cache_read: 0.5 } } } },
  "odd-router": { models: { "no-cost": {} } }, // another provider's entry without a cost must not hide a price
};

const serve = (json: string, status = 200) => async () => new Response(json, { status });

const offline = async (): Promise<Response> => {
  throw new Error("offline");
};

const at = { url: "https://catalog.test/api.json", today: "2026-11-14" };

describe("catalogPrice", () => {
  test("prices a model from the catalogue, dated and sourced, keyed as the policy resolves it", async () => {
    expect(await catalogPrice("bedrock/openai.gpt-oss-120b-1:0", { ...at, fetch: serve(JSON.stringify(catalog)) })).toEqual({
      key: "openai.gpt-oss-120b-1:0",
      price: { inputPer1M: 0.15, outputPer1M: 0.6, as_of: "2026-11-14", source: "models.dev amazon-bedrock list price" },
    });
    expect((await catalogPrice("claude-opus-5", { ...at, fetch: serve(JSON.stringify(catalog)) }))?.price.cachedInputPer1M).toBe(0.5);
  });

  test("a Bedrock inference profile prices as its foundation model", async () => {
    expect((await catalogPrice("bedrock:eu.anthropic.claude-haiku-4-5-20251001-v1:0", { ...at, fetch: serve(JSON.stringify(catalog)) }))?.price.inputPer1M).toBe(1);
  });

  test("an unknown model, a failed fetch, or the off switch writes no price", async () => {
    expect(await catalogPrice("bedrock/acme.unknown-1", { ...at, fetch: serve(JSON.stringify(catalog)) })).toBeNull();
    expect(await catalogPrice("claude-opus-5", { ...at, fetch: serve("{}", 503) })).toBeNull();
    expect(await catalogPrice("claude-opus-5", { ...at, fetch: offline })).toBeNull();
    expect(await catalogPrice("claude-opus-5", { ...at, url: "off", fetch: serve(JSON.stringify(catalog)) })).toBeNull();
  });

  test("the written price is a valid policy entry", async () => {
    const priced = await catalogPrice("bedrock/openai.gpt-oss-120b-1:0", { ...at, fetch: serve(JSON.stringify(catalog)) });
    const text = policyWithSettings(readFileSync(path.join(DEFAULTS_DIR, ".shepherd/gate.yml"), "utf8"), { model: "bedrock/openai.gpt-oss-120b-1:0", pricing: { [priced!.key]: priced!.price } });

    expect(PolicySchema.parse(parseYaml(text)).pricing).toEqual({ "openai.gpt-oss-120b-1:0": priced!.price });
  });
});
