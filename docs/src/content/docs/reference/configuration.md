---
title: "Configuration reference"
---

Set repository policy in `.shepherd/config.yml`. The schema rejects unknown fields. An older repository can use `.shepherd/lenses.yml`, but keep only one of the two files.

## Fields

| Field | Type and default | Effect |
| --- | --- | --- |
| `extends` | List of local paths or pinned GitHub pack references; absent | Load packs in the listed order before repository settings |
| `tiers` | Map of name to model ID | Name a model once; `ladder` and `models` may use the name, and swapping the model swaps it everywhere |
| `ladder` | Non-empty list of model IDs or tier names; harness default | Route work from the cheapest suitable model upward |
| `models` | Map of runner, lens or role group to model ID or tier | Pin work to a model. Role groups: `reviewers` (router and every lens), `fixers` (triage, simplify, ci-repair, incident), `validators` (verifier, validator). `loop` is the CI session model. A runner or lens pin beats its group |
| `lenses` | Map of lens names; empty | Add reviewers alongside the built-in lenses |
| `lenses.<name>.skill` | Non-empty string; required once layers merge | Installed skill name, repository path or resolved pinned-pack lens; a layer may omit it to change a lens an earlier layer defined |
| `lenses.<name>.applies_to` | List of globs; absent | Match changed paths; without it the router chooses whether to run the lens |
| `lenses.<name>.description` | Non-empty string; skill description | Describe the lens for routing |
| `lenses.<name>.only` | Non-empty list of rule id globs; absent | Review only the matching rules |
| `lenses.<name>.disable` | Non-empty list of rule id globs; absent | Skip the matching rules |
| `lenses.<name>.gate` | `refuse`, `escalate`, or `note`; absent | Set stamp's `on_break` for the lens's untagged rules when stamp inherits it |
| `checks` | Map of names to `{ command: string }`; empty | Set the machine checks; an empty map leaves command discovery to the skills |
| `fixes.mode` | `suggest`, `local`, or `push`; built-in `push` | Limit code changes, commits, pushes and resolutions |
| `escalate.paths` | Non-empty list of globs; absent | Reserve changes to matching files for a person |
| `escalate.reason` | Non-empty string; `team policy: a person changes <path>` | Explain why the agent deferred a change |
| `recipes` | Map of names to `{ steps: [...] }`; built-in recipes | Compose supported stages in a named order |

Map keys for models, lenses, checks and recipes use lower-case names beginning with a letter, followed by letters, digits or hyphens. Model IDs pass to your harness as written; a Claude Code alias and an OpenCode `provider/model` ID are not interchangeable. `opencode-agents` also accepts stamp's canonical `provider:model` IDs and writes them the OpenCode way, so `bedrock:<id>` becomes `amazon-bedrock/<id>`.

## Precedence and defaults

1. Built-in defaults.
2. Each pack in `extends`, in order.
3. The repository file.

Later layers replace scalar values and merge `lenses`, `checks`, `models` and `recipes` by name; a lens merges field by field, so a layer can set one field of a lens an earlier layer defined. A pack can extend packs, up to four deep, with no cycle. Use a full 40-character commit SHA for a pack in another repository, and choose a commit on that repository's default branch.

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
