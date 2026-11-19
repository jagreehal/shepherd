---
title: "Review costs"
description: "Estimate and cap what Shepherd's reviews cost: how your provider bills them, what drives the cost of a review, the per-review budget, and where to read what each review spent."
---

Shepherd has no price of its own. Each review calls the model you chose, on your own key, so your model provider bills you for its tokens and GitHub bills the Actions minutes. Your spend depends on two things:

- **Cost of each review**: scales with the model's price, the size of the change, how much surrounding code the model reads, and whether a second model checks the verdict.
- **Number of reviews**: set by [how often reviews run](#how-often-reviews-run) on each pull request.

## Pricing

Your model provider bills each review's input and output tokens at its own rates, on the key you stored as an Actions secret. To bill reviews to a separate account or budget, give the review job its own key, for example in a GitHub environment with `--environment` (see [Set up the review](/shepherd/integrations/github-actions/#set-up-the-review)).

Shepherd prices each model call from the `pricing:` entry under `review:` in `.shepherd/config.yml`, and from nothing else. `shepherd init` and `shepherd workflows` write that entry for the model you choose, from the list price on [models.dev](https://models.dev). To use your region's or contract's rate, edit the entry. [Prices and the review's budget](/shepherd/configuration/models/#prices-and-the-reviews-budget) shows the format.

### How often reviews run

Each of these starts a review on a pull request:

- **Opening, reopening, or marking ready**: one review each time.
- **Each push**: one review per push, so the number of pushes multiplies the cost. A newer push cancels the review still running on the older head.
- **Retargeting the base branch**: one review.
- **A `/review` or `/gate` comment**: one fresh review, from someone who can push.

These cases add no review:

- **Drafts**: Shepherd skips them until you mark the pull request ready.
- **Pull requests without the trigger label**: with `review.label` set, Shepherd skips them until someone adds the label.
- **A push that leaves the diff unchanged**: after a clean merge of the base branch that touches none of the pull request's files, Shepherd keeps the standing approval and calls no model. See [When a push keeps the approval](/shepherd/guides/pull-requests/#when-a-push-keeps-the-approval).

To review fewer pushes, set `review.label` and add the label once a pull request is ready for review.

## Estimate your spend

Run a small pilot before a wide rollout, and estimate monthly spend from your own pull requests.

**1. Set a budget for the pilot**

Keep the default `guard.budget_usd` of $2 per review, or set your own under `review:` in `.shepherd/config.yml`. See [Limit your spend](#limit-your-spend).

**2. Turn on reviews for a few representative repositories**

Follow [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/) in each one.

**3. Read the cost of each review**

After several reviews have run, open each `shepherd` run's summary page in the **Actions** tab. Its last lines give each model run's model, tool calls, cost in dollars and duration, for the reviewer and any second opinion. The `gate-evidence-<pr>` artifact carries the same figures as JSON.

**4. Multiply**

Multiply the average cost of a review by the number of pull requests the repository opens in a month, then by the typical number of pushes per pull request.

## Limit your spend

Shepherd stops a review once it passes any limit in `guard` under `review:`. The defaults are:

| Limit | Default | What it caps |
| --- | --- | --- |
| `budget_usd` | `2` | Dollars spent on one review, priced from `pricing:` |
| `tokens` | `3m` | Tokens used by one review |
| `max_tools` | `80` | Tool calls the model makes in one review |
| `timeout` | `15m` | Time one review runs |

A review that hits a limit doesn't finish: Shepherd sets the `shepherd` status to `error`, and someone comments `/review` to run it again. GitHub also stops the job after 20 minutes.

If a model has no `pricing:` entry, the dollar budget can't apply. The review runs under the token ceiling alone, and the run's log says `budget guard inactive`.

## View usage

To see what reviews cost across repositories and over time, use `shepherd garden`. It scores recent runs and can read their traces, with `--trace-cost-usd` setting the cost above which it flags a review. See [Improve reviews with garden](/shepherd/operations/gardening/) and [Garden trace scoring](/shepherd/operations/gardener-telemetry/).

For invoice-accurate spend, use your model provider's billing console. Shepherd's figures come from the `pricing:` entries, so they're only as accurate as those rates.

## Related resources

- [Choose models](/shepherd/configuration/models/): tiers, a cost ladder, and the `pricing:` format
- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): the model key and the GitHub environment
- [Read and respond to a review](/shepherd/guides/pull-requests/): the comment commands that start a review
- [Troubleshoot a review or repair](/shepherd/operations/troubleshooting/): a review that stopped at a limit
