---
"@jagreehal/shepherd": minor
---

Choose the models, see where the loop got to, and let shepherd improve itself.

- `ladder:` and `models:` in `.shepherd/lenses.yml` pick the model for each rung, lens, and runner, from any provider your harness reaches. `shepherd models ladder`, `shepherd models pin`, and `lens add --model` write them; `shepherd models` prints what will run.
- `shepherd opencode-agents` prints one OpenCode agent per rung and pin, so OpenCode 1.x runs each subagent on its own model.
- Every iteration sets a `shepherd` commit status on the head: `pending` while work remains, `failure` naming what the author needs to do, `success` once stamp approves and nothing is open. The loop stops when only the author can move the PR.
- Triage names each rule it fixes in a `Shepherd-Fixes` trailer.
- `shepherd garden <owner/repo>...` scores recent runs from GitHub: reverted fixes, replies in shepherd threads, round caps, loops that stopped short or went quiet, and the lens rules triage fixed on 3+ PRs.
- The `garden` skill turns those scores into PRs with skill edits and lint rules, and `.github/workflows/garden.yml` runs it weekly with the agent read-only and a separate job opening the PRs.
