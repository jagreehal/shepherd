---
"@jagreehal/shepherd": minor
---

- Swarm, triage, ci-repair and incident read executable-stories runs as evidence, and compare runs of the same scope.
- `shepherd trace event` and `shepherd trace flush` export each iteration as a `shepherd.iteration` span with a span per stage.
- `shepherd garden` adds trace measurements from OTLP files, Grafana Tempo or Datadog to its GitHub scores.
- Triage reads Claude Code Review's severity markers, and the loop waits on its check run.
- Updated autotel, zod and yaml.
