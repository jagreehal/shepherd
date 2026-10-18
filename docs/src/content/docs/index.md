---
title: "Shepherd documentation"
---

Use Shepherd to review changes, fix findings and repair CI through skills in your coding agent. Start before you open a PR, review an existing PR, or run an iteration in GitHub Actions.

Start with [your first review](/shepherd/start/quickstart/). Choose review-only mode first if you want to inspect findings before you let the agent edit code.

## Find your task

| You want to | Read |
| --- | --- |
| Choose between local use, a PR loop, and CI | [Choose a setup](/shepherd/start/choose-a-setup/) |
| Review a change before you commit or push | [Local review](/shepherd/guides/local-review/) |
| Configure what the agent may change | [Configuration reference](/shepherd/reference/configuration/) |
| Share reviewers and policy across repositories | [Team policy and recipes](/shepherd/configuration/team-policy/) |
| Add a domain-specific reviewer | [Review lenses](/shepherd/configuration/lenses/) |
| Keep the loop running without your laptop | [GitHub Actions](/shepherd/integrations/github-actions/) |
| Diagnose missing reviews, fixes or approvals | [Troubleshooting](/shepherd/operations/troubleshooting/) |

## Review results and approval

Shepherd posts findings and can fix code under your policy. Stamp supplies the approval verdict. A completed review can mean findings posted or uncommitted fixes; report a PR ready only when Stamp approves the current head, CI passes and no review thread remains open. Read [results and status](/shepherd/guides/results/) for these distinctions.
