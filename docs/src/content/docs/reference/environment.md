---
title: "Environment and credentials"
---

Your local coding agent uses its own provider authentication. The supplied CI workflows run OpenCode and pass the secrets below to the steps that need them. For another provider, edit the workflow environment and model together.

## Model

One model drives the loop and the gate, written `provider/model`: `anthropic/claude-opus-5`, `openai/gpt-5.5`, `opencode-go/deepseek-v4.1-flash`, `openrouter/moonshotai/kimi-k3`, `amazon-bedrock/eu.amazon.nova-pro-v1:0` (`bedrock/` works too). `shepherd workflows --model <id>` pins it as `models.loop` in `.shepherd/config.yml`, and the gate reads it from there. The `SHEPHERD_MODEL` variable overrides it for both; `model:` in `.shepherd/gate.yml` gives the gate its own.

`google/` and `xai/` run only in the loop, and `openai-compatible/` (with `OPENAI_COMPATIBLE_BASE_URL`) only in the gate, so `shepherd workflows --model` refuses them; pin each side separately to use one.

Each provider reads its key from its usual variable. Set the one your model needs as a secret.

| Provider prefix | Key |
| --- | --- |
| `anthropic/` | `ANTHROPIC_API_KEY` |
| `openai/` | `OPENAI_API_KEY` |
| `opencode/`, `opencode-go/` | `OPENCODE_API_KEY` |
| `openrouter/` | `OPENROUTER_API_KEY` |
| `deepseek/`, `groq/`, `mistral/` | `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY` |
| `amazon-bedrock/` (or `bedrock/`) | `AWS_BEARER_TOKEN_BEDROCK`, plus `AWS_REGION`; the gate can use OIDC instead |
| `openai-compatible/` (gate only) | `OPENAI_COMPATIBLE_API_KEY`, plus `OPENAI_COMPATIBLE_BASE_URL` |
| `google/`, `xai/` (loop only) | `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY` |

## Settings

Every other setting lives in a reviewed file on the default branch, never in a variable: the loop's in `.shepherd/config.yml` (`ci.label`, `ci.notify_on`, `ci.max_commits`, `ci.push_deny`, `ci.incident_paths`, `ci.audit.plays`, `ci.audit.public`), the gate's in `.shepherd/gate.yml`. `shepherd config explain` and `shepherd gate config` print each with its source.

`ci.push_deny` is a security control, so config can only widen it. Only the `SHEPHERD_PUSH_DENY` variable, which needs repository admin, replaces the built-in list; config patterns are still added to it.

## Secrets and workflow environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `SHEPHERD_TOKEN` | Secret | Fine-grained GitHub PAT with contents, pull requests and commit statuses read/write. Only jobs that run no model see it. Without it, pushes start no workflows and the loop stalls |
| Provider key | Secret | See the table above. Store it in the environment `shepherd workflows --environment <name>` names, so only the model job reads it |
| `SHEPHERD_MODEL` | Variable | Optional `provider/model`, over the config files |
| `AWS_REGION` | Variable | The Bedrock region |
| `SHEPHERD_PUSH_DENY` | Variable | Replaces the built-in deny list for pushed fixes |
| `SHEPHERD_NOTIFY_WEBHOOK` | Secret | Slack Incoming Webhook or any JSON endpoint, for the loop and the gate |
| `SHEPHERD_HANDOFF`, `SHEPHERD_DEFAULT_BRANCH` | Set by the workflow | Internal |
| `GH_TOKEN` | Step environment | GitHub identity used by `gh` |

### Gate-only, all optional

| Name | Kind | Purpose |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | Secret | Key for `gateway/` model ids |
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret | Runs the gate's review through the Claude Code CLI on a Claude plan (`backends: [claude]` in `.shepherd/gate.yml`) |
| `CODEX_API_KEY` | Secret | Runs the gate's review through the Codex CLI (`backends: [codex]`) |
| `TYPESAFE_API_KEY` | Secret | Adds advisory risk probabilities to the gate's evidence; never changes a verdict |
| `ANTHROPIC_BASE_URL` | Variable | Sends Anthropic calls through a proxy |
| `AWS_ROLE_ARN` | Variable | Bedrock through OIDC instead of a key (`shepherd gate init --aws-oidc`) |

A push made with the repository `GITHUB_TOKEN` does not trigger the next workflow. Configure `SHEPHERD_TOKEN` for a CI loop that pushes fixes. Private organisation packs need a read identity with access to the policy repository. The supplied model job uses a repository-scoped token, so multi-repository pack access requires a separately reviewed read-only credential setup; do not pass the publishing token to the model.

The PR model job sets `SHEPHERD_HANDOFF` to a temporary directory for commit/status handoff. You do not need to set it for local use.

`shepherd workflows` pins `SHEPHERD_VERSION` in each job that installs the CLI to the version that wrote the file. They set `OPENCODE_DISABLE_PROJECT_CONFIG` and `OPENCODE_DISABLE_AUTOUPDATE` for the runner. Those are workflow controls rather than team policy fields. A different harness needs its own equivalent configuration and skill-loading setup.

## Traces

| Name | Purpose |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint; without it, a flush clears the record without exporting |
| `OTEL_EXPORTER_OTLP_HEADERS` | Secret collector headers, when your collector needs authentication |
| `OTEL_SERVICE_NAME` | Trace service name; default `shepherd` |
| `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_SERVER_URL` | Runner-supplied run context and PR URLs |

See [iteration traces](/shepherd/operations/traces/). The CLI reports stage timings; the harness reports model usage.

## Garden inputs and credentials

| Name | Kind | Purpose |
| --- | --- | --- |
| `GARDEN_REPOS` | Variable | Space-separated repositories to score in the weekly workflow |
| `GARDEN_MODEL` | Variable | Model used to propose garden changes |
| `GARDEN_TOKEN` | Secret | Publish proposed PRs; contents and pull requests write access on the target repositories |
| `GARDEN_READ_TOKEN` | Secret, optional | Read private repositories during scoring and proposal |
| `GARDEN_TRACE_FILES` | Environment | JSON array of exported OTLP file paths for scheduled collection |
| `GARDEN_TEMPO_URL` | Variable/environment | Tempo query endpoint |
| `GARDEN_TEMPO_HEADERS` | Secret | JSON object of headers for that Tempo endpoint |
| `GARDEN_DATADOG_SITE` | Variable/environment | Datadog site |
| `GARDEN_DATADOG_API_KEY` | Secret | Datadog API credential |
| `GARDEN_DATADOG_APP_KEY` | Secret | Read-only Datadog application credential with `apm_read` |

The weekly workflow separates proposing changes from publishing them. The proposal agent writes an outbox; a separate job opens PRs. `GARDEN_REPORT` and `GARDEN_OUTBOX` identify files inside that run, not repository configuration. See [garden trace scoring](/shepherd/operations/gardener-telemetry/) for endpoint restrictions, flags and coverage limits.
