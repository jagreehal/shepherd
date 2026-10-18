---
"@jagreehal/shepherd": minor
---

- `shepherd workflows` installs the PR loop and incident workflows for GitHub Actions, pinned to your version.
- The PR loop gives the model a token that reads and comments. A job with no model checks its commits, pushes them to the PR branch as a fast-forward, and refuses changes to protected paths.
- Handoff mode lets an iteration commit and leave the push to that job.
- `shepherd notify` tells Slack or any JSON endpoint when a PR needs you, is ready to merge, or the CI iteration stopped. It sends once per change.
- A documentation site covers setup, configuration, CI and operations.
