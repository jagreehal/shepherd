---
"@jagreehal/shepherd": minor
---

Measure review accuracy, and check more of each round in code.

- `shepherd eval run` reviews frozen cases in fresh clones with any agent command and records each run with its version, skill hash, command, cost and duration. `shepherd eval score` reports recall, precision, false positives, near misses and duplicates per configuration, with development and held-out cases apart, and names the cheapest configuration within noise of the best.
- Swarm verifies every finding above NIT with a worked example (input, expected, actual), carried in a new `evidence` field. It merges findings that share a root cause and fix, and the correctness lens starts from what the change promises.
- `shepherd summary` and `shepherd inline` grade a HIGH or CRITICAL without `evidence` as MEDIUM, mark unverified findings, keep the verdict at least as strict as its findings, mark a round with an unfinished lens incomplete, and keep thread links only when they match a review comment's URL on the PR. One-click suggestions land on the lines they rewrite.
