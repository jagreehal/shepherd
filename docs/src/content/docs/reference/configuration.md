---
title: "Configuration reference"
description: "Look up every field in .shepherd/config.yml, how packs and defaults take precedence, which recipe orders validation accepts, and the commands that inspect a policy."
---

This page lists every field you can set in `.shepherd/config.yml`, the file that holds a repository's Shepherd policy. The schema rejects unknown fields. The review in CI reads its own policy from the `review:` key, and the other fields govern the skills and the lenses both use.

:::note
An older repository can use `.shepherd/lenses.yml`, but keep only one of the two files. For complete files to copy, see [team configuration examples](/shepherd/configuration/examples/).
:::

## Look up a field

Find the key in the first column. Each row gives its type, its default, and what it does:

| Field | Type and default | Effect |
| --- | --- | --- |
| `extends` | List of local paths or pinned GitHub pack references; absent | Load packs in the listed order before repository settings |
| `tiers` | Map of name to model ID | Name a model once; `ladder` and `models` may use the name, and swapping the model swaps it everywhere |
| `ladder` | Non-empty list of model IDs or tier names; harness default | Route work from the cheapest suitable model upward |
| `models` | Map of runner, lens or role group to model ID or tier | Pin work to a model. Role groups: `reviewers` (router and every lens), `fixers` (triage, simplify, ci-repair, incident), `validators` (verifier, validator). `loop` is the review model in CI, unless `review.model` names one. A runner or lens pin beats its group |
| `lenses` | Map of lens names; empty | Add reviewers alongside the built-in lenses |
| `lenses.<name>.skill` | Non-empty string; required once layers merge | Installed skill name, repository path or resolved pinned-pack lens; a layer may omit it to change a lens an earlier layer defined |
| `lenses.<name>.applies_to` | List of globs; absent | Match changed paths; without it the router chooses whether to run the lens |
| `lenses.<name>.description` | Non-empty string; skill description | Describe the lens for routing |
| `lenses.<name>.only` | Non-empty list of rule id globs; absent | Review only the matching rules |
| `lenses.<name>.disable` | Non-empty list of rule id globs; absent | Skip the matching rules |
| `lenses.<name>.gate` | `refuse`, `escalate`, or `note`; absent | Set the CI review's `on_break` for the lens's untagged rules (`escalate` when absent) |
| `checks` | Map of names to `{ command: string }`; empty | Set the machine checks; an empty map leaves command discovery to the skills |
| `fixes.mode` | `suggest`, `local`, or `push`; built-in `push` | Limit code changes, commits, pushes and resolutions |
| `escalate.paths` | Non-empty list of globs; absent | Reserve changes to matching files for a person |
| `escalate.reason` | Non-empty string; `team policy: a person changes <path>` | Explain why the agent deferred a change |
| `ci.notify_on` | List of `success`, `failure`, `pending`, `error`; all but `pending` | States `shepherd notify` sends from the local `/shepherd` loop |
| `ci.aws_region` | String; absent | Bedrock region for a `bedrock:` model. `AWS_REGION` overrides |
| `ci.label`, `ci.max_commits`, `ci.push_deny`, `ci.incident_paths`, `ci.audit` | Accepted for existing files | The review in CI does not act on them. |
| `review` | Map; absent | The review's policy: `model`, `deny`, `allow`, `rules`, `rules_from`, `size_gate`, `tiers`, `scrutiny`, `familiarity`, `pricing`, `provider`, `guard`, `label`, `notify`, `branding`, `reviewer_bots` and the rest. `shepherd gate config` validates it and prints every setting with its source. Without it, Shepherd reads an older `.shepherd/gate.yml`; `shepherd workflows --upgrade` moves that file here |
| `branding.name` | String up to 40 characters; `Shepherd` | The name in posted headers (`**<name> swarm**`), escaped |
| `branding.avatar` | `https` URL; absent | A 16px image after the header prefix. The comment's profile picture is still the posting account's ([branding](/shepherd/configuration/team-policy/#brand-posted-comments)) |
| `branding.emoji.<key>` | One token up to 16 characters, no spaces or markdown; today's glyphs | `critical`, `high`, `medium`, `low`, `nit`, `blocked`, `changes_needed`, `approve_with_nits`, `looks_good`, `resolved` |
| `recipes` | Map of names to `{ steps: [...] }`; built-in recipes | Compose supported stages in a named order |

Map keys for models, lenses, checks and recipes use lower-case names beginning with a letter, followed by letters, digits or hyphens.

Shepherd passes model IDs to your harness as written, so a Claude Code alias and an OpenCode `provider/model` ID aren't interchangeable. `opencode-agents` also accepts the reviewer's canonical `provider:model` IDs and writes them the OpenCode way, so `bedrock:<id>` becomes `amazon-bedrock/<id>`.

## Understand precedence and defaults

Settings apply in this order, each layer over the one before:

1. Built-in defaults.
2. Each pack in `extends`, in order.
3. The repository file.

These rules decide how the layers combine:

- **Scalar values**: a later layer replaces them.
- **Named maps**: `lenses`, `checks`, `models` and `recipes` merge by name.
- **Lenses**: a lens merges field by field, so a layer can set one field of a lens an earlier layer defined.
- **Nested packs**: a pack can extend packs, up to four deep, with no cycle.
- **Packs from another repository**: use a full 40-character commit SHA, and choose a commit on that repository's default branch.

The fix mode depends on how the policy started:

- **New repository**: `shepherd init` writes `fixes.mode: suggest`.
- **No policy**: the built-in mode is `push`.
- **Migrated legacy lenses file**: `init` keeps push mode.
- **Pack extended with `init --from`**: `init` keeps the pack's mode.

Inspect the effective mode before you run an agent.

Personal configuration in `~/.config/shepherd/lenses.yml` adds preview lenses and fills model choices the team hasn't set. It can't change checks, fix mode, escalation or recipes, and Shepherd never posts or fixes its findings.

## Check a recipe's steps

A recipe can use these steps: `swarm`, `triage`, `simplify`, `ci-repair`, `gate`, `incident`. The CLI rejects unknown steps, and it doesn't support arbitrary custom runners.

The built-in recipes run these steps, in the fix modes listed:

| Recipe | Steps | Mode |
| --- | --- | --- |
| `review` | swarm | Any |
| `fix` | swarm, triage, simplify, swarm | local or push |
| `pr` | swarm, triage, simplify, swarm, ci-repair, the gate | push |
| `incident` | incident, swarm, triage, simplify, swarm, ci-repair, the gate | push |

A custom recipe must follow these rules:

- **Order**: put incident first and the gate last, and run swarm before triage.
- **Final review**: review after the final fixing step.
- **Local mode**: the last review must cover working-tree fixes, so a remote gate review can't replace that swarm.
- **Suggest mode**: it can't run fixing steps.

## Inspect your configuration

To check a policy before you merge it, run:

```bash
shepherd config validate
shepherd config explain --working-tree
shepherd preview --working-tree --recipe review
```

`config validate` checks your working-tree policy. `explain` and `preview` use the trusted default-branch policy unless you pass `--working-tree`.

## Related resources

- [Team configuration examples](/shepherd/configuration/examples/): complete configurations to copy
- [Compose team policy and recipes](/shepherd/configuration/team-policy/): layer packs, compose recipes and brand comments
- [Build and share review lenses](/shepherd/configuration/lenses/): the `lenses` keys in practice
- [Choose models](/shepherd/configuration/models/): `tiers`, `ladder`, `models` and the review's pricing
