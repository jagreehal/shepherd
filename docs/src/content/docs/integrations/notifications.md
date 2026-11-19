---
title: "Send pull request state notifications"
description: "Post review verdicts to Slack or any JSON endpoint, pick which verdicts and states notify, and send state changes from the local loop."
---

Shepherd can post each review verdict to a webhook, such as a Slack channel or an automation platform. To turn it on, set the `SHEPHERD_NOTIFY_WEBHOOK` secret. Shepherd's own process sends each notification after the model returns.

## Send verdicts from the review in GitHub Actions

**1. Set the webhook secret**

Add `SHEPHERD_NOTIFY_WEBHOOK` as a repository secret. See [Environment and credentials](/shepherd/reference/environment/) for the other secrets the review reads.

**2. Pick the verdicts**

By default, Shepherd posts refusals, escalations and errors. To pick the verdicts, set `notify.on` under `review:` in `.shepherd/config.yml`:

```yaml
review:
  notify:
    on: [REFUSED, ESCALATE, ERROR, APPROVED]
```

**3. Check the next review**

After the next review with a verdict you picked, a message arrives at the webhook.

## What the webhook receives

Shepherd picks the format from the webhook URL:

- **Slack Incoming Webhook**: a URL starting `https://hooks.slack.com/services/` gets a Slack message with the pull request link and the first line of the reason. Shepherd escapes the text, so pull request text can't mention anyone or add a link.
- **Any other URL**: gets JSON, for Discord, Teams, n8n, Zapier or an agent platform's trigger.

The JSON event looks like this:

```json
{ "event": "gate.verdict", "repo": "acme/api", "pr": 7, "url": "https://github.com/acme/api/pull/7", "title": "…",
  "head_sha": "…", "verdict": "REFUSED", "held": false, "reason": "…" }
```

`held` is `true` if a deterministic check sent the pull request to a person before any model review.

A generic JSON event is an integration contract. If a service needs a provider-specific payload, put a relay in front of it.

## Send states from the local loop

Run from your coding agent, `/shepherd <pr>` passes its status to `shepherd notify` after Step 5. It uses the same webhook, read from your environment.

The local loop sends a different event:

- **Event**: `shepherd.state`, with `state` and `description` in place of `verdict` and `reason`.
- **States**: `ci.notify_on` picks them from `success`, `failure`, `pending` and `error`. By default it sends all but `pending`.
- **Repeats**: Shepherd posts once per change of state or description, and keeps a record per pull request under `.git/shepherd`. A five-minute `/loop` doesn't repeat itself.
- **Failures**: `notify` never fails the loop. It prints `sent`, `unchanged`, `off` or `failed`.

## Secure the webhook

Shepherd signs no requests. Treat the webhook URL as the secret. Before a receiver acts on a payload, have it check the pull request on GitHub.

## Related resources

- [Environment and credentials](/shepherd/reference/environment/): where `SHEPHERD_NOTIFY_WEBHOOK` sits among the review's secrets
- [Configuration reference](/shepherd/reference/configuration/): `review.notify` and `ci.notify_on`
- [Command reference](/shepherd/reference/commands/): the `shepherd notify` flags
- [Understand results and commit status](/shepherd/guides/results/): what each verdict and state means
