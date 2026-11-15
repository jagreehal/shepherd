---
title: "Trace an iteration"
---

Each iteration records its stages with `shepherd trace event` and closes with `shepherd trace flush`. With `OTEL_EXPORTER_OTLP_ENDPOINT` set, the flush exports one `shepherd.iteration` span with a child span per stage (checks, swarm, verify, triage, simplify, ci-repair, the wait on the gate), carrying the outcome, round, retries and head SHA. The iteration span carries the repository, PR number, head and base SHAs and CI run under the same attribute names the gate's review span uses, and links to related traces by traceparent. The CLI times the stages; model usage inside them is the harness's to report. Without an endpoint nothing loads and nothing exports. The flush clears the record either way and prints the export's error in its JSON when the collector is unreachable.

## Trace the gate

Each gate review exports a `gate.review` span when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. It carries the verdict, repository, PR, head and base SHAs, tier, tokens and cost, with a `chat` span per model call. Each `chat` span records `gen_ai.usage.cost.usd` from your `pricing:` and the price's `as_of` date as `gen_ai.usage.cost.price_as_of`.

In GitHub Actions, add `OTEL_EXPORTER_OTLP_ENDPOINT` as a variable and `OTEL_EXPORTER_OTLP_HEADERS` as a secret to the environment the review job runs in. The gate workflow passes both. Name the service with `telemetry: { service: ... }` in `.shepherd/gate.yml`; it defaults to `shepherd-gate`. [Garden](/shepherd/operations/gardener-telemetry/) reads these spans back to report review spend.
