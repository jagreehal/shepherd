# Trace measurements for garden

The collector reads only the files, Tempo endpoint and Datadog site the
operator configures. Keep endpoints and credentials out of PR content and
generated proposals. The CLI only reads: GET requests to Tempo and span
searches to Datadog. It refuses redirects and returns measurements instead of
raw span attributes, prompts or tool inputs.

## Configure input

Pass `--traces <file>` once per OTLP JSON or collector JSON-lines export, or
set `GARDEN_TRACE_FILES` to a JSON array of paths. Set `GARDEN_TEMPO_URL` to a
Tempo query endpoint, with `GARDEN_TEMPO_HEADERS` as a JSON object of read-only
authentication headers; the CLI sends them only to that URL's origin. For
Datadog, set `GARDEN_DATADOG_SITE`, `GARDEN_DATADOG_API_KEY` and
`GARDEN_DATADOG_APP_KEY`; the keys go only to that Datadog site's API. Any
mix of sources may be active. The scheduled workflow collects in a step before the
agent and hands it the report as `GARDEN_REPORT`, so the agent never holds the
trace credentials. Never pass a trace credential into an agent session.

The CLI deduplicates spans by trace and span ID, and matches root spans to the
repository, PR and a commit present on that PR. The time window is `--since`
through collection time. Roots on an unknown commit contribute no measurement.
Model and tool spans do not add their costs again: only `stamp.cost_usd` on
the review root counts. A root without `stamp.cost_complete=true` has an
incomplete price, including older exports that omit that field. Cost comes from Stamp; Shepherd's
orchestration spans leave out the coding-agent harness's token usage.

## Read the result

The per-PR `telemetry` field gives iteration and review counts, stage durations,
failed stages, retries, approval wait, known review cost, unpriced review count
and up to 20 trace/span/head references. `null` means no matching sample.
The repository's `telemetry.coverage` states unavailable reads, whether limits
cut collection short, unmatched roots, and `untouchedPrs`: PRs with samples
that shepherd did not work on. Results describe observed samples;
collector sampling and retention can leave gaps even when all reads succeeded.

The default inspection thresholds are 3 retries, at least 300,000 ms and half
the iteration time waiting for approval, and $5 of known review cost per PR.
Operators can set `--trace-retries`, `--trace-wait-ms` and `--trace-cost-usd`.
The report records the values it used. A failed or unfinished stage needs no
threshold. These signals select evidence to investigate; they cannot approve
code, count a fix as accepted, loosen a gate or justify dropping verification.

Check GitHub for the cause, and cite the trace ID in any proposal. A proposal
about spend must name the measured backend: Stamp's reviewer cost cannot show
what Shepherd's orchestrating model spent. If no GitHub evidence supports a
cause, report the observation without proposing an edit. Done when the score
table separates observed failures and cost from unknown coverage.
