---
"@jagreehal/shepherd": minor
---

Under `fixes.mode: suggest` with no team lenses, the CI loop reviews with the gate's engine through the new `shepherd ci-review`: read, grep and glob over the checkout, no shell, and no OpenCode install. The round follows the gate's final verdict and sets the `shepherd` status: failure for the author on a refusal or escalation, success once the gate's posted approval covers the head, its checks pass and no thread is open. An iteration that ends with no review, status or commit sets the status to error.

`shepherd workflows` fills the incident workflow's `branches:` filter with the default branch, so CI on PR branches starts no incident run. `--upgrade` keeps the filter your team set.
