---
title: "Team configuration examples"
---

Choose a mode first, then add the checks and reviewers your repository needs. These are complete configuration examples; replace paths and commands before you merge them.

## Review-only adoption

Start here if you want findings before you permit code changes.

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

Run `shepherd config validate` and `shepherd preview --working-tree --recipe review`. Expect review steps and no code edits. Merge `.shepherd/config.yml`, then run `/shepherd 42` in your agent. Replace the Bun checks if your project uses another stack.

## Local fixes with a team decision boundary

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

Expect fixes in the working tree and a review after the last fix. Inspect and commit those changes yourself. Shepherd defers fixes touching the escalation paths.

## Share an organisation pack

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

Add `lenses/payments/SKILL.md` in that policy repository, using the [lens format](/shepherd/configuration/lenses/). In a consuming repository:

```yaml validate-config
extends:
  - github:acme/policy/shepherd.yml@0123456789abcdef0123456789abcdef01234567
fixes:
  mode: suggest
checks:
  unit:
    command: pnpm test
```

Replace the example SHA with a commit on the policy repository's default branch. Give `gh` access to that repository. The consumer keeps the payments lens, replaces the unit command and selects review-only mode. Remote resolution requires the real pack and credentials; the docs checker validates syntax and recipe contracts without fetching placeholder repositories.

The organisation pack can extend shepherd's stack packs itself, so every consumer gets them with one line:

```yaml validate-config
extends:
  - github:jagreehal/shepherd/packs/node-api.yml@0123456789abcdef0123456789abcdef01234567
  - github:jagreehal/shepherd/packs/observability.yml@0123456789abcdef0123456789abcdef01234567
lenses:
  node-api:
    applies_to: ['services/**/*.ts']
```

[Compose reviews for your stack](/shepherd/configuration/stacks/) lists the catalogue.

Inspect `shepherd config explain --working-tree` to see each value's source. Merge after the preview matches your intended permissions. Read [team policy](/shepherd/configuration/team-policy/) for precedence and private-pack access.
