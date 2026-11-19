---
title: "Score exported traces in garden"
description: "Feed garden the traces Shepherd exports, from files, Grafana Tempo or Datadog, and read the trace signals and coverage limits in its report."
---

The CI review and Shepherd's local loop already export spans through autotel once `OTEL_EXPORTER_OTLP_ENDPOINT` is set (see [Trace an iteration](/shepherd/operations/traces/)). [Garden](/shepherd/operations/gardening/) can read those traces back and add them to its score. Scoring from GitHub alone needs no telemetry backend, and trace signals never change the accepted-fix rule.

## Choose a trace source

Garden reads traces from three sources. Pick one, or combine them: trace and span IDs prevent duplicate counts where they overlap.

| Source | When to use it | Set |
| --- | --- | --- |
| [Exported files](#read-exported-files) | Your collector writes OTLP to disk | `--traces <file>` or `GARDEN_TRACE_FILES` |
| [Grafana Tempo](#query-grafana-tempo) | Your traces land in Tempo | `GARDEN_TEMPO_URL`, `GARDEN_TEMPO_HEADERS` |
| [Datadog](#query-datadog) | Your traces land in Datadog through its OTLP intake | `GARDEN_DATADOG_SITE`, `GARDEN_DATADOG_API_KEY`, `GARDEN_DATADOG_APP_KEY` |

## Read exported files

Garden reads an uncompressed OTLP JSON export, or the collector's JSON-lines file exporter. It doesn't scan the working tree, so pass each file explicitly:

```bash
shepherd garden acme/service --since 2026-10-01 \
  --traces /var/lib/otel/garden.jsonl \
  --traces /var/lib/otel/garden-previous.jsonl
```

For scheduled invocations, set `GARDEN_TRACE_FILES` to a JSON array of paths available on that runner.

Copy closed or rotated files before garden reads them. A batch still being written can leave an incomplete JSON line. Garden then marks that source unavailable, rather than reading half a batch as a successful run.

### Add a file exporter to your collector

A collector pipeline can write a file alongside its existing backend exporter:

```yaml
exporters:
  file/garden:
    path: /var/lib/otel/garden.jsonl
    format: json
    rotation:
      max_megabytes: 8
      max_days: 14
      max_backups: 20
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [file/garden] # add your existing backend exporter here too
```

Keep the pipeline's existing receiver and processor definitions, and mount a writable directory for the file exporter. See the collector's [file exporter contract](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/fileexporter).

### File limits

Garden applies these limits to files:

- **Each file**: a regular file of at most 10 MB. Garden refuses symlinks and compressed exports.
- **Each report**: at most 100 files, 50,000 spans and 50 MB of normalized measurements.

## Query Grafana Tempo

Point garden at Tempo's query endpoint, not its OTLP ingestion URL:

```bash
export GARDEN_TEMPO_URL=https://tempo.example.com
# Supply this through your secret manager; do not commit it:
# GARDEN_TEMPO_HEADERS={"Authorization":"Bearer ...","X-Scope-OrgID":"..."}
shepherd garden acme/service --since 2026-10-01
```

Set a read-only credential in `GARDEN_TEMPO_HEADERS`. Grafana Cloud tenants can supply their Basic Authorization and tenant headers through the same object.

The reader calls Tempo's [search and trace-by-ID APIs](https://grafana.com/docs/tempo/latest/api_docs/), within these bounds:

- **Search scope**: only the selected repository and window, for `shepherd.iteration` and `gate.review`.
- **Fetches**: at most 100 traces, within a shared 30-second budget.
- **Size**: responses have a 10 MB cap, and the report has a 50,000-span cap.
- **Redirects**: the reader follows none.
- **Credentials**: authentication headers never appear in the report. The CLI sends `GARDEN_TEMPO_HEADERS` only to the origin `GARDEN_TEMPO_URL` names, so a `--tempo-url` on another origin gets no headers.

### Use Tempo in the weekly workflow

For the bundled weekly workflow, set the repository variable `GARDEN_TEMPO_URL` and the secret `GARDEN_TEMPO_HEADERS`. A step before the agent runs the collector with them and writes the report to `GARDEN_REPORT`. The agent reads that file and never holds the Tempo credential. The publisher's write token needs no change.

## Query Datadog

Garden reads spans that the CI review and the local loop sent through Datadog's OTLP intake, with `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.<site>` and `OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=<key>`. Set three variables:

```bash
export GARDEN_DATADOG_SITE=datadoghq.eu   # your Datadog site
export GARDEN_DATADOG_API_KEY=...         # from your secret manager
export GARDEN_DATADOG_APP_KEY=...         # an application key scoped to apm_read
shepherd garden acme/service --since 2026-10-01
```

The reader calls the [span search API](https://docs.datadoghq.com/api/latest/spans/) on `api.<site>`, and only for the listed Datadog sites, so the keys never go anywhere else. It works like this:

- **Roots first**: it finds the repository's `shepherd.iteration` and `gate.review` roots, then fetches their traces in batches of 50, since stage spans carry no repository.
- **Mapping**: Datadog nests OTLP attributes under `custom` and stores span IDs in decimal. The reader maps both back.
- **Rate limit**: the span search API allows 300 requests an hour. A weekly run stays well under it.
- **Partial results**: a root search with more results than the reader read, or a page Datadog marks partial (a status other than `done`, such as `timeout`, or any warning), sets `coverage.limited`. The reader still pages through every trace it found.

### Use Datadog in the weekly workflow

For the bundled weekly workflow, set the repository variable `GARDEN_DATADOG_SITE` and the secrets `GARDEN_DATADOG_API_KEY` and `GARDEN_DATADOG_APP_KEY`. The collector step reads them; the agent never does.

## Read the trace signals

Garden's JSON adds a `telemetry` summary per pull request and a fixed set of inspection signals. Each signal fires at its default trigger:

| Signal | Default trigger |
| --- | --- |
| `trace_stage_failed` | A recorded stage failed or never finished |
| `trace_retries` | At least 3 recorded retries on the pull request |
| `trace_approval_wait` | At least 5 minutes, and half the observed iteration time, waiting for approval |
| `trace_review_cost` | At least $5 of known review cost on the pull request |

To change the thresholds, pass `--trace-retries`, `--trace-wait-ms` and `--trace-cost-usd`. The report includes their effective values, coverage limits, unavailable reads, and the trace IDs behind each pull request's samples.

### Coverage and cost

Read these fields before you trust a number:

- **`coverage.untouchedPrs`**: counts pull requests with trace samples that Shepherd didn't work on, such as one only the CI review saw. The report scores Shepherd's runs, so their samples stay out of the per-pull-request summaries.
- **Missing runs**: sampling or retention can omit runs, so the report never claims a complete history.
- **`unpricedReviews`**: separates missing or incomplete prices from zero cost. Older spans without `gate.cost_complete` remain incomplete, even when their known subtotal is available.
- **Review cost**: the gate's root cost already includes its reviewer calls, so child model spans don't add it again.
- **Stage spans**: Shepherd's stage spans measure orchestration time, and they exclude the harness's model cost.

### Act on a signal

The gardener investigates these signals against GitHub and cites trace IDs in its proposals. A threshold crossing alone doesn't justify a skill edit, a weaker test, or a new lint rule. Accepted fixes still require the existing unreverted `Shepherd-Fixes` trailers and trusted pull request authors.

## Related resources

- [Improve reviews with garden](/shepherd/operations/gardening/): run garden and the weekly workflow
- [Trace an iteration](/shepherd/operations/traces/): turn on the spans garden reads
- [Environment and credentials](/shepherd/reference/environment/): the variables Shepherd reads
