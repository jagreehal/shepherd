---
"@jagreehal/shepherd": minor
---

The review reads `CODING_STANDARDS.md` and the other house rules at the root and in every directory above a changed file, so `ui/CODING_STANDARDS.md` adds rules for `ui/` and wins where it disagrees with the root. Markdown files they link to inside the repository are read too, from the default branch. A `CODING_STANDARDS.md` breach posts as a line comment quoting the rule, on an approval too, so triage fixes it; it never changes the verdict.

A `thermo-nuclear` lens pack adapts Cursor's strict maintainability review: a reframing that would remove new branches, special cases in unrelated flows, growth of files over 1000 lines, one-call wrappers, casts and silent fallbacks, logic outside its owning layer, and half-applied updates. Every rule is a note. It is the optional, stricter pass: a rule a team wants fixed on every PR belongs in `CODING_STANDARDS.md` instead, not in both.
