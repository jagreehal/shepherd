---
title: "Command reference"
---

Use the terminal CLI for installation, configuration and records. Use your coding agent for the review and fixing skills. You can replace `shepherd` with `bunx @jagreehal/shepherd` if the CLI is not on `PATH`; include a package version when you need a repeatable CI setup.

## Setup and configuration: terminal

| Command | Options and purpose |
| --- | --- |
| `shepherd install` | `--project`, `--target <dir>`, `--link`, `--force`; install the skill pack |
| `shepherd uninstall` | `--project`, `--target <dir>`; remove files the installer owns |
| `shepherd init` | `--preset review-only\|local-fix\|push`, `--from <pack>`; create repository policy |
| `shepherd doctor` | `--json`; diagnose local setup and repository policy |
| `shepherd config validate` | Validate working-tree policy and lens resolution |
| `shepherd config explain` | `--json`, `--working-tree`; show effective values and their sources |
| `shepherd preview` | `--recipe <name>`, `--base <ref>`, `--working-tree`; show the plan for the change |
| `shepherd workflows` | Copy `shepherd.yml` and `shepherd-incident.yml` into `.github/workflows`, keep files that exist, and pin `SHEPHERD_VERSION` to this CLI's version |
| `shepherd lens new <name>` | `--from <template>`, repeatable `--applies <glob>`, `--description <text>`, `--model`; scaffold a lens |
| `shepherd lens add <skill>` | `--name`, repeatable `--applies`, `--description`, `--model`, `--global`; register a skill |
| `shepherd lens list` | List configured lenses and report problems |
| `shepherd models` | Show model routing |
| `shepherd models ladder <model>...` | `--global`; set the ladder in cheapest-first order |
| `shepherd models pin <lens-or-runner> <model>` | `--global`; pin named work to a model |
| `shepherd opencode-agents` | `--file <lenses.yml>`; print model agents for OpenCode 1.x |

## Local records: terminal

| Command | Purpose |
| --- | --- |
| `shepherd local change [--base <ref>]` | Capture the current change and its fingerprint |
| `shepherd local finish <record.json> [--base <ref>]` | Check review completeness and write a receipt when complete; exits 2 when incomplete |
| `shepherd local status [--base <ref>]` | Check whether the receipt covers current content; exits 1 unless `reviewed` |
| `shepherd local demo [<dir>]` | Create the planted-bug demonstration repository |
| `shepherd acceptance <suggest\|local> [--pr <n>] -- <agent-command>...` | Run an agent and check its writes against the mode |

A `complete` local record proves the review covered the captured ranges. It does not establish that the reviewer found each defect. An edit invalidates the matching receipt.

## Operations: terminal

| Command | Purpose |
| --- | --- |
| `shepherd garden <owner/repo>...` | Score runs; `--since`, `--min-prs`, repeatable `--traces`, `--tempo-url`, `--trace-retries`, `--trace-wait-ms`, `--trace-cost-usd` control collection and thresholds |
| `shepherd trace event <stage> <start\|end> --pr <n>` | Record a stage; `--round`, `--outcome ok\|failed\|skipped`, `--retries`, `--head` add context |
| `shepherd trace flush --pr <n> --repo <owner/repo> --head <sha> --outcome <how it ended>` | Export and clear an iteration; `--base`, `--ci-run`, `--ci-attempt`, repeatable `--related <traceparent>` add context |
| `shepherd notify --pr <n> --repo <owner/repo> --head <sha> --state <state> --file <path>` | Send a state notification when `SHEPHERD_NOTIFY_WEBHOOK` is set; prints `sent`, `unchanged`, `off` or `failed` and never fails the iteration |

See [trace scoring](/shepherd/operations/gardener-telemetry/) for telemetry credentials and [notifications](/shepherd/integrations/notifications/) for notification semantics. `config validate` exits non-zero for invalid policy; acceptance exits 1 when the run broke its mode and 2 when the agent did not finish. Read JSON result fields rather than equating a successful CLI invocation with merge readiness.

## Review and fixing: coding agent

| Command | Task |
| --- | --- |
| `/shepherd 42` | Run the recipe selected by team policy on PR 42 |
| `/shepherd 42 --recipe <name>` | Run a configured recipe |
| `/shepherd --local` | Review and fix before a PR, with no GitHub writes |
| `/swarm 42` | Run the review swarm |
| `/swarm --local` | Review the local change without fixes |
| `/swarm --preview` | Preview lenses without posting findings |
| `/triage 42` | Work through eligible review threads |
| `/ci-repair 42` | Repair CI failures within the skill rules |
| `/review-security` | Run one review lens |
| `/incident <run-url\|issue\|error-file>` | Investigate a failure and attempt a reproducing test and fix |

`/loop 5m /shepherd 42` is a scheduling command for harnesses that support it. Use [GitHub Actions](/shepherd/integrations/github-actions/) for scheduling independent of your local session. Read [the skill catalog](/shepherd/reference/skills/) for other installed skills.
