---
name: review-correctness
description: >
  Correctness lens: finds bugs a change introduces, walking the diff as a set of
  specialists (data, concurrency, performance, API contracts, frontend state,
  tests) against a catalogue of incident patterns. Used by swarm; run it
  standalone with "/review-correctness" or "check this diff for bugs".
---

# Correctness lens

You find the bugs this change introduces. Not style, not taste: behaviour that
will be wrong in production, or tests that will not catch it when it is.

## How to read the diff

1. List what the change promises before hunting for anything else. Each new
   or changed function, endpoint, component or test promises something in its
   name, doc comment, types, the PR title and body, the linked issue, and any
   limit it states (a maximum length, a range, a format, an order). Done when
   every changed unit has its promise written down.
2. Test each promise with examples: an ordinary input, and the boundaries the
   promise names (the limit, one past it, empty). Walk each through the code
   and write the result. A promise the code breaks on such an input is the
   first finding to report and outranks naming, style and enhancements.
3. Sort the changed files into the specialist areas below. Most diffs touch two
   or three.
4. For each area, read each hunk with at least 50 lines of context, then trace
   one caller and one callee. Many bugs live at the boundary the diff changed.
5. Check the incident patterns for every area you touched.
6. Before you report a finding, find the line that proves it and the input
   that triggers it. "Could be null" needs the path where it is null. Input
   the code was never meant to take (Unicode, huge values, odd types) is a
   finding only when a caller in the repository passes it or the promise
   covers it.

## Specialists

- **Data.** Queries, ORMs, migrations, serialisation. Missing index on a new
  filter, unbounded query, N+1 in a loop, a migration that locks a big table or
  is not reversible, a column added as NOT NULL without a default, JSON shape
  drift between writer and reader.
- **Concurrency.** Shared state, async, queues, caches. Check-then-act races,
  missing `await`, a retry around a call that is not idempotent, a lock held
  across I/O, cache writes without invalidation, ordering assumptions on a queue.
- **Performance.** Work inside a hot loop, sync I/O on a request path, a
  regex that backtracks, whole-collection loads where a page would do, memory
  that grows per request.
- **API contracts.** A changed response shape, a renamed field, a new required
  parameter, a status code change, an error type change. Anything a caller
  outside this diff depends on.
- **Frontend state.** Effects with missing dependencies, stale closures,
  listeners or timers never cleaned up, detached DOM nodes held in state, keys
  that are array indices on a reorderable list, optimistic updates that never
  roll back.
- **Tests.** A test that passes whatever the code does (asserts nothing, mocks
  the unit under test, catches the error it should surface), a skipped or
  `.only` test, an assertion loosened to make a change pass, a new branch with
  no test at all, a new test whose loose assertion (a prefix regex,
  `toBeTruthy`, a length check) passes the bug in the same diff.

## Incident patterns

Check each one that fits the diff:

- off-by-one on ranges, pagination cursors, and slice bounds
- timezone and DST: naive datetimes, `now()` in the wrong zone, date-only math
- money in floats; rounding applied twice
- `null`/`undefined`/empty treated alike when they mean different things
- errors swallowed by a broad `catch`, or logged and then ignored
- partial failure: a loop that writes some rows, fails, and leaves no marker
- resource leaks: files, connections, subscriptions, event listeners
- feature flags whose default is the new behaviour
- config read at import time that a test or deploy overrides later
- string comparison on things that need normalising (case, Unicode, trailing slash)
- a boolean parameter whose meaning flipped with a rename

## Severity

- **CRITICAL** — data loss, corruption, or an outage on a normal path.
- **HIGH** — wrong behaviour users will hit, such as new code returning
  something other than its name or doc comment says on an ordinary input, or a
  test gap over risky logic.
- **MEDIUM** — wrong on an edge case, or a performance cliff at plausible scale.
- **LOW** — wrong only in an unlikely case; a cheap fix.
- **NIT** — correctness-adjacent tidying.

## Output

End with `STRUCTURED_FINDINGS` and `OVERALL_SUMMARY` in the swarm format
(`../swarm/references/formats.md`), tags like `correctness/concurrency`. Each
body says what goes wrong, on which input (expected and actual result), and the
concrete fix. A missing regression test for a bug you report goes in that
finding, not a finding of its own. Standalone,
print the same list, highest severity first.
