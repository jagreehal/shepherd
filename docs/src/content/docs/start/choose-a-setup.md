---
title: "Choose a setup"
---

Choose the task you want to complete before you configure models or shared policy.

| Your task | Start with | Result |
| --- | --- | --- |
| Check a change before you open a PR | [Shepherd local review](/shepherd/guides/local-review/) | Findings or fixes in your working tree |
| Work through an existing PR's findings from your agent | [Shepherd first run](/shepherd/start/quickstart/) | Findings, local fixes, or pushed fixes under your team policy |
| Review every PR in CI | [Shepherd GitHub Actions](/shepherd/integrations/github-actions/) | One review per push and the `shepherd` status: approved, refused, escalated, or an error |

`shepherd init` writes the policy and the CI workflow. The skills in your coding agent work without the workflow.

## Commands and where to enter them

A **terminal** command starts with `bunx`, `shepherd`, `gh`, or `git`. Run it from a clone of the repository you want to review unless a guide says otherwise.

An **agent** command starts with `/`, such as `/shepherd 42`. Enter it in your coding agent after you install the skills. Your harness must support loading skills and the subagents those skills use. Agent scheduling commands such as `/loop` depend on the harness.

## Start with one repository

Choose a test PR whose changes you understand. Read the findings and resulting diff before you broaden adoption. A completed review does not mean the PR has approval, green CI, or the required human reviews.

Read the [Shepherd first-run guide](/shepherd/start/quickstart/) for a complete setup path.
