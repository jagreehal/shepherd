---
title: "Team configuration examples"
description: "Copy a complete .shepherd/config.yml for review-only adoption, local fixes with an escalation boundary, or an organisation pack that each repository extends."
---

These are complete `.shepherd/config.yml` examples for common team setups. Choose a fix mode first, then add the checks and reviewers your repository needs. Replace the paths and commands with your own before you merge one. For what each key does, see the [configuration reference](/shepherd/reference/configuration/).

## Start with review only

Start here if you want findings before you let Shepherd change code:

```yaml validate-config
fixes:
  mode: suggest
checks:
  unit:
    command: bun test
  types:
    command: bun run typecheck
recipes:
  review:
    steps: [swarm]
```

**1. Check the policy**

Run `shepherd config validate` and `shepherd preview --working-tree --recipe review`. The preview lists review steps and no code edits. If your project uses another stack, replace the Bun checks first.

**2. Merge and run it**

Merge `.shepherd/config.yml`, then run `/shepherd 42` in your agent.

## Fix locally inside a team decision boundary

Use this setup to let Shepherd fix code in your working tree while a maintainer keeps schema and public API changes:

```yaml validate-config
fixes:
  mode: local
checks:
  unit:
    command: bun test
escalate:
  paths: ['migrations/**', 'src/public-api/**']
  reason: A maintainer decides schema and public API changes.
recipes:
  fix:
    steps: [swarm, triage, simplify, swarm]
```

Shepherd leaves its fixes in the working tree and reviews again after the last fix. Inspect and commit those changes yourself. Shepherd defers fixes that touch the escalation paths.

## Share an organisation pack

An organisation pack lets one policy repository set lenses and checks for many repositories.

**1. Commit the pack**

In your organisation's policy repository, commit a pack such as:

```yaml validate-config
fixes:
  mode: push
lenses:
  payments:
    skill: lenses/payments
    applies_to: ['src/payments/**']
checks:
  unit:
    command: bun test
```

Add `lenses/payments/SKILL.md` in that policy repository, using the [lens format](/shepherd/configuration/lenses/).

**2. Extend it from each repository**

In a consuming repository:

```yaml validate-config
extends:
  - github:acme/policy/shepherd.yml@0123456789abcdef0123456789abcdef01234567
fixes:
  mode: suggest
checks:
  unit:
    command: pnpm test
```

Replace the example SHA with a commit on the policy repository's default branch, and give `gh` access to that repository. The consumer keeps the payments lens, replaces the unit command and selects review-only mode.

Remote resolution needs the real pack and credentials. The docs checker validates syntax and recipe contracts without fetching placeholder repositories.

**3. Check each value's source**

Inspect `shepherd config explain --working-tree` to see where each value came from. Merge once the preview matches the permissions you intend.

### Bring in Shepherd's stack packs

The organisation pack can extend Shepherd's stack packs itself, so every consumer gets them with one line:

```yaml validate-config
extends:
  - github:jagreehal/shepherd/packs/node-api.yml@0123456789abcdef0123456789abcdef01234567
  - github:jagreehal/shepherd/packs/observability.yml@0123456789abcdef0123456789abcdef01234567
lenses:
  node-api:
    applies_to: ['services/**/*.ts']
```

[Compose reviews for your stack](/shepherd/configuration/stacks/) lists the catalogue.

## Related resources

- [Compose team policy and recipes](/shepherd/configuration/team-policy/): precedence between layers and private-pack access
- [Configuration reference](/shepherd/reference/configuration/): every key, its type and its default
- [Build and share review lenses](/shepherd/configuration/lenses/): the lens format a pack's lens follows
- [Compose reviews for your stack](/shepherd/configuration/stacks/): the bundled stack packs
