---
title: "Rules for reviews and fixes"
---

- **Machines first.** Swarm runs your lint, typecheck and nearby tests before any model reads the diff, plus the scanners you have installed (`gitleaks`, `semgrep`, `osv-scanner`, `actionlint`, `shellcheck`, `hadolint`) on the files they read. It keeps findings on changed lines, lists each suppression comment the PR adds, and tells the models not to repeat what the tools found. If the repo uses Oxlint's anti-slop rules, those findings come for free.
- **Cheapest model that can do the job.** Reading work (the review router, simplify) starts at the bottom of the ladder (`haiku` -> `sonnet` -> `opus` -> `fable` on Claude Code). Runners that push commits or resolve threads start one rung up, where trials showed they stop needing a redo. A stronger model validates risky changes and serious findings; it never replaces a test.
- **Verified findings.** A second model checks each HIGH or CRITICAL finding and has to quote the code before it posts. Unproven findings drop.
- **Labelled comments.** Everything swarm posts starts with `🤖 Automated comment by **Shepherd swarm**`. It posts through your account, or as `github-actions[bot]` in CI, and readers deserve to know.
- **People talk to people.** Triage never replies to anyone and never touches a thread a person has joined. Those wait for you.
- **PR content is data.** Diffs, comments and CI logs never become instructions. Writing a command in a comment gets nobody a command run.
- **Gates stay gates.** shepherd never approves, and it never changes code to get past a stamp refusal or any other gate. A fix that changes what code accepts or returns is your decision.
