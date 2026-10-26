# Review accuracy evaluation

This directory measures how well swarm's reviews find bugs, so you can compare
skill edits and model choices by precision and recall.

A **case** freezes a change and the bugs a person confirmed in it. A **run** is
one `swarm --local` review of a case, kept with the findings its local record
holds, the Shepherd version and commit, the agent command (and with it the
model), the cost and the duration. `shepherd eval score` credits a finding to
a bug only when it sits near the bug and names it, and reports precision and
recall per configuration.

## Run it

```bash
# one configuration, three reviews per case
shepherd eval run evals/cases --config sonnet --repeat 3 -- \
  claude -p "/swarm --local --base {base}" --model sonnet --output-format json

shepherd eval score evals/runs          # --json for the rows
```

`{base}` and `{head}` in the agent command are filled in per case. Each review
runs in a fresh clone of the case's head under `$TMPDIR`, so no PR comment,
earlier review or local edit can reach the reviewer. Runs land in
`evals/runs/<config>/<started-at>/<case>-<n>.json`, a directory per invocation
so a later run never overwrites an earlier one (`--out` to move them; the
directory is ignored by git). Each run records the Shepherd version, commit and
a hash of the skill text; scoring refuses a label whose runs used different
skill text, so give the before and after of an edit different labels. The cost is read from the agent's JSON output when it reports
`total_cost_usd`.

The agent needs permission to run the shepherd CLI and read files in the clone
without prompting; give it the narrowest permission mode your harness has.

## Read the scores

- **recall**: bugs found / bugs, over every run. A run that did not complete
  found nothing.
- **precision**: bugs found / findings above NIT, over completed runs.
  Duplicates of a bug already found count against it, because the author reads
  them too.
- **fp / near / dup**: findings credited to no bug; of those, the ones beside a
  bug that named none of its patterns (read them: a naming complaint, or a right
  finding in words `match` did not foresee); and repeats of a bug already found.
- **incomplete**: runs whose record was missing, not JSON, invalid or
  incomplete. They are kept, never read as a clean review.
- **per_bug** (in `--json`): how often each bug was found across repeats. A bug
  found in one run of three is luck, not coverage.
- **pick**: on held-out cases, the cheapest configuration whose recall and
  precision are both within 0.05 of the best. It names none, and says why,
  until every configuration ran the same cases the same number of times, every
  run completed and reported its cost, and one configuration is close to the
  best on both scores; a pure trade-off is a person's call.

A finding is credited to a bug when it names one of the bug's files within 3
lines of its range and its body matches one of the bug's `match` patterns. A
false positive may be a real bug nobody listed: check it, and if it holds, add
it to the case with how you confirmed it.

## Splits

`dev` cases are for tuning: read their findings, change a skill, run again.
`heldout` cases are for deciding: read only the totals, never edit a skill
because of what one held-out run said, and compare configurations on held-out
scores alone. A held-out case whose findings someone tuned against moves to
`dev`.

## Add a case

One directory per case under `cases/`, holding `case.json`:

```json
{
  "id": "short-kebab-name",
  "split": "dev",
  "source": { "repo": ".", "base": "<full sha>", "head": "<full sha>" },
  "bugs": [
    {
      "id": "what-breaks",
      "claim": "The input, what the code should do on it, and what it does.",
      "checked": "How a person confirmed it: a reproduction, a failing test, the fix commit.",
      "at": [{ "file": "src/a.ts", "lines": [10, 12] }],
      "match": ["off.by.one", "last page"]
    }
  ],
  "note": ""
}
```

- `repo` is a git URL, or a path from the top of the repository holding the
  case ("." for this one). `base` and `head` are full SHAs: a branch moves.
  Tag a head that no branch holds (`eval/<case id>`) and push the tag, so
  every clone can reach it.
- Every bug is confirmed by hand, never by a review bot's say-so. `at` lists
  each place a finding may anchor on it, on the head side. `match` lists
  case-insensitive regular expressions, one of which a finding's body must
  contain to name this defect: words for the defect itself, never for the code
  around it, so a complaint about something nearby is not credited. "already"
  alone matches "the loop already explains itself"; "suggestion ... already
  contains the fix" names the bug. `src/eval.test.ts` holds a finding that
  names each shipped bug and decoys that must not; add both for a new bug.
- A clean change has `"bugs": []`. Keep some: they are the only measure of
  false positives on code that is right.
- `{"demo": true}` as the source reviews `shepherd local demo`, whose planted
  bugs come from `examples/local-demo/expected.json`.

Keep cases small and real: a bug that shipped and was fixed, the PR that
introduced it as the pair. Grow held-out first; a handful of held-out cases
says little.
