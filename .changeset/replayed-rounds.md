---
"@jagreehal/shepherd": minor
---

Inline reviews and summaries now agree line for line, and every suggestion commits cleanly.

- `shepherd summary` and `shepherd inline` place each suggestion once, on the lines it rewrites, at their indentation in spaces or tabs, keeping each line's relative indentation. A suggestion cited past the end of its file is placed by one clear match across the file.
- Each place gets one inline comment, the most severe finding's, with the other findings on those lines named under it.
- `evidence` written as one line (`Input: …, Expected: …, Actual: …`) is read as its three parts.
- When nothing was pushed and no CI job was rerun, a model's `pending` becomes `failure` if the round leaves findings above NIT for the author.
- A replay test renders real CI rounds the way the publish job does (`fixtures/rounds/`, `src/replay.test.ts`).

Upgrade the workflow with `shepherd workflows --upgrade`.
