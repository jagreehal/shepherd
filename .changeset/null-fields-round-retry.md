---
"@jagreehal/shepherd": patch
---

A field written as `null` in `round.json` reads as absent and takes its default, so a round with `"suggestion": null` renders and posts.

The iterate job checks `round.json` after the model finishes. If the round does not render, the job makes one short follow-up call with the exact errors. Run `shepherd workflows --upgrade` to pick up the new workflow.
