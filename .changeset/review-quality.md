---
"@jagreehal/shepherd": minor
---

Swarm renders its inline review and its summary from one round JSON.

- `shepherd inline <round.json>` prints the inline review. Each comment carries the severity tag, a bold title, the input with the actual and expected result, a one-click `suggestion` when the fix replaces exactly its lines, `Verified:`, and a collapsed "Prompt for AI agents". It posts at most 10, most severe first, and anchors line ranges with `start_line`.
- `shepherd summary` adds a confidence score out of 5 and numbered findings, each titled and linked to its thread. One "Fix with an agent" prompt holds every finding above NIT. A walkthrough holds bullets, a per-file table, the review effort out of 5 and an optional mermaid diagram.
- `shepherd summary --fanout` (default `$SHEPHERD_FANOUT`) shows each first-wave lens the round never reported as `could_not_run`.
- A wrong result on an ordinary input in new code grades HIGH. A runtime claim with no input grades MEDIUM at most, and `checks/*` findings keep their grade.
- Rounds can carry pre-merge checks (title, description, linked issue, scope, tests), documentation links, the read-only commands that checked a finding, and `reintroduces`, a link to the resolved thread whose fix the change undoes.
