---
"@jagreehal/shepherd": minor
---

The review reads `CODING_STANDARDS.md` with the other house rules from the default branch, at the root and in every directory above a changed file. The nearer file wins. Markdown files those rules link to inside the repository are read too. A `CODING_STANDARDS.md` breach posts as a line comment on any verdict, including an approval, so triage can fix it. On a stacked PR the breach is listed in the review only: GitHub cannot anchor a line comment to the parent-relative diff.

A `thermo-nuclear` lens pack adds a maintainability pass as notes: reframes that remove new branches, special cases in unrelated flows, growth past 1000 lines, one-call wrappers, casts and silent fallbacks, logic outside its owning layer, and half-applied updates. Rules a team wants fixed on every PR belong in `CODING_STANDARDS.md`.

The PR comment is the quick view: earlier rounds listed open, folded sections name their reason, coding standards open on an approval, and a link to the run's full summary. The full summary opens every section, lists the house-rule files that applied, and opens the fix-with-an-agent prompt. Gate denials list earlier rounds too. House rules are read once per review in `gate/src/house-rules.ts`. An `@` that could start a mention in model text gets a zero-width space, so `@returns` notifies no one.
