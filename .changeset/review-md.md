---
"@jagreehal/shepherd": minor
---

Shepherd reads `REVIEW.md` the way Claude Code Review reads it, so one file steers both. Its rules post as line comments, and the root file can include files beside it and skills from `.claude/skills/` or `.agents/skills/` with `@` lines. Its skip paths, caps and severities shape notes and standards, within Code Review's size and link limits, and the review lists any rule a limit left out. A PR that only adds a skip or a cap to `REVIEW.md` escalates to a person. To keep line comments, rename `CODING_STANDARDS.md` to `REVIEW.md`. To escalate those edits in an existing setup, copy `scrutiny.review_agents.instruction` from the default policy.
