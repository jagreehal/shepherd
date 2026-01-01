---
"@jagreehal/shepherd": minor
---

Teams can write their own review lenses and have shepherd fix what they find.

- `shepherd lens new <name> --applies '<glob>'` scaffolds `.shepherd/lenses/<name>/SKILL.md` with `## Review` rules and an optional `## Fix` section (Prefer, Never touch, Escalate), and registers it.
- `shepherd lens add` and `shepherd lens list` validate each lens: a description, a `## Review` section, unique rule ids. `lens list` exits non-zero on a problem, so CI can run it.
- Triage fixes a lens's findings by its `## Fix` guidance, defers anything under Escalate, and adds a `Shepherd-Lens: <name>` trailer. A lens can make shepherd stricter, never looser.
- `/swarm --preview` runs lenses from your working tree, reports which files each one matched, and posts nothing.
- Personal lenses (`--global`) print locally and never post.
- Fixers follow `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and `docs/adr/` from the default branch.
- A thread left for the author fences its code, so fixes stay clear of the decisions it holds.
- Each lens reports `ok`, `failed`, or `could_not_run`, with the blob of the `SKILL.md` it ran.
- The router receives PR text inside a fence and leaves a matched custom lens its concern.
