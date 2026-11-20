---
title: "Compose team policy and recipes"
description: "Write a team's review policy in .shepherd/config.yml, layer it over organisation packs, compose recipes, preview a policy change, and brand posted comments."
---

`.shepherd/config.yml` holds a team's policy: its lenses and models, plus the checks to run, how far fixes go, what a person must decide, and named recipes. An organisation keeps a pack, and each repository extends it and overrides what it needs. Shepherd reads the file and its packs from the default branch, so a pull request can't change the policy it's reviewed under.

:::note
New to Shepherd? [Run your first review](/shepherd/start/quickstart/) walks through install, `doctor`, `init`, validate, preview, merging the policy and the first review. For every key and its default, see the [configuration reference](/shepherd/reference/configuration/).
:::

## Create and check the policy file

To start a policy, run `init` with the fix mode you want, then validate your edits and preview the plan:

```bash
bunx @jagreehal/shepherd init                     # review-only: shepherd posts findings and changes no code
bunx @jagreehal/shepherd init --preset local-fix  # fixes land in your working tree, never committed
bunx @jagreehal/shepherd init --preset push       # fixes are committed and pushed to the PR branch
bunx @jagreehal/shepherd init --from .shepherd/packs/acme.yml   # extend a pack and keep its fix mode
bunx @jagreehal/shepherd config validate          # your edits: exits 1 on a problem, so CI can run it
bunx @jagreehal/shepherd config explain           # effective policy on the default branch, and each setting's source
bunx @jagreehal/shepherd preview --recipe pr      # on your change: the full plan (see below)
```

Running `init` in a repository that has only `.shepherd/lenses.yml` carries its settings over and starts review-only. It prints the `--preset push` command if you want to keep pushing.

`config explain --working-tree` and `preview --working-tree` read your uncommitted edits instead of the default branch. The skills load the policy with `config explain --json` (`skills/shepherd/references/policy.md`).

## Get autocomplete in your editor

