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
  loop: smart           # the session model in CI
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

## Model ids

Write ids the way your harness takes them (`haiku` on Claude Code, `provider/model` on OpenCode), or stamp's `provider:model`, so one set of tiers serves both tools. Shepherd writes stamp's spelling the OpenCode way (`bedrock:` becomes `amazon-bedrock/`, `vertex:` becomes `google-vertex/`), and `shepherd models` shows both.

Stamp reads the same tiers from the default branch: `STAMP_MODEL=smart` reviews on your `smart` model, so one list of named models drives both tools.

Shepherd runs models through its harness. In CI that harness is OpenCode, which reaches Bedrock (`amazon-bedrock/`), OpenAI (`openai/`), Anthropic, OpenRouter, Groq, DeepSeek, Mistral, Google, xAI and OpenCode Zen and Go by the model id alone. Stamp's `compatible:` provider (any OpenAI-compatible endpoint) is stamp's own: for shepherd, declare that endpoint as a custom provider in OpenCode's config.

## In GitHub Actions

The workflows run `shepherd ci-models`, which reads the tiers, ladder and pins from the default branch, gives OpenCode one agent per rung and per pin, and picks the session model:

1. `SHEPHERD_MODEL`, a model id or a tier name, when the variable is set.
2. `models.loop`.
3. The top of the ladder.
4. `opencode-go/kimi-k3`, and the log says so.

Set `SHEPHERD_API_KEY` to the key for the session model's provider; on Bedrock that is a Bedrock API key with `AWS_REGION` set. A ladder that mixes providers needs each provider's own secret as well: `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY` or `AWS_BEARER_TOKEN_BEDROCK`. A provider's own secret wins over `SHEPHERD_API_KEY`.

Shepherd's workflows take Bedrock through an API key, never OIDC: the model runs a shell, and a job that can mint an OIDC token can assume any AWS role that trusts the repository.
