---
title: "Trace an iteration"
description: "Export OpenTelemetry spans for each CI review and each local loop iteration, and send them to the collector garden reads from."
---

Shepherd exports OpenTelemetry spans for two things: each review the CI job runs, and each iteration of the local `/shepherd <pr>` loop. It exports nothing until you set `OTEL_EXPORTER_OTLP_ENDPOINT`. [Garden](/shepherd/operations/gardener-telemetry/) reads these spans back to score runs and report review spend.

## Trace the review

With `OTEL_EXPORTER_OTLP_ENDPOINT` set, each review exports a `gate.review` span. The span carries:

- **Review**: the verdict, repository, pull request, head and base SHAs, and tier.
- **Usage**: tokens and cost.
- **Model calls**: a `chat` child span per model call. Each `chat` span records `gen_ai.usage.cost.usd` from your `pricing:`, and the price's `as_of` date as `gen_ai.usage.cost.price_as_of`.

To turn it on in GitHub Actions, follow these steps.

**1. Add the endpoint and headers**

In the environment the review job runs in, add `OTEL_EXPORTER_OTLP_ENDPOINT` as a variable and `OTEL_EXPORTER_OTLP_HEADERS` as a secret. `shepherd.yml` passes both to the job.

**2. Name the service**

Set `telemetry: { service: ... }` under `review:` in `.shepherd/config.yml`. The service name defaults to `shepherd-gate`.

## Trace the local loop

Each iteration of `/shepherd <pr>` in your coding agent records its stages with `shepherd trace event` and closes with `shepherd trace flush`. The skill runs both commands for you:

```bash
shepherd trace event <stage> <start|end> --pr <n> [--round <n>] [--outcome ok|failed|skipped] [--retries <n>] [--head <sha>]
shepherd trace flush --pr <n> --repo <owner/repo> --head <sha> --outcome <how it ended> [--base <sha>] [--ci-run <id> --ci-attempt <n>] [--related <traceparent>]...
```

With `OTEL_EXPORTER_OTLP_ENDPOINT` set, the flush exports one `shepherd.iteration` span. It has a child span per stage: checks, swarm, verify, triage, simplify, ci-repair, and the wait on the review. Each carries the outcome, round, retries and head SHA.

The iteration span carries the repository, pull request number, and head and base SHAs, under the same attribute names the review span uses. It links to related traces by traceparent.

The CLI times the stages. Model usage inside a stage is the harness's to report.

Without an endpoint, Shepherd loads no exporter and exports nothing. The flush clears the record either way. If the collector is unreachable, the flush prints the export's error in its JSON.

## Related resources

- [Score exported traces in garden](/shepherd/operations/gardener-telemetry/): read these spans from files, Grafana Tempo or Datadog
- [Improve reviews with garden](/shepherd/operations/gardening/): turn scored runs into skill edits and lint rules
- [Environment and credentials](/shepherd/reference/environment/): every variable the review job reads
- [Configuration reference](/shepherd/reference/configuration/): the `review:` keys, including `pricing`
