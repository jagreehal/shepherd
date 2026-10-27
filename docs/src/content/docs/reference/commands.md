---
title: "Command reference"
---

Use the terminal CLI for installation, configuration and records. Use your coding agent for the review and fixing skills. You can replace `shepherd` with `bunx @jagreehal/shepherd` if the CLI is not on `PATH`; include a package version when you need a repeatable CI setup.

## Setup and configuration: terminal

| Command | Options and purpose |
| --- | --- |
| `shepherd install` | `--project`, `--target <dir>`, `--link`, `--force`; install the skill pack |
| `shepherd uninstall` | `--project`, `--target <dir>`; remove files the installer owns |
| `shepherd init` | `--preset review-only\|local-fix\|push`, `--from <pack>`, `--stacks`, `--model <id>` (the session model, as `models.loop`); create repository policy, with a lens for each detected stack under `--stacks`. `--stacks` adds a lens only for a stack the effective policy lacks: a lens the file or a pack it extends already provides keeps its skill, scope and gate. On an existing policy it keeps every other setting |
| `shepherd doctor` | `--json`; diagnose local setup and repository policy |
| `shepherd config validate` | Validate working-tree policy and lens resolution |
| `shepherd config schema` | Print the JSON Schema of `.shepherd/config.yml`, the one `schema/config.json` ships and `shepherd init` links to |
| `shepherd config explain` | `--json`, `--working-tree`; show effective values and their sources. `--json` gives each lens's directory as `path`, a repository lens extracted from the default branch, and exits 1 naming any team lens that resolves nowhere |
| `shepherd ci-settings` | `--outputs`; the CI settings from repository variables, the default branch's `ci:` and the defaults, with sources. The workflows call it in a job that runs no model |
| `shepherd branding` | `--working-tree`; the branding comments post with (name, avatar, glyphs, headers), resolved and escaped, as JSON |
| `shepherd preview` | `--recipe <name>`, `--base <ref>`, `--working-tree`; show the plan for the change |
| `shepherd model-id <id>` | Print a model id as OpenCode spells it: `bedrock:<id>` becomes `amazon-bedrock/<id>`, and an OpenCode id or Claude Code alias passes through. `ci-models` applies the same spelling in the workflows |
| `shepherd stack <pr>` | Print, as JSON, the open PR this one is stacked on and the range to review (`parent_head...head`), or the long-lived branch it should target when most of its commits already sit there. Git ancestry only; the loop and swarm run it before they write the diff |
| `shepherd inline <round.json>` | Print swarm's inline review as the JSON payload for `POST /pulls/<n>/reviews`: each finding above NIT with a line in the diff, most severe first, at most 10, with its title, a one-click `suggestion` when the fix replaces exactly its lines, `Verified:`, the commands that checked it, and a collapsed prompt for AI agents. Run it from the reviewed checkout: it places each suggestion on the lines it rewrites, at their indentation, and posts one comment per place, naming the other findings on those lines under it |
| `shepherd summary <round.json> [--previous <comment.md>] [--body] [--fanout <fanout.json>]` | Render swarm's summary comment from the round's JSON, reading the reviewed files from the working directory as `inline` does, so both cite the same lines: the verdict heading and confidence, then collapsed sections for numbered findings, one agent prompt for every finding above NIT, pre-merge checks, the walkthrough, still open, checks, lenses and earlier rounds. `--previous` carries the round number and history forward from the comment on the PR; `--body` drops the marker, header and history for the handoff copy; `--fanout` (default `$SHEPHERD_FANOUT`) lists the router and each first-wave lens the round never reported as `could_not_run` |
| `shepherd fanout [--base <ref>] [--working-tree]` | Print the lenses swarm starts beside the router, as JSON: `correctness` on the whole diff and each custom lens whose `applies_to` matches a changed file, with its directory from the default branch. Exits 1 naming a team lens that resolves nowhere |
| `shepherd workflows [--audit] [--upgrade] [--model <id>] [--environment <name>] [--label <name>] [--aws-region <region>]` | Copy `shepherd.yml` and `shepherd-incident.yml` into `.github/workflows` (with `--audit`, also `shepherd-audit.yml`), keep files that exist (`--upgrade` rewrites them from the current templates, keeping the model job's environment and your `workflows:` list, and stops with `update it by hand` when it cannot read them; it never touches `.shepherd/config.yml`), and pin `SHEPHERD_VERSION` to this CLI's version. `--model` pins `models.loop` in `.shepherd/config.yml`; `--environment` puts only the model job in that GitHub environment, for environment-scoped model keys, and fills the environment line in workflows you kept |
| `shepherd lens new <name>` | `--from <template>` (react, nextjs, node-api, go, rust, java, dotnet, python, observability), repeatable `--applies <glob>`, `--description <text>`, `--model`; scaffold a lens |
| `shepherd lens add <skill>` | `--name`, repeatable `--applies`, `--description`, `--model`, `--global`; register a skill |
| `shepherd lens list` | List configured lenses and report problems |
| `shepherd models` | Show model routing |
| `shepherd models ladder <model-or-tier>...` | `--global`; set the ladder in cheapest-first order |
| `shepherd models pin <runner-lens-or-group> <model-or-tier>` | `--global`; pin named work, or a role group (`reviewers`, `fixers`, `validators`), to a model or tier |
| `shepherd models tier <name> <model>` | `--global`; name a model once, for the ladder and pins |
| `shepherd ci-models` | Print, as JSON, the CI session model, the key variable its provider reads, and the OpenCode agents for the ladder and pins, from the default branch. The workflows run it |
| `shepherd opencode-agents` | `--file <lenses.yml>`; print model agents for OpenCode 1.x |

## Local records: terminal

| Command | Purpose |
| --- | --- |
| `shepherd local change [--base <ref>]` | Capture the current change and its fingerprint |
| `shepherd local finish <record.json> [--base <ref>]` | Check review completeness and write a receipt when complete; exits 2 when incomplete |
| `shepherd local status [--base <ref>]` | Check whether the receipt covers current content; exits 1 unless `reviewed` |
| `shepherd local demo [<dir>]` | Create the planted-bug demonstration repository |
| `shepherd acceptance <suggest\|local> [--pr <n>] -- <agent-command>...` | Run an agent and check its writes against the mode |

A `complete` local record proves the review covered the captured ranges. It does not establish that the reviewer found each defect: `shepherd eval` measures that. An edit invalidates the matching receipt.

## Evaluation: terminal

| Command | Purpose |
| --- | --- |
| `shepherd eval run <cases-dir> --config <label> -- <agent-command>...` | Review each case in a fresh clone of its head and keep each run; `--repeat <n>`, `--out <dir>`; `{base}` and `{head}` in the command are filled in |
| `shepherd eval score <runs-dir>` | Recall, precision, false positives and duplicates per configuration, development and held-out apart, and the cheapest configuration within noise of the best; `--cases <dir>`, `--json` |

See [measure review accuracy](/shepherd/contributing/evaluation/).

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
| `/shepherd --local [--base <ref>]` | Review and fix before a PR, with no GitHub writes; `--base` measures from that ref |
| `/swarm 42` | Run the review swarm |
| `/swarm --local [--base <ref>]` | Review the local change without fixes |
| `/swarm --preview` | Preview lenses without posting findings |
| `/triage 42` | Work through eligible review threads |
| `/ci-repair 42` | Repair CI failures within the skill rules |
| `/review-security` | Run one review lens |
| `/incident <run-url\|issue\|error-file>` | Investigate a failure and attempt a reproducing test and fix |

`/loop 5m /shepherd 42` is a scheduling command for harnesses that support it. Use [GitHub Actions](/shepherd/integrations/github-actions/) for scheduling independent of your local session. Read [the skill catalog](/shepherd/reference/skills/) for other installed skills.
