---
"@jagreehal/shepherd": minor
---

The gate prices each review from `pricing:` in `.shepherd/gate.yml`. Each price can record `as_of` and `source`, and `shepherd init` writes a dated list price from models.dev for the model you choose, so the dollar budget works from the first review. Traces carry the price date as `gen_ai.usage.cost.price_as_of` on every `chat` span. Eval runs record tokens and tool calls. Setup names the provider key for the model the gate will use, and shepherd moves to autotel 9.3, autotel-genai 0.17 and autotel-bedrock 4.
