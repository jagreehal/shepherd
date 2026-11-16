---
title: "Shepherd documentation"
---

<img src="/shepherd/shepherd.jpg" alt="Shepherd: a shepherd with a crook herding code-bracket sheep" width="420">

Shepherd reviews every PR in GitHub Actions and posts one review per push. On your own machine, its skills in your coding agent review a change before you open a PR, fix findings and repair CI.

Start with [your first review](/shepherd/start/quickstart/). Choose review-only mode first if you want to inspect findings before you let the agent edit code.

## Find your task

| You want to | Read |
| --- | --- |
| Choose between local use, a PR loop, and CI | [Choose a setup](/shepherd/start/choose-a-setup/) |
| Review a change before you commit or push | [Local review](/shepherd/guides/local-review/) |
| Configure what the agent may change | [Configuration reference](/shepherd/reference/configuration/) |
| Add your team's rules, step by step | [Customize Shepherd for your team](/shepherd/start/customize/) |
| Share reviewers and policy across repositories | [Team policy and recipes](/shepherd/configuration/team-policy/) |
| Add a domain-specific reviewer | [Review lenses](/shepherd/configuration/lenses/) |
| Review every PR in CI | [GitHub Actions](/shepherd/integrations/github-actions/) |
| Diagnose a missing review, fix or status | [Troubleshooting](/shepherd/operations/troubleshooting/) |

## Review results and approval

In CI, Shepherd posts one review per push as a COMMENT and sets the `shepherd` commit status: `success` only when the review approves the current head and no thread a person wrote in is open. A person approves the PR. Locally, a completed review can mean findings posted or uncommitted fixes. Read [results and status](/shepherd/guides/results/) for these distinctions.
