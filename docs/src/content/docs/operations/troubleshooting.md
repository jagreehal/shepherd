---
title: "Troubleshoot a review or repair"
description: "Fix a Shepherd review that didn't start or didn't finish, a status that stays failure, and local skills that don't fix or push."
---

If Shepherd doesn't do what you expect on a pull request, start with the `shepherd` commit status on the pull request's latest head. Its state and description say how far the review got. For problems with the skills in your coding agent, see [Skills in your coding agent](#skills-in-your-coding-agent).

Run `shepherd doctor` from a clone of the repository first, and fix each line marked `fail`.

## Check how far the review got

Find the `shepherd` status in the pull request's checks, then match it to one of these:

| Status and description | What it means | What to do |
| --- | --- | --- |
| `pending`, `shepherd is reviewing this head` | The review is running | Wait for it to finish. If it stays `pending` past 20 minutes, see [The review timed out](#the-review-timed-out) |
| `pending`, `not reviewed: …` | Shepherd skipped this head | See [A review didn't run](#a-review-didnt-run) |
| `success`, `approved; no open thread` | The review approved and nothing is open | Nothing |
| `success`, `approved by <person>` | A person settled an escalation | Nothing |
| `failure`, `changes needed: …` | The review refused | Fix the findings and push. See [Respond to findings](/shepherd/guides/pull-requests/#respond-to-findings) |
| `failure`, `a person decides: …` | The review escalated | Someone who can push approves the head. See [Settle an escalation](/shepherd/guides/pull-requests/#settle-an-escalation) |
| `failure`, `approved; N open thread(s) to resolve` | The review approved, but threads are open | See [The status stays failure after an approval](#the-status-stays-failure-after-an-approval) |
| `error` | The review didn't finish | See [The status is error](#the-status-is-error) |
| No `shepherd` status | No review started | Comment `/review`. If nothing appears, see [A `/review` comment didn't start a review](#a-review-comment-didnt-start-a-review) |

## A review didn't start

Check these cases if no review appears on a pull request, or the status says `not reviewed`.

### A review didn't run

Look for the `shepherd` run in the repository's **Actions** tab, then check for each of these causes:

- **Draft**: Shepherd skips drafts and sets `not reviewed: PR is a draft`. Mark the pull request ready, which starts a review.
- **Trigger label**: with `review.label` set, Shepherd skips a pull request without the label the same way. Add the label.
- **No workflow on the default branch**: merge `.github/workflows/shepherd.yml`. `shepherd doctor` warns if it's missing.
- **Fork**: GitHub gives a `pull_request` run from a fork no secrets. Someone who can push comments `/review`.
- **Superseded**: a newer push or `/review` cancelled the run in flight. The newest run carries the verdict.

### A `/review` comment didn't start a review

Shepherd acts on a comment only if it's a new top-level comment in the pull request's conversation that starts with `/review` or `/gate`, from someone who can push, on a pull request that isn't a draft. Check for each of these causes:

- **Wrong kind of comment**: an inline comment on a diff line, the body of a review, or an edit to an earlier comment doesn't count. Post a new comment.
- **Command not first**: put the command at the start of the comment.
- **No push access**: the run's log names the commenter, such as `/review from <login> (CONTRIBUTOR), who cannot merge; ignoring it`. Ask someone who can push to comment instead.
- **Draft or missing label**: see [A review didn't run](#a-review-didnt-run).

## A review didn't finish

### The status is error

Open the `shepherd` run's log in the **Actions** tab and check for each of these causes:

- **Missing or wrong model key**: `shepherd doctor` says whether the model's key is a repository secret. If you set up the workflow with `--environment`, store the key in that environment's secrets.
- **A guard limit**: Shepherd stops a review that passes a limit in `guard` under `review:`. The defaults are $2, 3 million tokens, 80 tool calls or 15 minutes. See [Limit your spend](/shepherd/operations/costs/#limit-your-spend).
- **A provider error**: the log names the provider's error. Fix the key, quota or model id it names.

Fix the cause, then comment `/review`. Never treat `error` as an approval.

### The review timed out

GitHub stops the job after 20 minutes, which leaves the status `pending`. Comment `/review` to run the review again. If it happens again, lower `guard.timeout` under `review:` so Shepherd stops first and reports `error`.

## The status stays failure after an approval

Read the status description, then match it here:

- **`approved; N open thread(s) to resolve`**: threads that are Shepherd's, or that a person wrote in, are still open. Read and resolve them yourself, because Shepherd never resolves a thread a person is in. GitHub sends no event for a resolved thread, so comment `/review` or submit any review after you resolve the last one.
- **`a person decides: …`**: someone who can push approves the head the review read. On a pull request from a fork, an approval can't change the status, so someone allowed to bypass the branch rule merges it.
- **Stacked pull request**: Shepherd holds the approval until someone approves or merges the parent pull request. Comment `/review` once that happens.

## Policy and house rules

### An edit to the policy has no effect

Shepherd reads `.shepherd/config.yml`, house rules and lenses from the default branch. Merge the edit. Shepherd reviews the pull request that makes it against the old version, and sends any edit to `.shepherd/config.yml` to a person. To preview an edit before you merge it, run `shepherd gate config --policy-dir .shepherd`.

### The review lists "House rules not fully applied"

A size or include limit left a rule out. `REVIEW.md` and the files it includes share 150,000 bytes, with at most eight included files and 64 Markdown links. Shorten the files or cut includes. See [`REVIEW.md`, as Claude Code Review reads it](/shepherd/integrations/github-actions/#reviewmd-as-claude-code-review-reads-it).

### No notification arrives

Check the webhook and `review.notify.on`. By default Shepherd notifies only on refusals, escalations and errors. See [Send pull request state notifications](/shepherd/integrations/notifications/).

## Skills in your coding agent

Find the symptom in the first column:

| Symptom | What to check | What to do |
| --- | --- | --- |
| Agent can't find `/shepherd` | The skills directory for your harness | Install the full pack to that directory and reload the agent |
| Shell says `shepherd: command not found` | CLI installation and `PATH` | Run `bun add -g @jagreehal/shepherd`, or use `bunx @jagreehal/shepherd <command>` |
| Review posts findings but makes no fixes | The effective `fixes.mode` | `suggest` is review-only. Merge `local` or `push` policy if you want fixes |
| Fixes exist but nothing was pushed | `local` mode or `--local` | Inspect and commit the working-tree changes yourself |
| Edited config has no effect | Default-branch policy | Preview edits with `--working-tree`, and merge them for pull request runs |
| A pack or lens can't load | Pinned SHA, default-branch ancestry and repository access | Give `gh` read access and fix the configured path |
| Configuration validation fails after migration | Both config files exist | Keep `.shepherd/config.yml` after reviewing the migration, and remove the old `.shepherd/lenses.yml` |
| A recipe is unavailable | Recipe steps and fix mode in `preview` | Choose a recipe the mode allows, with a review after its last fix |
| Review is incomplete | Local record, failed lenses and changed fingerprint | Rerun the missing review stages on the current content |
| Pull request never reaches ready | The `shepherd` status on the current head | Do what its description names. A completed local review alone isn't enough |
| A thread stays open | A person in the thread, or a deferred decision | Read and decide it yourself. Shepherd leaves those threads for you |

## Share evidence in a bug report

Include the package version, harness, command, effective fix mode, expected result and the summary you saw. Add the Actions run URL, the `gate-evidence-<pr>` artifact, or the local completion result. Remove secrets and private code before you share logs.

## Related resources

- [Read and respond to a review](/shepherd/guides/pull-requests/): what each verdict and status means, and the comment commands
- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): the workflow, the model key and `shepherd doctor`
- [Review costs](/shepherd/operations/costs/): the guard limits behind a stopped review
- [Compose team policy and recipes](/shepherd/configuration/team-policy/): packs, lenses and recipes
