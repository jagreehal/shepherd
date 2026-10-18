---
title: "Configuration reference"
---

Set repository policy in `.shepherd/config.yml`. The schema rejects unknown fields. An older repository can use `.shepherd/lenses.yml`, but keep only one of the two files.

## Fields

| Field | Type and default | Effect |
| --- | --- | --- |
| `extends` | List of local paths or pinned GitHub pack references; absent | Load packs in the listed order before repository settings |
| `ladder` | Non-empty list of model IDs; harness default | Route work from the cheapest suitable model upward |
| `models` | Map of lens or runner name to model ID; empty | Pin named work to a model |
| `lenses` | Map of lens names; empty | Add reviewers alongside the built-in lenses |
| `lenses.<name>.skill` | Required non-empty string | Installed skill name, repository path or resolved pinned-pack lens |
| `lenses.<name>.applies_to` | List of globs; absent | Match changed paths; without it the router chooses whether to run the lens |
| `lenses.<name>.description` | Non-empty string; skill description | Describe the lens for routing |
| `checks` | Map of names to `{ command: string }`; empty | Set the machine checks; an empty map leaves command discovery to the skills |
| `fixes.mode` | `suggest`, `local`, or `push`; built-in `push` | Limit code changes, commits, pushes and resolutions |
| `escalate.paths` | Non-empty list of globs; absent | Reserve changes to matching files for a person |
| `escalate.reason` | Non-empty string; `team policy: a person changes <path>` | Explain why the agent deferred a change |
| `recipes` | Map of names to `{ steps: [...] }`; built-in recipes | Compose supported stages in a named order |

Map keys for models, lenses, checks and recipes use lower-case names beginning with a letter, followed by letters, digits or hyphens. Model IDs pass to your harness as written; a Claude Code alias and an OpenCode `provider/model` ID are not interchangeable.

## Precedence and defaults

1. Built-in defaults.
2. Each pack in `extends`, in order.
3. The repository file.

Later layers replace scalar values and merge `lenses`, `checks`, `models` and `recipes` by name. A pack cannot extend another pack. Use a full 40-character commit SHA for a pack in another repository, and choose a commit on that repository's default branch.

`shepherd init` writes `fixes.mode: suggest` for a new repository. With no policy, the built-in mode is `push`. Migrating a legacy lenses file keeps push mode; extending a pack with `init --from` keeps the pack's mode. Inspect the effective mode before you run an agent.

Personal configuration in `~/.config/shepherd/lenses.yml` adds preview lenses and fills model choices the team has not set. It cannot change checks, fix mode, escalation or recipes; its findings do not post or get fixed.

## Recipe contracts

Supported steps: `swarm`, `triage`, `simplify`, `ci-repair`, `stamp`, `incident`. The CLI rejects unknown steps; arbitrary custom runners are not supported.

| Recipe | Steps | Mode |
| --- | --- | --- |
| `review` | swarm | Any |
| `fix` | swarm, triage, simplify, swarm | local or push |
| `pr` | swarm, triage, simplify, swarm, ci-repair, stamp | push |
| `incident` | incident, swarm, triage, simplify, swarm, ci-repair, stamp | push |

Put incident first and Stamp last. Run swarm before triage. Review after the final fixing step. In local mode the last review must cover working-tree fixes, so a remote Stamp review cannot replace that swarm. Suggest mode cannot run fixing steps.

## Inspect your configuration

```bash
shepherd config validate
shepherd config explain --working-tree
shepherd preview --working-tree --recipe review
```

Validation checks your working-tree policy. `explain` and `preview` use trusted default-branch policy unless you pass `--working-tree`. Read [team examples](/shepherd/configuration/examples/) for complete configurations.
