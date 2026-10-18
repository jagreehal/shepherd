---
title: "Environment and credentials"
---

Your local coding agent uses its own provider authentication. The supplied CI workflows run OpenCode and pass the secrets below to the steps that need them. For another provider, edit the workflow environment and model together.

## PR and incident workflows

| Name | Kind | Purpose |
| --- | --- | --- |
| `SHEPHERD_TOKEN` | Secret | Fine-grained GitHub PAT with contents, pull requests and commit statuses read/write; scope it to the repositories it needs. Only jobs that run no model see it: `gate` and `publish`, and the incident `open` job. Without it, pushes start no workflows and the loop stalls |
| `OPENCODE_API_KEY` | Secret | Model authentication for the supplied OpenCode runner |
| `SHEPHERD_MODEL` | Variable | OpenCode `provider/model` for both workflows; default `opencode-go/kimi-k3` |
| `SHEPHERD_LABEL` | Variable | Optional handoff label restricting automatic PR iterations |
| `SHEPHERD_PUSH_DENY` | Variable | Optional extended regex, matched case-insensitively, of paths a CI fix may not touch; the default covers workflows, Git and editor hooks, package-manager configuration, manifests, lockfiles and make/just/task files ([details](/shepherd/integrations/github-actions/#credential-handoff)) |
| `SHEPHERD_HANDOFF` | Set by the workflow | Directory that switches the skill to handoff mode: commit, never push, write `status.json` |
| `SHEPHERD_NOTIFY_WEBHOOK` | Secret | Slack Incoming Webhook or generic JSON endpoint; PR workflow only, or set locally |
| `INCIDENT_PATHS` | Variable | Extended regex of paths an incident fix may change; default `^src/` |
| `SHEPHERD_NOTIFY_ON` | Variable | Comma-separated states; default `success,failure,error`; add `pending` for progress |
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
