---
title: "Develop Shepherd"
---

```bash
bun install
bun run check    # oxlint (with anti-slop), tsc, bun test
```

The tests check the skill pack itself: each skill's frontmatter, each relative path a skill points at, each JSON contract a runner returns, and the comment header triage relies on. They also exercise the installer against temporary directories, and run local capture, `finish` and receipts against the demo repository. Contributor rules live in [AGENTS.md](https://github.com/jagreehal/shepherd/blob/main/AGENTS.md). Whether reviews find the bugs is measured separately: see [measure review accuracy](/shepherd/contributing/evaluation/).

`src/replay.test.ts` renders real swarm rounds, kept in `fixtures/rounds/` with the files they reviewed. It checks that each round renders, that every inline comment lands inside its file with one comment per place, that the summary cites the same lines, and that each suggestion carries the indentation of the lines it replaces. To keep a round, put its `round.json` under `fixtures/rounds/<name>/rounds/` and the files it cites under `fixtures/rounds/<name>/files/` (see `fixtures/rounds/README.md`).
