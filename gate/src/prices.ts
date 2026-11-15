import { z } from "zod";
import { parseModelId } from "./llm.ts";

/** One `pricing:` entry in `.shepherd/gate.yml`, as `gate init` writes it. */
export interface PriceEntry {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
  as_of: string;
  source: string;
}

const DEFAULT_URL = "https://models.dev/api.json";

/** Shepherd's provider names, as models.dev spells them. */
const MODELS_DEV_PROVIDER = new Map([
  ["bedrock", "amazon-bedrock"],
  ["gateway", "vercel"],
]);

/** A Bedrock cross-region inference profile prefix, which models.dev may list only on the foundation id. */
const PROFILE_PREFIX = /^(?:eu|us|us-gov|apac|au|jp|in|global)\./;

const Cost = z.object({ input: z.number(), output: z.number(), cache_read: z.number().optional() });

/** One provider's slice of models.dev's catalogue: model id → entry. Only this provider is validated, so an odd entry elsewhere cannot hide a price. */
const ProviderModels = z.object({ models: z.record(z.string(), z.object({ cost: z.unknown() }).loose()) }).loose();

/**
 * Today's list price for a model from models.dev's public catalogue, dated and sourced, or null when the
 * catalogue has none or cannot be read. Shepherd ships no prices: this one is written into the repo's
 * reviewed policy, where the team can see its date and change it.
 * `SHEPHERD_PRICES_URL=off` skips the lookup; any other value replaces the catalogue's URL.
 */
export async function catalogPrice(modelId: string, o: { fetch?: (url: string, init: RequestInit) => Promise<Response>; url?: string; today?: string } = {}): Promise<{ key: string; price: PriceEntry } | null> {
  const url = o.url ?? process.env.SHEPHERD_PRICES_URL ?? DEFAULT_URL;

  if (url === "off") return null;

  const { provider, model } = parseModelId(modelId);
  const catalogProvider = MODELS_DEV_PROVIDER.get(provider) ?? provider;
  let models: z.infer<typeof ProviderModels>["models"];

  try {
    const res = await (o.fetch ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) return null;
    models = ProviderModels.parse(z.record(z.string(), z.unknown()).parse(await res.json())[catalogProvider]).models;
  } catch {
    return null; // offline, slow or an unexpected shape: init still succeeds, and prints how to add a price
  }

  const cost = [model, model.replace(PROFILE_PREFIX, "")].map((id) => Cost.safeParse(models[id]?.cost)).find((r) => r.success)?.data;

  if (!cost) return null;

  const price: PriceEntry = { inputPer1M: cost.input, outputPer1M: cost.output, as_of: o.today ?? new Date().toISOString().slice(0, 10), source: `models.dev ${catalogProvider} list price` };

  if (cost.cache_read !== undefined) price.cachedInputPer1M = cost.cache_read;

  return { key: model, price };
}
