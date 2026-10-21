---
title: "Environment and credentials"
---

Your local coding agent uses its own provider authentication. The supplied CI workflows run OpenCode and pass the secrets below to the steps that need them. For another provider, edit the workflow environment and model together.

## Settings

Every setting that is not a secret lives in `.shepherd/config.yml`, read from the default branch, so a change to it is reviewed like code. Each has an optional repository variable that wins over the config when it is set (a blank variable counts as unset). One resolver applies the order variable, config, default; `shepherd config explain` prints each setting with its source, and each secret only as set or unset.

| Setting | Config key | Variable override | Default |
| --- | --- | --- | --- |
| Session model in CI | `models.loop` | Bedrock region | `ci.aws_region` | Handoff label | `ci.label` | States that notify | `ci.notify_on` (list) | `SHEPHERD_NOTIFY_ON` (comma-separated) | `success,failure,error` |
| Shepherd commits per PR before it stops for a person | `ci.max_commits` | `SHEPHERD_MAX_COMMITS` | `20` |
| Paths a CI fix may not touch | `ci.push_deny` (list, **added** to the built-in list) | `SHEPHERD_PUSH_DENY` (**replaces** the built-in list) | workflows, hooks, package manager config, manifests, lockfiles |
| Paths an incident fix may change | `ci.incident_paths` | Audit plays | `ci.audit.plays` (list) | `AUDIT_PLAYS` (space-separated) | `secrets-scan sca-audit iac-security-review code-review-security` |
| Audit a public repository | `ci.audit.public` | `AUDIT_PUBLIC` | `false` |

`ci.push_deny` is a security control, so config can only widen it: a repository adds to its packs' patterns and to the built-in list, and nothing in config removes one. Only the `SHEPHERD_PUSH_DENY` variable, which needs repository admin, replaces the built-in list; config patterns are still added to it.

A label event starts the gate job even when no variable names the label, because the label may live in config. The gate reads `ci.label` from the default branch and skips any other label in seconds, before a model is involved.

## Secrets and workflow environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `SHEPHERD_TOKEN` | Secret | Fine-grained GitHub PAT with contents, pull requests and commit statuses read/write; scope it to the repositories it needs. Only jobs that run no model see it: `gate` and `publish`, and the incident `open` job. Without it, pushes start no workflows and the loop stalls |
| `SHEPHERD_API_KEY` | Secret | Store model keys as secrets of the environment `shepherd workflows --environment <name>` names, so only the model job reads them. The model key, put in the variable the session model's provider reads (`AWS_BEARER_TOKEN_BEDROCK` on Bedrock). A provider's own secret wins over it |
| `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY` | Secret | Each provider's own key, for a ladder that mixes providers |
| `SHEPHERD_MODEL` | Variable | Optional override. Name the session model in `.shepherd/config.yml` instead (`models.loop`, set by `shepherd models pin loop <model>` or `shepherd workflows --model`), where it is reviewed and versioned. When set, the variable wins for every workflow: a model id (OpenCode's `provider/model` or stamp's `provider:model`) or a tier name. Empty = the team's `models.loop`, else the top of its ladder, else `opencode-go/kimi-k3` |
| `SHEPHERD_DEFAULT_BRANCH` | Set by the workflow | The default branch, so `ci-models` reads policy without asking the remote |
| `AWS_BEARER_TOKEN_BEDROCK` | Secret | A Bedrock API key, for a `bedrock:` model. Shepherd's workflows take a key and grant no `id-token: write`: the model runs a shell, and an OIDC token could assume any role that trusts the repository |
| `AWS_REGION` | Variable | The Bedrock region, for a `bedrock:` model |
| `SHEPHERD_LABEL` | Variable | Optional handoff label restricting automatic PR iterations |
| `SHEPHERD_HANDOFF` | Set by the workflow | Directory that switches the skill to handoff mode: commit, never push, write `status.json` |
| `SHEPHERD_NOTIFY_WEBHOOK` | Secret | Slack Incoming Webhook or generic JSON endpoint; PR workflow only, or set locally |
| `INCIDENT_PATHS` | Variable | Extended regex of paths an incident fix may change; default `^src/` |
| `GH_TOKEN` | Step environment | GitHub identity used by `gh`; the model step, the sweep and the status, rerun and notify steps get `github.token`; only the gate step, the push step and the incident `open` job get `SHEPHERD_TOKEN` |

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
