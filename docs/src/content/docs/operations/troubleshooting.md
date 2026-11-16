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
| PR never reaches ready | The `shepherd` status on the current head | Do what its description names; a completed local review alone is insufficient |
| Status says `approved; N open thread(s) to resolve` | Open threads that are shepherd's or that a person wrote in | Read and resolve them yourself; Shepherd never resolves a thread a person is in |
| Thread remains open | Human participation or a deferred decision | Read and decide it yourself; Shepherd leaves those threads for you |
| No review on a PR | Draft state, `review.label`, and the run in the Actions tab | Mark it ready, add the label, or comment `/review` |
| `/review` comment does nothing | The commenter's access | Only someone who can push starts a review with a comment |
| Status is `error` | The `shepherd` run's log in the Actions tab | Fix the cause, then comment `/review` |
| No notification | Webhook and `review.notify.on` | Verdicts outside `notify.on` send nothing; by default only refusals, escalations and errors notify |

## Share evidence in a bug report

Include the package version, harness, command, effective fix mode, expected result and the observed summary. Add the relevant Actions URL or local completion result. Remove secrets and private code before you share logs.

Use [results and status](/shepherd/guides/results/), [team policy](/shepherd/configuration/team-policy/) and [GitHub Actions](/shepherd/integrations/github-actions/) to trace the relevant path.
