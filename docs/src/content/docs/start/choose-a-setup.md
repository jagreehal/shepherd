---
title: "Choose a setup"
description: "Choose between a local review, a pull request loop from your coding agent, and a review in CI, and learn where to enter each command."
---

Shepherd runs in three places: in your coding agent before you open a pull request, in your coding agent on an open pull request, and in GitHub Actions on each push. Pick the task you want done first, then configure models or shared policy.

## Pick a setup

Find your task in the first column:

| Your task | Start with | What you get |
| --- | --- | --- |
| Check a change before you open a pull request | [Review before opening a pull request](/shepherd/guides/local-review/) | Findings or fixes in your working tree |
| Work through an open pull request's findings from your agent | [Run your first review](/shepherd/start/quickstart/) | Findings, local fixes, or pushed fixes under your team's policy |
| Review each pull request in CI | [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/) | One review per push and the `shepherd` status: approved, refused, escalated, or an error |

`shepherd init` writes the policy and the CI workflow. The skills in your coding agent work without the workflow.

## Where to enter commands

The docs use two kinds of command:

- **Terminal commands**: start with `bunx`, `shepherd`, `gh` or `git`. Run them from a clone of the repository you want to review, unless a guide says otherwise.
- **Agent commands**: start with `/`, such as `/shepherd 42`. Enter them in your coding agent after you install the skills. Your harness has to load skills and the subagents those skills use. Scheduling commands such as `/loop` depend on the harness.

## Start with one repository

Pick a test pull request whose changes you understand, and read the findings and the resulting diff before you roll Shepherd out further. A completed review doesn't mean the pull request has approval, green CI, or the human reviews your branch rules require.

## Related resources

- [Run your first review](/shepherd/start/quickstart/): a complete setup path from your coding agent
- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): a review on each push
- [Review before opening a pull request](/shepherd/guides/local-review/): review and fix with no GitHub writes
