---
title: "Develop Shepherd"
description: "Install Shepherd's dependencies, run its checks and tests, and keep a real swarm round as a replay fixture."
---

Shepherd is a Bun package: the CLI, the skill pack, and the tests that hold them together. This page is for contributors changing Shepherd itself. Read the contributor rules in [AGENTS.md](https://github.com/jagreehal/shepherd/blob/main/AGENTS.md) before you change a skill.

## Run the checks

From the repository root, install dependencies and run every check:

```bash
bun install
bun run check    # oxlint (with anti-slop), tsc, bun test
```

`bun run check` runs Oxlint with the vendored anti-slop rules, `tsc`, and `bun test`. Run it before every commit.

## Understand the test suite

The tests check the skill pack itself:

- **Skills**: each skill's frontmatter, and each relative path a skill points at.
- **Contracts**: each JSON contract a runner returns.
- **Comment header**: the header triage relies on.
- **Installer**: runs against temporary directories.
- **Local review**: local capture, `finish` and receipts run against the demo repository.

The tests don't measure whether reviews find the bugs. To measure that, see [Measure review accuracy](/shepherd/contributing/evaluation/).

## Keep a swarm round as a fixture

`src/replay.test.ts` renders real swarm rounds, kept in `fixtures/rounds/` with the files they reviewed. For each round, it checks that:

- **Rendering**: the round renders.
- **Inline comments**: every inline comment lands inside its file, with one comment per place.
- **Summary**: the summary cites the same lines.
- **Suggestions**: each suggestion carries the indentation of the lines it replaces.

To keep a round, follow these steps.

**1. Add the round**

Put its `round.json` under `fixtures/rounds/<name>/rounds/`.

**2. Add the files it cites**

Put the files the round cites under `fixtures/rounds/<name>/files/`. See [`fixtures/rounds/README.md`](https://github.com/jagreehal/shepherd/blob/main/fixtures/rounds/README.md) for the layout.

**3. Run the replay test**

```bash
bun test src/replay.test.ts
```

## Related resources

- [AGENTS.md](https://github.com/jagreehal/shepherd/blob/main/AGENTS.md): the rules for agents and contributors changing this repository
- [Measure review accuracy](/shepherd/contributing/evaluation/): score whether reviews find the bugs
- [Maintain the documentation](/shepherd/contributing/docs/): run and change this site
