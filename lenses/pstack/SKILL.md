---
name: pstack
description: pstack's engineering principles as code review rules. Flags changes that work against the principles pstack-driven agents are told to follow. Covers a symptom patched where the fault surfaced, guards that hide a state that should never exist, validation scattered past the boundary, raw external data trusted without a parse, interchangeable primitives, domain rules spread across conditionals, one-caller layers and wider mutable state, old APIs kept beside their replacement, steps that break when run twice, shared write targets, tests that cannot fail or are pinned to internals, and numbers or claims the PR states without evidence. Use as a review lens or as a stamp rule pack.
---

# pstack

These rules come from the principles in
[pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan
(MIT). A team whose agents work through pstack's `poteto-mode` gets reviews
that check the same principles. Review whether the change fixes faults where
they start, keeps checks at the boundary, lets the types and data structures
carry the domain, and proves what it claims.

## Review

- **fix-root-cause**: A fix changes the first place the system went wrong, not the place the symptom showed. Flag: a guard, retry, clamp, default value or swallowed error added where a bad state surfaced, when nothing shows that state is legitimate; the same fault left in sibling code the fix did not touch; a workaround justified by a long comment. Why: a symptom fix hides the evidence and the fault surfaces somewhere else.
- **boundary-checks**: Input is validated and parsed into typed values where it enters (CLI arguments, config, environment, network, files, database rows, model output), and trusted inside. Flag: external data used without a parse at the point it enters; the same value re-checked deep in a call chain the boundary already checked; a transport, storage or framework type exposed through the module's public surface. Why: scattered checks are noisy, and the one that matters is missing.
- **types-carry-meaning**: Two values that share a primitive but mean different things cannot be swapped, and a union is handled exhaustively. Flag: two same-typed parameters that are easy to pass in the wrong order (`userId, orderId: string`); a switch over a union with no exhaustiveness check; a hand-written type that duplicates one a schema, migration or spec already owns. Why: the compiler can catch these and a reviewer often cannot.
- **model-the-domain**: The domain lives in one structure: a state machine, discriminated union, lookup table or typed model. Flag: a new branch added to an existing if/else chain over the same kind of value; a second boolean that must stay in sync with a first; the same domain rule repeated across phase-named modules. Why: every new case adds another place to forget.
- **reader-load**: Each layer the change adds hides a real decision, and state lives in the smallest scope. Flag: a wrapper or adapter with one caller and no second implementation; a layer that repeats the methods and arguments of the one below; a new module-level or shared mutable field where a local or a return value would do; a value kept in sync by hand where it could be derived. Why: readers trace every layer and hold every piece of state.
- **subtract-first**: The change adds no code for needs nobody has shown. Flag: a validator, option, parameter or extension point with no caller; a stub, placeholder or reference with no content; new code beside dead code it could have replaced. Why: speculative code costs every future reader and is rarely the shape the real need takes.
- **delete-legacy**: A replaced API is removed in the same change once its callers move. Flag: an old function, flag or code path kept beside its replacement with no external user named; a compatibility shim inside one repository; tests that only protect the old implementation. Why: two ways to do one thing become two things to maintain, and agents copy the old one.
- **idempotent-steps**: A step that changes state converges when it runs twice or after a crash partway through. Flag: a migration, job, command or handler that inserts, appends or sends without checking what already exists; a lock, temp file or claim marker the next run cannot recognise as stale; a write to a final path that a crash can leave half written. Why: retries and restarts are normal, and each one becomes a debugging session.
- **separate-shared-state**: Concurrent actors do not share a mutable target unless one shared target is a real invariant, and then access is serialised by structure. Flag: two workers, requests or agents writing the same file, key, row or branch; a race handled by a comment or convention; a lock added where separate owned targets would remove the sharing. Why: races are intermittent and expensive to find.
- **tests-catch-breaks**: A test fails when the behaviour it covers breaks and survives a refactor that keeps that behaviour. Flag: an expected value computed by the code under test; an assertion looser than the contract; a test that only checks data it built itself; an assertion on private helpers or call order where the user-visible result is the contract. Why: a test that cannot fail proves nothing, and one pinned to internals breaks on every refactor.
- **prove-the-claim**: What the PR description claims about behaviour or performance has evidence in the PR. Flag: a stated speedup, fix or "verified" with no test, script, run output or measurement behind it; a benchmark number with no run count, spread or named limiter. Why: an unverified claim reads the same as a true one.

## Fix

- Prefer: the repository's existing parse functions, branded types, state structures and test helpers, found in code next to the change.
- Never touch: tests that the change did not add, to make a rule pass.
- Escalate: deleting a legacy API that code outside the diff still calls, introducing a new domain structure across modules, and any `prove-the-claim` finding: the evidence has to come from the author.
