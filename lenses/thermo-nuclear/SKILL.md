---
name: thermo-nuclear
description: A strict maintainability review as code review rules. Flags changes that work but leave the code harder to reason about. Covers a restructuring that would make new branches disappear, special cases dropped into unrelated flows, growth of files already over 1000 lines, wrappers and generic mechanisms that add a concept without removing one, casts and silent fallbacks hiding an unwritten invariant, logic outside the layer that owns it, and orchestration that can leave state half applied. Use as a review lens or as a gate rule pack.
---

# thermo-nuclear

These rules come from Cursor's
[thermo-nuclear-code-quality-review](https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review)
skill (MIT). No codebase dies from one bad pull request; it dies from two
hundred reasonable ones. Review this change as the one that decides whether
the file is still readable. They apply to production code. In teaching
material (tutorials, courses, example repos, katas) flag only unclear names
and examples that do not teach what they claim; in throwaway code (spikes,
prototypes, scripts with a delete date) flag nothing here.

## Review

- **code-judo** [note]: Where a different state model or ownership boundary would make the change's new branches, helpers, modes or layers unnecessary, say so. Flag: a change defensible at every line that leaves the file with more concepts than before; a refactor that moves complexity without lowering the concept count. Why: complexity moved is still there, and the reframing gets harder with every PR that builds on it.
- **spaghetti-growth** [note]: A special case lives behind its own abstraction, or becomes the default flow, instead of a branch in a flow that had nothing to do with it. Flag: a boolean parameter added to an existing function so one caller can skip a step; an `if (isNewThing)` inside a loop or handler that knew nothing about that thing; another branch in an already busy conditional. Why: each branch is reasonable alone, and together they make the flow unreadable.
- **file-size** [note]: A hand-written source file over 1000 lines does not grow. Flag: any added lines in such a file, whether it crossed 1000 in this change or long ago, unless the change extracts the cohesive part first. Exception: generated code, snapshots, fixtures, lockfiles, migrations and vendored source. Why: a 3000-line file growing to 3040 is the same problem as a 990-line file growing to 1010.
- **boring-code** [note]: Direct code beats magic. Flag: a generic mechanism hiding a simple data shape; a thin wrapper, identity abstraction or pass-through helper over a single call. Exception: a dispatcher or policy object that replaces several scattered conditionals earns its place; when this rule and code-judo disagree, prefer whichever leaves fewer concepts in the reader's head. Why: indirection without clarity is one more layer to trace.
- **explicit-boundaries** [note]: An invariant is written down as a type, not papered over. Flag: `as unknown as T` or a run of casts; `any` or `unknown` passed inward; an optional parameter that almost every caller passes; a `?? []` or `|| default` hiding whether a value can be absent. Why: a named type makes the control flow shrink, and a silent fallback turns a bug into wrong output.
- **canonical-layer** [note]: Logic lives in the module that already owns its concept. Flag: feature logic added to a shared path; implementation details exposed through a public API; a new helper duplicating one the repository already has, naming the existing helper's path. Why: two copies drift, and agents copy whichever they find first.
- **brittle-orchestration** [note]: Related updates cannot leave state half applied, and independent work is not chained for no reason. Flag: several writes that must all happen, done in sequence with no transaction, rollback or idempotent retry; independent awaits serialised where running them together is also simpler to read. Exception: micro-optimisation alone. Why: a half-applied update is a state no code expects.

## Fix

- Prefer: the smallest restructuring that removes the new branch or wrapper, using helpers and types already in the repository next to the change.
- Size the fix to the diff: a restructuring larger than the change is a follow-up the review names, never part of the fix.
- Never touch: files outside the diff to make a rule pass, and never split a file only to get under 1000 lines without separating a cohesive part.
- Escalate: a new state model or ownership boundary across modules, and moving logic between packages.
