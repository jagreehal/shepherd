---
title: "Score exported traces in garden"
---

Stamp and Shepherd already export through autotel when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set. Garden reads those traces from files,
Grafana Tempo, Datadog, or any mix of them. No telemetry backend is required for GitHub-only
scoring, and trace signals never change the accepted-fix rule.

## File exports

Use an uncompressed OTLP JSON export, or the collector's JSON-lines file
exporter. Pass explicit files; garden does not scan the working tree:

```bash
shepherd garden acme/service --since 2026-10-01 \
  --traces /var/lib/otel/garden.jsonl \
  --traces /var/lib/otel/garden-previous.jsonl
```

For scheduled invocations, set `GARDEN_TRACE_FILES` to a JSON array of paths
available on that runner. Copy closed/rotated files before reading them; a
batch being written can leave an incomplete JSON line, which marks that source
unavailable rather than interpreting half a batch as a successful run.

A collector pipeline can keep a file alongside its existing backend exporter:

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

Keep the pipeline's existing receiver/processor definitions and mount a writable
directory for the file exporter. See the collector's
[file exporter contract](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/fileexporter).
Files must be regular files, at most 10 MB each; symlinks and compressed exports
are refused. At most 100 files, 50,000 spans and 50 MB of normalized
measurements enter one report.

## Grafana Tempo

Use the query endpoint, not its OTLP ingestion URL:

```bash
export GARDEN_TEMPO_URL=https://tempo.example.com
# Supply this through your secret manager; do not commit it:
# GARDEN_TEMPO_HEADERS={"Authorization":"Bearer ...","X-Scope-OrgID":"..."}
shepherd garden acme/service --since 2026-10-01
```

The reader calls Tempo's [search and trace-by-ID APIs](https://grafana.com/docs/tempo/latest/api_docs/).
It searches only the selected repository and window for `shepherd.iteration`
and `stamp.review`, then fetches at most 100 traces within a shared 30-second
budget. Responses have a 10 MB cap, the report has a 50,000-span cap, and the
reader follows no redirects. Authentication headers never appear in the report.
Set a read-only credential. Grafana Cloud tenants can supply their Basic
Authorization and tenant headers through the same object.

The CLI sends `GARDEN_TEMPO_HEADERS` only to the origin `GARDEN_TEMPO_URL`
names. A `--tempo-url` on another origin gets no headers.

For the bundled weekly workflow, set the repository variable `GARDEN_TEMPO_URL`
and secret `GARDEN_TEMPO_HEADERS`. A step before the agent runs the collector
with them and writes the report to `GARDEN_REPORT`; the agent reads that file
and never holds the Tempo credential. No change to the publisher's write token
is needed. Exported files, Tempo and Datadog can overlap; trace/span IDs
prevent duplicate counts.

## Datadog

Garden reads spans that stamp and shepherd sent through Datadog's OTLP intake
(`OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.<site>` with
`OTEL_EXPORTER_OTLP_HEADERS=dd-api-key=<key>`). Set three variables:

```bash
export GARDEN_DATADOG_SITE=datadoghq.eu   # your Datadog site
export GARDEN_DATADOG_API_KEY=...         # from your secret manager
export GARDEN_DATADOG_APP_KEY=...         # an application key scoped to apm_read
shepherd garden acme/service --since 2026-10-01
```

The reader calls the [span search API](https://docs.datadoghq.com/api/latest/spans/)
on `api.<site>`, and only for the listed Datadog sites, so the keys never go
anywhere else. It finds the repository's `shepherd.iteration` and
`stamp.review` roots, then fetches their traces in batches of 50, since stage
spans carry no repository. Datadog nests OTLP attributes under `custom` and
stores span IDs in decimal; the reader maps both back. The span search API
allows 300 requests an hour, which a weekly run stays well under.
A root search with more results than it read, or a page Datadog marks partial
(a status other than `done`, such as `timeout`, or any warning), sets
`coverage.limited`; the reader still pages through every trace it found.

For the bundled weekly workflow, set the repository variable
`GARDEN_DATADOG_SITE` and the secrets `GARDEN_DATADOG_API_KEY` and
`GARDEN_DATADOG_APP_KEY`. The collector step reads them; the agent never does.

## Assess the measurements

The JSON adds a `telemetry` summary per PR and fixed inspection signals:

| Signal | Default trigger |
| --- | --- |
| `trace_stage_failed` | A recorded stage failed or never finished |
| `trace_retries` | At least 3 recorded retries on the PR |
| `trace_approval_wait` | At least 5 minutes, and half the observed iteration time, waiting for approval |
| `trace_review_cost` | At least $5 of known Stamp review cost on the PR |

Use `--trace-retries`, `--trace-wait-ms` and `--trace-cost-usd` to change the
inspection thresholds. The report includes their effective values, coverage
limits, unavailable reads and the trace IDs behind each PR's samples.
`coverage.untouchedPrs` counts PRs with trace samples that shepherd did not
work on, such as a PR stamp reviewed alone; the report scores shepherd's runs,
so their samples stay out of the per-PR summaries. Sampling
or retention can omit runs, so the report never claims a complete history.
`unpricedReviews` distinguishes missing or incomplete prices from zero cost.
Older spans without `stamp.cost_complete` remain incomplete even when their
known subtotal is available. Stamp's root cost
already includes its reviewer calls; child model spans do not add it again.
Shepherd's stage spans measure orchestration time, not the harness's model cost.

The gardener investigates these signals against GitHub and cites trace IDs in
its proposals. A threshold crossing alone does not justify a skill edit, a
weaker test, or a new lint rule. Accepted fixes still require the existing
unreverted `Shepherd-Fixes` trailers and trusted PR authors.
