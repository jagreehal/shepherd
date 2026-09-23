---
description: Shepherd a PR to merge-ready (loop on Sonnet, reviews on their own ladder)
argument-hint: [pr-number-or-url]
model: sonnet
---

Invoke the `shepherd` skill with `$ARGUMENTS` and follow it.

This command pins the orchestration loop to Sonnet so you do not have to switch
models first. Runners and reviewers still pick their own rung from the model
ladder in `shepherd/references/models.md`.

For hands-off cadence: `/loop 5m /shepherd <pr>`.

<!-- shepherd-installed -->
