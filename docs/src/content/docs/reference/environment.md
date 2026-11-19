---
title: "Environment and credentials"
description: "Look up the model key, secrets and variables the review in GitHub Actions reads, plus the variables for traces and garden."
---

Look up the secrets and variables the review in GitHub Actions reads, and the ones traces and garden read. Your local coding agent uses its own provider authentication. Settings other than credentials live in `.shepherd/config.yml`.

## Choose the model and its key

The review runs one model, written `provider/model`: `anthropic/claude-opus-5`, `openai/gpt-5.5`, `opencode-go/deepseek-v4.1-flash`, `openrouter/moonshotai/kimi-k3`, `amazon-bedrock/eu.amazon.nova-pro-v1:0` (`bedrock/` works too). `shepherd workflows --model <id>` pins it as `models.loop` in `.shepherd/config.yml`. `model:` under `review:` takes precedence over `models.loop`, and the `SHEPHERD_MODEL` variable over both.

Each provider reads its key from its usual variable. Find your model's prefix in the first column, and set the key it names as a secret:

| Provider prefix | Key |
| --- | --- |
| `anthropic/` | `ANTHROPIC_API_KEY` |
| `openai/` | `OPENAI_API_KEY` |
| `opencode/`, `opencode-go/` | `OPENCODE_API_KEY` |
| `openrouter/` | `OPENROUTER_API_KEY` |
| `deepseek/`, `groq/`, `mistral/` | `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY` |
| `amazon-bedrock/` (or `bedrock/`) | `AWS_BEARER_TOKEN_BEDROCK`, plus `AWS_REGION`; or OIDC with `AWS_ROLE_ARN` |
| `openai-compatible/` | `OPENAI_COMPATIBLE_API_KEY`, plus `OPENAI_COMPATIBLE_BASE_URL` |
| `gateway/` | `AI_GATEWAY_API_KEY` |

## Where other settings live

Every other setting lives in `.shepherd/config.yml` on the default branch, never in a variable. The review's settings sit under `review:`, and the local skills' sit at the top level. `shepherd gate config` prints each review setting with its source, and `shepherd config explain` prints the rest.

## Secrets and variables for the review

The workflow passes these to the review step. The job's own `github.token` is the only GitHub credential. Look up each name in the first column:

| Name | Kind | Purpose |
| --- | --- | --- |
| Provider key | Secret | See the table above. Store it in the environment `shepherd workflows --environment <name>` names, so only the review job reads it |
| `SHEPHERD_MODEL` | Variable | Optional `provider/model` or tier name, over the config file |
| `SHEPHERD_VERSION` | Variable | Optional CLI version, over the pin in the workflow |
| `AWS_REGION` | Variable | The Bedrock region |
| `AWS_ROLE_ARN` | Variable | Bedrock through OIDC instead of a key (`shepherd gate init --aws-oidc`) |
| `SHEPHERD_NOTIFY_WEBHOOK` | Secret | Slack Incoming Webhook or any JSON endpoint for review verdicts |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret | Runs the review through the Claude Code CLI on a Claude plan (`backends: [claude]` under `review:`) |
| `CODEX_API_KEY` | Secret | Runs the review through the Codex CLI (`backends: [codex]`) |
| `TYPESAFE_API_KEY` | Secret | Adds advisory risk probabilities to the review's evidence; never changes a verdict |
| `ANTHROPIC_BASE_URL` | Variable | Sends Anthropic calls through a proxy |
| `GH_TOKEN` | Step environment | The job's `github.token`, used by `gh` |

### Pin the CLI version

`shepherd workflows` pins `SHEPHERD_VERSION` in the workflow to the version that wrote it, as `${{ vars.SHEPHERD_VERSION || '<version>' }}`. A `SHEPHERD_VERSION` repository variable overrides the pin, so a bump needs no workflow edit. Only people who can change repository settings can set it.

### Read private organisation packs

Private organisation packs need a read identity with access to the policy repository. The supplied job uses a repository-scoped token, so multi-repository pack access needs a separately reviewed read-only credential.

## Variables for traces

Set these to export traces. Look up each name in the first column:

| Name | Purpose |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint; without it, a flush clears the record without exporting |
| `OTEL_EXPORTER_OTLP_HEADERS` | Secret collector headers, when your collector needs authentication |
| `OTEL_SERVICE_NAME` | Trace service name; default `shepherd` |
| `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_SERVER_URL` | Runner-supplied run context and pull request URLs |

The CLI reports stage timings, and the harness reports model usage. See [Trace an iteration](/shepherd/operations/traces/).

## Garden inputs and credentials

The weekly garden workflow reads these. Look up each name in the first column:

| Name | Kind | Purpose |
| --- | --- | --- |
| `GARDEN_REPOS` | Variable | Space-separated repositories to score in the weekly workflow |
| `GARDEN_MODEL` | Variable | Model used to propose garden changes |
| `GARDEN_TOKEN` | Secret | Publish proposed pull requests; contents and pull requests write access on the target repositories |
| `GARDEN_READ_TOKEN` | Secret, optional | Read private repositories during scoring and proposal |
| `GARDEN_TRACE_FILES` | Environment | JSON array of exported OTLP file paths for scheduled collection |
| `GARDEN_TEMPO_URL` | Variable/environment | Tempo query endpoint |
| `GARDEN_TEMPO_HEADERS` | Secret | JSON object of headers for that Tempo endpoint |
| `GARDEN_DATADOG_SITE` | Variable/environment | Datadog site |
| `GARDEN_DATADOG_API_KEY` | Secret | Datadog API credential |
| `GARDEN_DATADOG_APP_KEY` | Secret | Read-only Datadog application credential with `apm_read` |

The weekly workflow separates proposing changes from publishing them. The proposal agent writes an outbox, and a separate job opens pull requests. `GARDEN_REPORT` and `GARDEN_OUTBOX` identify files inside that run, and aren't repository configuration. See [Garden trace scoring](/shepherd/operations/gardener-telemetry/) for endpoint restrictions, flags and coverage limits.

## Related resources

- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): add the workflow and its secrets
- [Choose models](/shepherd/configuration/models/): pick a model and name tiers
- [Configuration reference](/shepherd/reference/configuration/): every setting in `.shepherd/config.yml`
- [Send pull request state notifications](/shepherd/integrations/notifications/): what `SHEPHERD_NOTIFY_WEBHOOK` receives
- [Garden trace scoring](/shepherd/operations/gardener-telemetry/): the trace sources garden reads
