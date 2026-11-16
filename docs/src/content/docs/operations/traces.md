---
title: "Trace an iteration"
---

## Trace the review

Each review exports a `gate.review` span when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. It carries the verdict, repository, PR, head and base SHAs, tier, tokens and cost, with a `chat` span per model call. Each `chat` span records `gen_ai.usage.cost.usd` from your `pricing:` and the price's `as_of` date as `gen_ai.usage.cost.price_as_of`.

In GitHub Actions, add `OTEL_EXPORTER_OTLP_ENDPOINT` as a variable and `OTEL_EXPORTER_OTLP_HEADERS` as a secret to the environment the review job runs in. `shepherd.yml` passes both. Name the service with `telemetry: { service: ... }` under `review:` in `.shepherd/config.yml`; it defaults to `shepherd-gate`. [Garden](/shepherd/operations/gardener-telemetry/) reads these spans back to report review spend.

## Trace the local loop

Each iteration of `/shepherd <pr>` in your coding agent records its stages with `shepherd trace event` and closes with `shepherd trace flush`. With `OTEL_EXPORTER_OTLP_ENDPOINT` set, the flush exports one `shepherd.iteration` span with a child span per stage (checks, swarm, verify, triage, simplify, ci-repair, the wait on the review), carrying the outcome, round, retries and head SHA. The iteration span carries the repository, PR number, head and base SHAs under the same attribute names the review span uses, and links to related traces by traceparent. The CLI times the stages; model usage inside them is the harness's to report. Without an endpoint nothing loads and nothing exports. The flush clears the record either way and prints the export's error in its JSON when the collector is unreachable.
