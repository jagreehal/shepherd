---
"@jagreehal/shepherd": minor
---

In CI, swarm hands its round off as `round.json` and the publish job, which runs no model, posts it. Publish renders the inline review with `shepherd inline` and the summary with `shepherd summary`, including the fanout check, so a model can no longer post a hand-written review. Before this, a live run on PR 1 posted bare `HIGH: …` comments with no header, title or prompt, and left the old summary in place.

Publish also checks that the summary on the PR came from this run before skipping its own post. A summary an earlier round left on the same head used to pass for the current one, so the new round was never posted. A check that cannot start (`Startup Error`, `Cannot find module`) is reported as unavailable, not as passing.

**Workflow change:** regenerate `.github/workflows/shepherd.yml` with `shepherd workflows --upgrade`.
