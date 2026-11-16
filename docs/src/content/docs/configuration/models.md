---
title: "Choose models"
---

Give cheap work a cheap model and hard work a strong one. Name each model once as a tier, then point roles at the names. Switching provider changes only the tiers.

```yaml validate-config
# .shepherd/config.yml
tiers:                  # a name for a model, defined once
  fast: opencode/deepseek-v4.1-flash-free
  smart: bedrock:eu.anthropic.claude-sonnet-4-6
ladder: [fast, smart]   # cheapest first: every runner without a pin takes its rung
models:
  reviewers: fast       # the router and every lens, built-in and custom
  fixers: smart         # triage, simplify, ci-repair, incident
  validators: smart     # the verifier and the validator
  security: smart       # one runner or lens beats its group
  loop: smart           # the review model in CI
```

Or from the command line:

```bash
shepherd models tier fast opencode/deepseek-v4.1-flash-free
shepherd models tier smart bedrock:eu.anthropic.claude-sonnet-4-6
shepherd models ladder fast smart
shepherd models pin reviewers fast
shepherd models pin fixers smart
shepherd models                       # every tier, the ladder and each runner's model
```

## How a runner gets its model

1. A pin on that runner or lens (`security: smart`).
2. A pin on its role group (`reviewers: fast`).
3. Its rung of the ladder: the router on the bottom rung, lenses and fixers one up, the validator two up.
4. With no ladder, the harness's own: `haiku` > `sonnet` > `opus` on Claude Code, the session model on OpenCode.

`shepherd preview` lists the model each runner will use on your change, and where that choice came from.

## Compose and share

Tiers, the ladder and pins layer like every other setting. An organisation pack can define the tiers and the role pins once; each repository extends it and overrides a single name:

```yaml validate-config
# github:acme/review-packs/org.yml
tiers:
  fast: opencode/deepseek-v4.1-flash-free
  smart: bedrock:eu.anthropic.claude-sonnet-4-6
models:
  reviewers: fast
  fixers: smart
```

```yaml
# .shepherd/config.yml in one repository
extends: ['github:acme/review-packs/org.yml@<sha>']
models:
  payments: smart       # this repository's payments lens on the strong model
```

Your personal file (`~/.config/shepherd/lenses.yml`, `--global`) fills only names the team left open.

## Choose models from measurements

Pick a ladder from eval scores. [`shepherd eval`](/shepherd/contributing/evaluation/) runs each configuration several times over the same cases and names the cheapest one whose held-out recall and precision sit within noise of the best. Measure before you move a role down a rung.

## Model ids

Write ids the way your harness takes them (`haiku` on Claude Code, `provider/model` on OpenCode), or the reviewer's `provider:model`. Shepherd writes the reviewer's spelling the OpenCode way (`bedrock:` becomes `amazon-bedrock/`, `vertex:` becomes `google-vertex/`), and `shepherd models` shows both.

## In GitHub Actions

The review in CI runs one model. It takes the first of:

1. `SHEPHERD_MODEL`, when the repository variable is set: an override for trying a model without a PR. A tier name works.
2. `model:` under `review:` in `.shepherd/config.yml`.
3. `models.loop` in `.shepherd/config.yml`.
4. The built-in default.

Name it in `.shepherd/config.yml`, where a change to it is reviewed like any other policy change:

```bash
shepherd models pin loop bedrock:minimax.minimax-m2.5   # or: shepherd workflows --model ..., shepherd init --model ...
```

Add the provider's key as a secret under its usual name. [Environment and credentials](/shepherd/reference/environment/) lists them. Bedrock can use OIDC instead of a key: `shepherd gate init --aws-oidc` and the `AWS_ROLE_ARN` variable.

## Prices and the review's budget

The review stops when it passes its dollar budget (`guard.budget_usd` under `review:`, $2 by default). It prices each model call from `pricing:` under `review:`, and from nothing else:

```yaml
review:
  pricing:
    openai.gpt-oss-120b-1:0: { inputPer1M: 0.18, outputPer1M: 0.70, as_of: 2026-11-14, source: aws bedrock eu-west-1 }
```

`shepherd init` and `shepherd workflows` write this entry for the model you choose when they first add `review:`, from the list price on [models.dev](https://models.dev), with today's date. Change it to your region's or contract's rate. Bedrock prices differ by region: models.dev lists the us-east-1 rate.

A model without a price runs with only the token ceiling, and the review log says `budget guard inactive`. A key matches the model id exactly, by prefix, or after a vendor or region prefix: `openai.gpt-oss-120b` prices `eu.openai.gpt-oss-120b-1:0`, and `kimi-k3` prices `openrouter:moonshotai/kimi-k3`.
