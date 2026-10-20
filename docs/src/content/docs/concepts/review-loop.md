---
title: "Review, triage and CI repair"
---

## One iteration

```mermaid
flowchart TD
    S[Resolve the PR] --> Q[Quality round]
    subgraph Round["Quality loop, up to 4 rounds"]
        Q --> SW[swarm: review]
        SW --> TR[triage: work every thread]
        TR --> SI[simplify]
        SI --> DRY{Dry round?}
        DRY -- no --> Q
    end
    DRY -- yes --> CI[ci-repair]
    CI --> V[stamp verdict]
    V --> SUM[Summary and<br/>commit status]
```

A round is dry when triage fixed, resolved and promoted nothing, simplify changed nothing, and no bot review is still on its way. On a repo with Claude Code Review, shepherd reads its check run to know when the review finished or did not run, fixes 🔴 Important and 🟡 Nit findings like any bot finding, and leaves 🟣 Pre-existing ones to you as follow-ups. Round 1's fixes always get a second review round. In GitHub Actions an iteration runs one round, since swarm cannot comment on commits that are not pushed yet; the next iteration reviews them after the push.

## Stacked PRs and wrong bases

Before it writes the round's diff, the loop runs `shepherd stack <pr>`:

- **Stacked on an open PR** into the same base: swarm reviews only this PR's change over the parent's head and posts nothing on the parent's lines, so a stack of three PRs gets three focused reviews, never one change reviewed three times. stamp holds its approval until the parent is approved, so the loop finishes `pending`, waiting on the parent.
- **Wrong base**, most commits already on another long-lived branch (`main`, `master`, `develop`, `release`, `release/*`, `staging`): the loop reviews nothing, sets `failure` and names the retarget command, `gh pr edit <pr> --base <branch>`.

stamp runs the same detection; see its [stacked PRs guide](https://jagreehal.github.io/stamp/guides/stacked-prs/).

## The review swarm

```mermaid
flowchart LR
    D[Diff] --> CK[Repo checks and installed scanners:<br/>lint, typecheck, nearby tests,<br/>gitleaks, semgrep, osv-scanner and more]
    CK --> RT[Cheap router review]
    RT --> L1[review-correctness]
    RT --> L2[review-security]
    RT --> L3[review-simplicity]
    RT --> L4[review-maintainability]
    RT --> L5[review-slop]
    RT --> L6[review-spec<br/>when an issue or spec is linked]
    RT --> LT[Your team's lenses]
    L1 & L2 & L3 & L4 & L5 & L6 & LT --> VF{HIGH or CRITICAL?}
    VF -- yes --> V2[Second model quotes<br/>the code or drops it]
    VF -- no --> P
    V2 --> P[Inline comments<br/>and one summary comment]
```

The router hands risky hunks to the lenses in parallel. The lenses don't repeat what the tools already found.

## Triage

```mermaid
flowchart TD
    T[Open review thread] --> H{A human has joined?}
    H -- yes --> W[Leave it for you]
    H -- no --> J{Judgement}
    J --> F[Fixed, with a commit]
    J --> R[Resolved]
    J --> DF[Deferred]
```

Triage ends each thread fixed, resolved or deferred. It never replies and never touches a thread a person is in.
