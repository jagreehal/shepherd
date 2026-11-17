# Coding standards

The review reads this file and comments on each breach in a PR's added lines;
triage fixes them. Lint already enforces casts, `unknown`, object parameters
and file length (`.oxlintrc.json`), so none of that is repeated here.
A `CODING_STANDARDS.md` in a subdirectory adds rules for the files under it.

- **No flag parameter for one caller.** A boolean or mode parameter added to an
  existing function so one caller can skip or change a step is a second
  function, or a step the caller does itself.
- **No special case in an unrelated flow.** A new `if` for one kind of PR,
  thread, lens or backend inside a loop or handler that treated them all alike
  goes behind its own function, or becomes the default for all of them.
- **Reuse the helper that owns the concept.** Read `.shepherd/` policy files
  with `readTrusted` (`gate/src/policy.ts`) and house rules with
  `readHouseRules` (`gate/src/house-rules.ts`); they differ on purpose, since
  only policy falls back to shepherd's bundled defaults. Call GitHub through the
  functions in `gate/src/github.ts`, and anchor line comments with
  `anchoredIssues` (`gate/src/inline.ts`). A second copy of one of those is a
  breach; name the existing helper.
- **A file near 1000 lines grows only by extracting.** Lint fails a file over
  1000 lines (blank lines and comments excluded). A change that adds lines to a
  file within 50 of that limit extracts a cohesive part in the same PR rather
  than adding to it.
- **Fewer concepts, not moved ones.** A refactor that moves branches or
  helpers to another file without removing any is not a simplification; say
  what it removes.
