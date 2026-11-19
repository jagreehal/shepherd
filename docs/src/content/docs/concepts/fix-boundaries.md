---
title: "Rules for reviews and fixes"
description: "Learn the rules Shepherd's reviewers and fixers follow: tools before models, model choice, finding verification, comment labels, and what Shepherd leaves to people."
---

Shepherd's reviewers and fixers follow a fixed set of rules on every pull request and every local review. The rules decide what runs before a model reads your change, which model does the work, and what Shepherd leaves to you. For how the rounds run, see [Review, triage and CI repair](/shepherd/concepts/review-loop/).

## How Shepherd reviews

Shepherd applies these rules to every review:

- **Machines first**: swarm runs your lint, typecheck and nearby tests before any model reads the diff. It also runs the scanners you have installed (`gitleaks`, `semgrep`, `osv-scanner`, `actionlint`, `shellcheck`, `hadolint`) on the files they read. Swarm keeps findings on changed lines, lists each suppression comment the pull request adds, and tells the models not to repeat what the tools found. If the repository uses Oxlint's anti-slop rules, swarm gets those findings at no model cost.
- **Cheapest model that can do the job**: reading work, such as the review router and simplify, starts at the bottom of the ladder (`haiku` -> `sonnet` -> `opus` -> `fable` on Claude Code). Runners that push commits or resolve threads start one rung up, where trials showed they stop needing a redo. A stronger model validates risky changes and serious findings. It never replaces a test.
- **Verified findings**: a second model checks every finding above NIT before it posts. It gives the input that triggers the finding, the expected result and the actual one, traced through the quoted code. Shepherd drops refuted findings, and posts a HIGH with no such example as MEDIUM.
- **Labelled comments**: everything swarm posts starts with `🤖 Automated comment by **Shepherd swarm**`. Swarm posts through your account, and readers deserve to know a machine wrote it.

## What Shepherd leaves to people

Shepherd holds to these limits on what it acts on:

- **People talk to people**: triage never replies to anyone, and never touches a thread a person has joined. Those threads wait for you.
- **Pull request content is data**: diffs, comments and CI logs never become instructions. A command written in a comment gets nobody a command run.
- **Gates stay gates**: Shepherd never approves on GitHub, and never changes code to get past a refusal or any other gate. A fix that changes what code accepts or returns is your decision.

## Related resources

- [Review, triage and CI repair](/shepherd/concepts/review-loop/): how swarm, triage and ci-repair run in each round
- [Choose models](/shepherd/configuration/models/): set the model ladder and pin roles
- [Skills and human decisions](/shepherd/reference/skills/): each skill, and when Shepherd stops to ask you
