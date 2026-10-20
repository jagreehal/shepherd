---
title: "Compose team policy and recipes"
---

`.shepherd/config.yml` holds a team's policy: its lenses and models, plus the checks to run, how far fixes go, what a person must decide, and named recipes. An organisation keeps a pack, and each repository extends it and overrides what it needs.

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

Settings apply in one order: built-in defaults, then each pack in the order listed, then the repository file. A later layer replaces a setting, and merges `lenses`, `checks`, `models` and `recipes` by name. A lens merges field by field, so the repository can trim a pack's lens by name with `only` or `disable`. A pack can extend packs of its own, which apply before it, up to four deep; shepherd refuses a cycle, and a pinned pack's relative `extends` resolve in its repository at its commit. A pack from another repository must name a full commit, since a branch or tag can move under you. shepherd reads the file and its packs from the default branch, so a PR cannot change the policy it is reviewed under. Personal settings in `~/.config/shepherd/lenses.yml` stay a preview: their lenses print locally and never post, their ladder and pins fill in only where the team set none, and they cannot touch checks, fixes, escalation or recipes. A repository with only `.shepherd/lenses.yml` keeps working; it is read the same way.

A recipe composes shepherd's own steps: `swarm`, `triage`, `simplify`, `ci-repair`, `stamp`, `incident`. They run one at a time, and a recipe reports success only when a review ran after its last change. Validation rejects an order that cannot hold: triage before any swarm, stamp anywhere but last, a change nothing reviews afterwards, a fixing step under `fixes.mode: suggest`, or, under `local`, a fix only stamp reviews (stamp sees the pushed head, which local fixes never reach). The built-in `review`, `fix`, `pr` and `incident` recipes are listed by `config explain`; one the fix mode rules out shows as blocked in `preview`. Custom runners come later, once their contracts are defined.

```bash
bunx @jagreehal/shepherd init                     # review-only: shepherd posts findings and changes no code
bunx @jagreehal/shepherd init --preset local-fix  # fixes land in your working tree, never committed
bunx @jagreehal/shepherd init --preset push       # fixes are committed and pushed to the PR branch
bunx @jagreehal/shepherd init --from .shepherd/packs/acme.yml   # extend a pack and keep its fix mode
bunx @jagreehal/shepherd config validate          # your edits: exits 1 on a problem, so CI can run it
bunx @jagreehal/shepherd config explain           # effective policy on the default branch, and each setting's source
bunx @jagreehal/shepherd preview --recipe pr      # on your change: the full plan (see below)
```

Run `preview --working-tree` before you merge a policy change. It lists every reviewer, built-in and custom, with the model each one runs on and where that model came from; the checks; what each step can write, locally or to GitHub; anything escalated to a person; and how the recipe finishes. A finished `review` recipe means findings were posted, not that the PR is ready. Under `local-fix` the result is fixes left uncommitted. A PR is ready only when stamp approves its head, CI is green and no review thread is open. Running `init` in a repository that has only `.shepherd/lenses.yml` carries its settings over and keeps push mode.

A lens can travel with a pinned pack: a path in the pack (`skill: lenses/payments`) names a directory in the pack's repository at the pinned commit, and shepherd fetches it into a cache keyed by that commit. [Team examples](/shepherd/configuration/examples/) show the layout, and [environment and credentials](/shepherd/reference/environment/) covers reading a private pack in CI. `config validate` and `doctor` report a lens skill they cannot find.

New to shepherd? [Run your first review](/shepherd/start/quickstart/) walks through install, `doctor`, `init`, validate, preview, merging the policy and the first review.

`config explain --working-tree` and `preview --working-tree` read your uncommitted edits instead of the default branch. The skills load the policy with `config explain --json` (`skills/shepherd/references/policy.md`).
