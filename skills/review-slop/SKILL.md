---
name: review-slop
description: >
  Slop lens: flags low-signal code and prose that coding agents tend to produce:
  types widened then asserted back, defensive checks the types already rule out,
  comments that narrate code, tests that prove nothing, and PR text padded with
  filler. Used by swarm; run it standalone with "/review-slop" or "check this
  diff for AI slop".
---

# Slop lens

Slop is code or text that looks finished but carries little evidence: it
compiles, it reads smoothly, and it hides what it does or whether it works.
Agents produce it fast, so it needs its own lens.

If the repo runs a lint rule that already catches a pattern (for example
Oxlint's anti-slop plugin), swarm's check step has reported it. Do not repeat
those. This lens covers what lint cannot see, and every language lint does not
cover.

## Code

**Type evidence thrown away**

- A value widened to `any`, `unknown`, `object`, or a base type, then asserted
  back to the specific type a few lines later.
- Chained assertions (`x as unknown as T`) and assertions with no comment naming
  the invariant that makes them safe.
- `unknown` parameters or return types on internal functions where the real
  type is known.
- Runtime `typeof` checks on values the static types already pin down.
- `Record<string, T>` or index signatures used where a fixed set of keys exists.

**Defensive noise**

- `try/catch` that logs and continues, or rethrows the same error unchanged.
- Null checks and fallbacks for states the code cannot reach.
- Guard clauses duplicated at every layer instead of at the boundary.
- Retries, timeouts, or caches added with no failure they answer.

**Shape without substance**

- Names that describe the data's shape instead of its meaning (`dataObj`,
  `resultArray`, `mapOfItems`).
- A single-use options object where plain parameters read better, or a
  parameter bag passed through five layers untouched.
- `filter().map()` chains and `reduce` with a copied accumulator where one loop
  or one `flatMap` reads cleaner.
- Helpers, wrappers, or files created for one caller.
- Conditional empty spreads (`...(x ? {a} : {})`) built up into a config object.

**Tests that prove nothing**

- Assertions that cannot fail: `expect(x).toBeDefined()` after assigning `x`,
  snapshot tests of mocks, `>= 0` on a count.
- Module mocking that replaces the unit under test.
- Test names that describe the implementation instead of the behaviour.

**Comments**

- Comments that narrate the next line, restate a function name, or describe a
  change history ("now uses X instead of Y").
- Apology or hedge comments ("this is a workaround", "not ideal") with no
  ticket and no reason.

## Prose

Read the PR title and body, new docs, and commit messages in the diff. Flag:

- filler openers and closers ("This PR...", "In summary", "Let's dive in")
- adverbs doing no work ("significantly", "seamlessly", "robustly")
- binary contrasts ("not just X, but Y") and rhetorical setups
- vague claims with no specifics ("improves performance") where a number or a
  named behaviour belongs
- em-dash chains and triplet lists used for rhythm
- claims the diff does not back: a body that says "adds tests" on a diff with
  none is a HIGH finding, because reviewers and `stamp` trust the body

## Severity

- **HIGH** — slop that hides a bug or misleads a reviewer: an assertion that
  makes an unsafe cast compile, a test that cannot fail on a risky path, a PR
  body claiming work the diff does not contain.
- **MEDIUM** — thrown-away type evidence or defensive noise on a real code path.
- **LOW** — naming, comment, and structure slop.
- **NIT** — prose style.

## Output

End with `STRUCTURED_FINDINGS` and `OVERALL_SUMMARY` in the swarm format
(`../swarm/references/formats.md`), tags `slop/types`, `slop/defensive`,
`slop/shape`, `slop/tests`, `slop/comments`, `slop/prose`. Each body quotes the
line and shows the plain version.
