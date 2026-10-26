---
"@jagreehal/shepherd": patch
---

`shepherd summary` and `shepherd inline` check the round's claims. Thread links (a finding's `url`, `reintroduces`, still-open entries) are kept only when they name a review comment on the PR, looked up with `gh` from `--pr` or `$PR`. A live round had linked an issue comment's id as a thread. A finding is shown as convergent only when its tag names two lenses. A HIGH or CRITICAL finding with no verification is marked "⚠️ unverified". No workflow change is needed: the publish job already sets `PR` and `GITHUB_REPOSITORY`.