`shepherd init` starts the file with a `# yaml-language-server: $schema=…` line pointing at the JSON Schema for the version that wrote it. Editors with a YAML language server (VS Code's YAML extension, JetBrains IDEs) then autocomplete keys and flag a wrong one as you type. In a file you wrote by hand, add the line yourself, with your Shepherd version:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@jagreehal/shepherd@<version>/schema/config.json
```

`shepherd config schema` prints the same schema locally. Keep `shepherd config validate` as the check: it also resolves lenses and packs.

## Write the policy

This example sets each part of a policy. Each comment says what the setting does:

```yaml
# .shepherd/config.yml
extends:
  - .shepherd/packs/acme.yml                                  # in this repository
  - github:acme/policy/shepherd.yml@0123456789abcdef0123456789abcdef01234567   # another, pinned to a commit

lenses:
  payments:
    skill: .shepherd/lenses/payments
    applies_to: ["src/payments/**"]

checks:                     # swarm runs exactly these; ci-repair and incident use them too
  unit: { command: bun test }
  types: { command: bun run typecheck }

fixes:
  mode: local               # suggest: change nothing | local: fix, never commit | push (default)

escalate:
  paths: ["migrations/**", "src/public-api/**"]
  reason: a person decides schema and public API changes

recipes:                    # /shepherd 42 --recipe quick
  quick: { steps: [swarm, triage, swarm] }
```

## Layer packs under the repository

Settings apply in one order: built-in defaults, then each pack in the order listed, then the repository file. A later layer replaces a setting. These rules decide how the layers combine:

- **Named maps**: `lenses`, `checks`, `models` and `recipes` merge by name, entry by entry.
- **Lenses**: a lens merges field by field, so the repository can trim a pack's lens by name with `only` or `disable`.
- **Nested packs**: a pack can extend packs of its own, which apply before it, up to four deep. Shepherd refuses a cycle.
- **Packs from another repository**: a pack must name a full commit, since a branch or tag can move under you. A pinned pack's relative `extends` resolve in its repository at its commit.
- **Personal settings**: `~/.config/shepherd/lenses.yml` stays a preview. Its lenses print locally and never post, its ladder and pins fill in only where the team set none, and it can't touch checks, fixes, escalation or recipes.
- **Older repositories**: a repository with only `.shepherd/lenses.yml` keeps working. Shepherd reads it the same way.

## Share a lens through a pinned pack

A lens can travel with a pinned pack. A path in the pack (`skill: lenses/payments`) names a directory in the pack's repository at the pinned commit, and Shepherd fetches it into a cache keyed by that commit. `config validate` and `doctor` report a lens skill they can't find.

[Team examples](/shepherd/configuration/examples/) show the layout, and [environment and credentials](/shepherd/reference/environment/) covers reading a private pack in CI.

## Compose recipes

A recipe composes Shepherd's own steps: `swarm`, `triage`, `simplify`, `ci-repair`, `gate`, `incident`. They run one at a time, and a recipe reports success only when a review ran after its last change.

Validation rejects an order that can't hold:

- **Triage first**: triage before any swarm.
- **Gate not last**: the gate anywhere but last.
- **Unreviewed change**: a change nothing reviews afterwards.
- **Fixing under suggest**: a fixing step under `fixes.mode: suggest`.
- **Gate-only review under local**: under `local`, a fix only the gate reviews. The gate sees the pushed head, which local fixes never reach.

`config explain` lists the built-in `review`, `fix`, `pr` and `incident` recipes. One the fix mode rules out shows as blocked in `preview`. Custom runners come later, once their contracts are defined.

## Preview a policy change before you merge it

Run `preview --working-tree` before you merge a policy change. It lists:

- **Reviewers**: every reviewer, built-in and custom, with the model each one runs on and where that model came from.
- **Checks**: the checks the recipe runs.
- **Writes**: what each step can write, locally or to GitHub.
- **Escalations**: anything escalated to a person.
- **Finish**: how the recipe finishes.

A finished `review` recipe means Shepherd posted its findings. The pull request may still need work. Under `local-fix` the result is fixes left uncommitted. A pull request is ready only when the review in CI approves its head and no thread a person wrote in is open: the `shepherd` status is `success`.

## Brand posted comments

`branding` changes how Shepherd's comments look. Leave it out and Shepherd posts them as before.

```yaml
branding:
  name: Acme Review              # "**Acme Review swarm**" in the header; default Shepherd
  avatar: https://example.com/logo.png   # optional 16px image after the header prefix; https only
  emoji:                         # any of these; the rest keep their defaults
    critical: 🔴
    high: 🟠
    medium: 🟡
    low: 🟢
    nit: ⚪
    blocked: 🚫
    changes_needed: ⚠️
    approve_with_nits: 💬
    looks_good: ✅
    resolved: ✅
```

These limits apply to branding:

- **Glyphs**: a glyph is one short token, at most 16 characters, with no spaces or markdown. Garden reads a finding's severity from `**[tag]** <glyph> HIGH`.
- **Source**: `shepherd branding` prints the resolved values as JSON, escaped, from the default branch, so a pull request can't restyle its own review. The skills post with it.
- **Automated marker**: branding never changes what marks a comment as automated. The shepherd icon and `Automated comment by` prefix stay, because triage, garden and the review tell automated comments from people's by it, and the hidden `<!-- shepherd… -->` markers stay as they are.
- **Profile picture**: the posting account supplies the picture, and `avatar` leaves it alone. A comment shows the picture of whoever posted it: `github-actions[bot]` for the review in CI, or your own account when the skills run locally. `avatar` only adds an image inside the comment. To change the picture itself, post as a bot account whose profile picture is your logo, or as a GitHub App (a token from an app installation posts as `<app>[bot]` with the app's logo).

## Related resources

- [Configuration reference](/shepherd/reference/configuration/): every key, its type and its default
- [Team configuration examples](/shepherd/configuration/examples/): complete policies to copy, including an organisation pack
- [Build and share review lenses](/shepherd/configuration/lenses/): write the lenses a policy names
- [Choose models](/shepherd/configuration/models/): tiers, the ladder and role pins
- [Environment and credentials](/shepherd/reference/environment/): read a private pack in CI
