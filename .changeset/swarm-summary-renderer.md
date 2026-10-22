---
"@jagreehal/shepherd": minor
---

`shepherd summary <round.json>` renders swarm's summary comment from the round's JSON. You see the verdict heading, then collapsed sections for findings, still open threads, checks, lenses and earlier rounds. The renderer escapes markers, mentions and images in model text. Swarm finds the summary under the CI bot or the account that posts it and carries the round number forward, including in the handoff copy. Triage and swarm read stamp's collapsed review layout.
