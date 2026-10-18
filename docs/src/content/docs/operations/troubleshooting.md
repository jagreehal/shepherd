---
title: "Troubleshoot a review or repair"
---

Run `shepherd doctor` from the repository clone first. Read the failed check's suggested action, then inspect the agent summary and the current PR head.

| Symptom | Check | Next action |
| --- | --- | --- |
| Agent cannot find `/shepherd` | Skills directory for your harness | Install the full pack to that directory and reload the agent |
| Shell says `shepherd: command not found` | CLI installation and `PATH` | Use `bun add -g @jagreehal/shepherd`, or `bunx @jagreehal/shepherd <command>` |
| Review posts findings but makes no fixes | Effective `fixes.mode` | `suggest` is review-only; merge `local` or `push` policy if you want fixes |
| Fixes exist but nothing was pushed | `local` mode or `--local` | Inspect and commit the working-tree changes yourself |
| Edited config has no effect | Default-branch policy | Use `--working-tree` to preview edits; merge them for PR runs |
| Pack or lens cannot load | Pinned SHA, default-branch ancestry and repository access | Give `gh` read access and fix the configured path |
| Configuration validation fails after migration | Both config files exist | Keep `.shepherd/config.yml` after reviewing the migration and remove the old `.shepherd/lenses.yml` |
| Recipe is unavailable | Recipe steps and fix mode in `preview` | Choose a recipe allowed by the mode and review after its last fix |
| Review is incomplete | Local record, failed lenses and changed fingerprint | Rerun the missing review stages on the current content |
| PR never reaches ready | Stamp approval, CI and open threads on the current head | Complete the missing condition; a completed review alone is insufficient |
| Thread remains open | Human participation or a deferred decision | Read and decide it yourself; Shepherd leaves those threads for you |
| CI workflow does not start | Trigger workflow names, label and author access | Match `workflows:` to the CI names and inspect the gate step |
| CI fixes push but no next run starts | Token used to push | Configure `SHEPHERD_TOKEN`; pushes through `GITHUB_TOKEN` do not start the next workflows |
| Repeated CI loop stops | Shepherd commit cap and current status | Inspect the reason and take over the unresolved problem |
| Status says `fixes not pushed, a person should look` | The `publish` job log: protected path, not a fast-forward, the PR's default or base branch, or no `SHEPHERD_TOKEN` secret | Apply the change yourself, or adjust `SHEPHERD_PUSH_DENY` after review |
| An `incident/*` PR gets no iteration | Gate skip reason | Comment `/shepherd` or add the handoff label after you read the fix |
| Incident fix never becomes a PR | The `open` job log | Paths outside `INCIDENT_PATHS` are refused; review the change or the pattern |
| No notification | Webhook, state filter and result of `notify` | `off` means no webhook or a state outside `SHEPHERD_NOTIFY_ON`; `unchanged` means the last recorded state and description match; `failed` retries next iteration |

## Share evidence in a bug report

Include the package version, harness, command, effective fix mode, expected result and the observed summary. Add the relevant Actions URL or local completion result. Remove secrets and private code before you share logs.

Use [results and status](/shepherd/guides/results/), [team policy](/shepherd/configuration/team-policy/) and [GitHub Actions](/shepherd/integrations/github-actions/) to trace the relevant path.
