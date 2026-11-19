---
title: "Read and respond to a review"
description: "Read Shepherd's review on your GitHub pull request, respond to or dismiss its findings, request another review with /review, and read the verdict from a script."
---

Once your repository runs [Shepherd in GitHub Actions](/shepherd/integrations/github-actions/), Shepherd reviews each push to a pull request. It posts one review with a verdict, an inline comment per finding, and the `shepherd` commit status on the head it reviewed. Shepherd never approves on GitHub: a person approves and merges.

:::note
To review your branch before you open a pull request, run [`/shepherd --local`](/shepherd/guides/local-review/) in your coding agent instead.
:::

## Read the review

Shepherd posts the review as a COMMENT. Its heading carries the verdict, the head it read and the round, such as `✅ shepherd: APPROVED · head a1b2c3d · round 2`. The sections below the heading appear in this order:

| Section | What it tells you |
| --- | --- |
| **Merge risk** | What merging this head as it stands could break. 🔴 high for data loss, a security hole, a wrong charge or broken callers; 🟡 medium for a contained bug or a risk the review couldn't verify; 🟢 low otherwise. A refusal or an escalation reads at least medium |
| **Next** | What the author does next |
| **What changed** | The reviewer's summary of the change |
| **Safe because** | On an approval, the fact that makes the change safe, and whether the reviewer checked it |
| **Earlier rounds** | The verdict on each earlier head of this pull request |
| **Issues** | The findings behind the verdict, numbered so a reply can name "issue 2" |
| **Coding standards** | Places the change breaks a `REVIEW.md` rule. They don't change the verdict, and each one holds the status only through its open thread |
| **Notes** | Observations that don't block, including breaches of other house rules |
| **House rules not fully applied** | Rules a size or include limit left out of this review |
| **Fix with a coding agent** | On a refusal or escalation, a prompt to paste into your agent |

The workflow run's summary page in the **Actions** tab holds the full review, with every section open and the house-rule files that applied.

### Verdicts

Find the heading in the first column:

| Heading | What it means | The `shepherd` status |
| --- | --- | --- |
| ✅ `shepherd: APPROVED` | The review found nothing to block on | `success` once no thread of Shepherd's or a person's is open. Until then, `failure` with `approved; N open thread(s) to resolve` |
| ❌ `shepherd: REFUSED` | A finding blocks approval | `failure`, `changes needed: …` |
| 🙋 `shepherd: ESCALATE` | A person has to decide: a policy path changed, the reviewers disagreed, a high-risk approval rests on an unchecked fact, or the pull request reached its fourth refusal | `failure`, `a person decides: …`, until someone who can push approves the head |

### Inline comments

Shepherd posts each finding that has a line as an inline comment on that line, so the comment doesn't repeat the file and line. The comment opens with its grade:

- **`❌ Blocks approval`**: the finding behind a refusal. Fix it before you merge.
- **`🙋 Needs a person`**: the finding behind an escalation. Someone who can push decides.

Shepherd also posts each `REVIEW.md` breach as an inline comment, on any verdict, so you or your agent can fix it. Its open thread holds the status at `failure` until someone fixes or resolves it. On a stacked pull request, GitHub can't anchor these comments, so Shepherd lists the breaches in the review only.

## Respond to findings

To clear a finding, push a fix or resolve its thread.

- **Fix the issue**: change the code and push. Shepherd resolves its own thread once your push changes the code under or near it, then reviews the new code. Anything it raises there posts as a new thread.
- **Dismiss it without a code change**: resolve the thread yourself on GitHub. If the next review doesn't repeat the finding, the thread stays resolved.
- **Explain or disagree**: reply to the comment. Shepherd never resolves a thread a person wrote in, so the thread stays open, and holds the status, until someone resolves it.

GitHub sends no event for a resolved thread. After you resolve the last open thread, comment `/review` or submit any review, and Shepherd updates the status.

On code nobody touched, Shepherd posts nothing new for a finding of the same grade near an open Shepherd thread. The existing thread stays, with its history.

### Settle an escalation

A person settles an escalation, so a push alone doesn't clear it. Read the reasoning, then approve the pull request on GitHub as someone who can push. The `settle` job reads the pull request again and sets the status to `success`, `approved by <person>`, as long as no thread of Shepherd's or a person's is open.

The `settle` job applies these rules:

