---
title: "Trace an iteration"
---

Each iteration records its stages with `shepherd trace event` and closes with `shepherd trace flush`. With `OTEL_EXPORTER_OTLP_ENDPOINT` set, the flush exports one `shepherd.iteration` span with a child span per stage (checks, swarm, verify, triage, simplify, ci-repair, the wait on stamp), carrying the outcome, round, retries and head SHA. The iteration span carries the repository, PR number, head and base SHAs and CI run under the same attribute names stamp's review span uses, and links to related traces by traceparent. The CLI times the stages; model usage inside them is the harness's to report. Without an endpoint nothing loads and nothing exports. The flush clears the record either way and prints the export's error in its JSON when the collector is unreachable.
