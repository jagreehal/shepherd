# Formats

## Narration

Before every step, one line: `[shepherd] <step> — <what and why>`. A silent gap
of more than about 30 seconds is the failure to avoid. Relay each runner's
narration verbatim, adding the round number inside the quality loop.

```
[shepherd] step 1 — PR #42 is a draft; marking ready and expecting bot reviews
[shepherd] step 2 round 1 — diff touches src/api.ts; running swarm
[shepherd] step 2 round 1 — [triage] step 5 — fixed missing await in src/api.ts:88 (a1b2c3d)
[shepherd] step 2 round 2 — dry after round 2; quality loop converged
[shepherd] step 3 — ci-repair against d4e5f6a
[shepherd] step 4 — stamp: approved at d4e5f6a
[shepherd] iter done — handing back
```

## Iteration summary

```
[shepherd] iter done — sha=<short> models=<swarm:m,triage:m,simplify:m,ci:m,validators:[m]> swarm=<ran|skip> rounds=<n> actioned=<n> resolved=<n> promoted=<n> simplify=<changed n|clean> deferred=<n> ci=<pass=N pending=N fail=N> repair=<committed|none|blocked> rerun=<n> stamp=<applied|already|all-prs|absent> verdict=<approved|refused|escalate|pending|n/a> stopped=<converged|round-cap>
```

Counts sum across rounds. CI counts are the snapshot before any repair push.
Under the line, list deferred threads (`file:line`, one-line reason), promoted
fixes with their alternative, fixed CI root causes, queued reruns, unresolved CI
failures, and any degradation taken. If stamp refused or escalated, print its
reason.

## State line

```
[shepherd] state — swarm_marker_sha=<sha|null> simplify_marker_sha=<sha|null> stamp_applied_for_sha=<sha|null> deferred_threads=[<id>,...] last_updated_at=<iso|null>
```

Take `last_updated_at` from Step 4's verdict read, which runs after every push
this iteration made.

## Final summary (terminal conditions)

- commits pushed, with short SHAs and messages
- threads resolved, grouped fixed / nit, each with its SHA or reason (resolves
  carry no reply, so this list is the only record)
- threads deferred, with `file:line` and reason
- final CI state, stamp verdict, and PR merge state
