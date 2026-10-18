---
title: "Send PR state notifications"
---

Set `SHEPHERD_NOTIFY_WEBHOOK` where shepherd runs and each iteration passes its status to `shepherd notify`. In CI, add it as a secret: the `publish` job runs `notify` after it sets the status, outside the model's job. Locally, the skill runs it after Step 5.

By default it posts when the PR needs you (`failure`), is ready to merge (`success`), or the CI iteration stopped on an error (`error`). A Slack Incoming Webhook URL (one starting `https://hooks.slack.com/services/`) gets a Slack message with the PR link and the status line, escaped so PR text cannot mention or link. Any other URL gets JSON, for Discord, Teams, n8n, Zapier or an agent platform's trigger:

```json
{ "event": "shepherd.state", "repo": "acme/api", "pr": 7, "url": "https://github.com/acme/api/pull/7",
  "head_sha": "…", "state": "failure", "description": "stamp refused: retry loop never ends" }
```

`SHEPHERD_NOTIFY_ON` picks the states, comma-separated; add `pending` to follow every step. Unknown names are ignored, and a value with no known state falls back to `success,failure,error`.

It posts once per change of state or description, so a five-minute `/loop` does not repeat itself. Locally it keeps a record per PR under `.git/shepherd`. In CI, where each run starts fresh, it keeps the record as a `shepherd/notify` commit status on the head, separate from the `shepherd` status, so a status that was set but never delivered is still sent. It remembers states it does not post, so `failure`, then `pending`, then `failure` tells people twice. A failed post is not remembered, so the next iteration retries it, on this runner or a fresh one. `notify` never fails an iteration: it prints `sent`, `unchanged`, `off` or `failed`.

Requests carry no signature. Treat the webhook URL as the secret, and do not let a receiver act on a payload without checking the PR on GitHub.

People answer on the PR, and the next iteration's triage reads what they wrote. stamp posts its own verdicts the same way (`STAMP_NOTIFY_WEBHOOK`); point both at one channel to follow a PR end to end.

A generic JSON event is an integration contract. Use a relay when a service needs a provider-specific payload. Read [environment and credentials](/shepherd/reference/environment/) for the webhook and state settings.
