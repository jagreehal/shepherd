---
title: "Send PR state notifications"
---

Set the `SHEPHERD_NOTIFY_WEBHOOK` secret and the review in GitHub Actions posts each verdict to it, from shepherd's own process after the model returns. By default it posts refusals, escalations and errors. Set `notify.on` under `review:` in `.shepherd/config.yml` to pick the verdicts:

```yaml
review:
  notify:
    on: [REFUSED, ESCALATE, ERROR, APPROVED]
```

A Slack Incoming Webhook URL (one starting `https://hooks.slack.com/services/`) gets a Slack message with the PR link and the first line of the reason, escaped so PR text cannot mention or link. Any other URL gets JSON, for Discord, Teams, n8n, Zapier or an agent platform's trigger:

```json
{ "event": "gate.verdict", "repo": "acme/api", "pr": 7, "url": "https://github.com/acme/api/pull/7", "title": "…",
  "head_sha": "…", "verdict": "REFUSED", "held": false, "reason": "…" }
```

`held` is `true` when a deterministic check sent the PR to a person before any model review.

## From the local loop

Run from your coding agent, `/shepherd <pr>` passes its status to `shepherd notify` after Step 5, with the same webhook in your environment. That event is `shepherd.state`, with `state` and `description` in place of `verdict` and `reason`. `ci.notify_on` picks its states (`success`, `failure`, `pending`, `error`; all but `pending` by default). It posts once per change of state or description, keeping a record per PR under `.git/shepherd`, so a five-minute `/loop` does not repeat itself. `notify` never fails the loop: it prints `sent`, `unchanged`, `off` or `failed`.

Requests carry no signature. Treat the webhook URL as the secret, and do not let a receiver act on a payload without checking the PR on GitHub.

A generic JSON event is an integration contract. Use a relay when a service needs a provider-specific payload. Read [environment and credentials](/shepherd/reference/environment/) for the webhook.