- **Approval during the review**: an approval you gave while the review was still running counts.
- **Latest decision**: each person's latest review counts, so dismissing your approval sets `failure` again.
- **Pull requests from forks**: GitHub gives the approval event a read-only token, so Shepherd can't change the status. An escalated fork pull request stays `failure`, and someone allowed to bypass the branch rule merges it.

An approval can't settle a refusal. The author changes the code.

## Request a review

Shepherd starts a review after any of these:

- **Open, reopen, or mark ready**: opening a pull request, reopening it, or marking a draft ready.
- **Push**: each push to the pull request's branch.
- **Retarget the base**: changing the pull request's base branch.
- **Comment `/review`**: from someone who can push. From the terminal, `shepherd review <pr>` posts that comment for you.

A newer run on the same pull request cancels the one in flight, so only the latest head gets a verdict.

### Comment commands

Post one of these as a comment on the pull request:

| Command | What it does |
| --- | --- |
| `/review` | Reviews the pull request's current head from scratch |
| `/gate` | Same as `/review` |

For a comment command to take effect, all of these have to hold:

- **New top-level comment**: post it in the pull request's conversation. An inline comment on a diff line, the body of a review, or an edit to an earlier comment doesn't count.
- **Command first**: start the comment with the command. Other text can follow it.
- **Push access**: you can push to the repository. Shepherd asks GitHub's permission API, so access through a team counts, and Shepherd ignores anyone else's comment.
- **Ready pull request**: the pull request isn't a draft, and it carries the trigger label if `review.label` is set.

### When a push keeps the approval

After a push that leaves the pull request's own diff byte-identical, such as a merge of the base branch that touched none of its files, Shepherd keeps the standing approval, runs no new review, and sets the status on the new head. If the diff changed, a policy gate fails, or anything is unclear, Shepherd runs a fresh review.

A `/review` comment always runs a fresh review.

### Drafts, labels and forks

Shepherd treats these pull requests differently:

- **Drafts**: Shepherd doesn't review them and sets the status to `not reviewed: PR is a draft`. Mark the pull request ready to start a review.
- **Missing trigger label**: with `review.label` set, Shepherd skips a pull request without the label the same way. Add the label to start a review.
- **Forks**: GitHub gives a `pull_request` run from a fork no secrets, so the model can't run. Someone who can push comments `/review`, and the review runs in the base repository.

### Stacked pull requests

If you open a pull request against another open pull request's branch, Shepherd reviews only its own change, over the parent's head. Shepherd holds its approval until someone approves or merges the parent, because merging it first would land the parent's code too. Comment `/review` once the parent is approved.

## Read the result from a script

A branch rule can require the `shepherd` status, and your own scripts can read it like any commit status. Replace `OWNER`, `REPO` and `<head-sha>`:

```bash
gh api repos/OWNER/REPO/commits/<head-sha>/status \
  --jq '.statuses[] | select(.context == "shepherd") | {state, description}'
```

Have your script handle the state in this order:

- **`success`**: approved, with no thread of Shepherd's or a person's open.
- **`failure`**: read the description. It starts with `changes needed`, `a person decides`, or `approved; N open thread(s) to resolve`.
- **`pending`**: the review is running, or the description starts with `not reviewed` for a draft or an unlabelled pull request.
- **`error`, or no `shepherd` status**: the review didn't finish. Treat that as no verdict, never as an approval.

For the whole review, download the run's `gate-evidence-<pr>` artifact. It holds the review's evidence as JSON, including its `verdict`.

To see the review, the status, CI and open threads together, run `shepherd status <pr>`. It prints them as one stage, with the next step.

## Use Shepherd alongside Claude Code Review

Shepherd reads `REVIEW.md` the way [Claude Code Review](https://code.claude.com/docs/en/code-review-customize) does, so one file steers both. Their comment commands don't collide: Claude Code Review answers `@claude review`, and Shepherd answers `/review`.

From your coding agent, `/shepherd <pr>` reads Claude Code Review's check run to see if it finished. It fixes 🔴 Important and 🟡 Nit findings like any bot's, and leaves 🟣 Pre-existing ones to you.

## Related resources

- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): install the workflow and require the status
- [Understand results and commit status](/shepherd/guides/results/): each state of the `shepherd` status
- [Customize Shepherd for your team](/shepherd/start/customize/): change what the review flags
- [Troubleshoot a review or repair](/shepherd/operations/troubleshooting/): a review that didn't start or didn't finish
