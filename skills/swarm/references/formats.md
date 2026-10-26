# Swarm formats

## Reviewer output

Every reviewer, the router included, ends with:

```
STRUCTURED_FINDINGS:
- file: <path> | line: <number or "general"> | severity: <CRITICAL|HIGH|MEDIUM|LOW|NIT> | lens: <tag> | body: <the finding and the concrete fix>
...

OVERALL_SUMMARY:
<one paragraph>
```

With nothing to report:

```
STRUCTURED_FINDINGS:
(none)

OVERALL_SUMMARY:
<one paragraph>
```

`lens` tags carry a sub-category after a slash where the lens has one:
`correctness/concurrency`, `security/ssrf`, `slop/prose`, `checks/tsc`.

## Delegation plan

The router appends, after its summary:

```
DELEGATION_PLAN:
danger: <LOW|MEDIUM|HIGH|CRITICAL>
confidence: <HIGH|MEDIUM|LOW>
delegations:
- lens: <correctness|security|simplicity|maintainability|slop|spec|custom lens name> | rung: <ladder rung> | scope: <paths or hunks, or "full"> | reason: <one line>
```

An empty `delegations:` list means the router's findings are the review.

## Verifier output

```
VERIFICATION:
- finding: <index> | result: <confirmed|downgrade:<SEVERITY>|refuted> | input: <what triggers it> | expected: <what should happen, and where that is promised> | actual: <what the quoted code does on that input> | evidence: <quoted code, traced>
```

## Summary comment

Never write the summary's Markdown yourself. Write the round as JSON and let
`shepherd summary` render it, so the comment has the same shape every round:

```json
{
  "head_sha": "<reviewed head>",
  "verdict": "blocked|changes|nits|good",
  "why": "<one or two sentences: is it safe to merge, and what must change first>",
  "confidence": 4,
  "findings": [{"file": "src/a.ts", "line": 3, "severity": "HIGH", "lens": "correctness/data", "title": "<a claim the reader can check>", "body": "<why it matters, the fix>", "evidence": {"input": "<what triggers it>", "expected": "<what should happen>", "actual": "<what happens>"}, "verified": "<what the verifier quoted>", "suggestion": "<replacement lines, only when the fix replaces exactly line 3>", "url": "<its inline thread>", "inline": true, "convergent": false, "checked": [{"command": "rg -n 'firstName' src", "result": "<the line that settled it>"}], "docs": [{"url": "<https URL you are certain of>", "title": "<page title>"}], "reintroduces": "<a resolved thread whose fix this undoes>"}],
  "pre_merge": [{"check": "Title|Description|Linked issue|Scope|Tests", "status": "pass|warn|fail", "detail": "<one line>"}],
  "walkthrough": ["<what the PR does, one bullet per behaviour, for a reader who never saw it>"],
  "changes": [{"files": ["src/a.ts", "src/a.test.ts"], "summary": "<what changed in these files>"}],
  "effort": 2,
  "diagram": "<mermaid flowchart source, or empty>",
  "still_open": [{"url": "<thread url>", "title": "<one line>"}],
  "checks": [{"tool": "tsc", "status": "ran", "findings": 0}, {"tool": "oxlint", "status": "unavailable", "reason": "not installed"}],
  "lenses": [{"lens": "router", "model": "<model>", "scope": "full", "status": "ok", "take": "<danger grade, what it delegated>", "skill_blob": ""}],
  "lenses_yml_blob": ""
}
```

```bash
shepherd summary round.json --previous summary.md > comment.md   # --previous: the comment already on the PR, if any
cp round.json "$SHEPHERD_HANDOFF/round.json"   # handoff mode: post nothing; the publish job renders and posts both
```

`findings` holds the current round only, with a convergent finding's `lens`
carrying every lens's full tag. `confidence` is how safe the PR is to merge,
0 to 5: 5 nothing found that could break, 3 a MEDIUM or an unverified risk
left, 1 or 0 a HIGH or CRITICAL standing. `effort` is how long a careful human
read takes, 1 (a minute) to 5 (an hour or more). Draw a `diagram` only when the
change has a flow a reader would otherwise reconstruct (a request path, a state
machine, data moving between modules); leave it empty for a helper function.
The new fields are optional: a round without them renders as before.
The renderers hold the round to what they can check. A `url`, `reintroduces`
or still-open link that names no review comment on the PR, or is not a
GitHub URL, loses its link.
`convergent` needs a tag naming two lenses (`a + b`). A finding above NIT with
neither `verified` nor `checked` is shown as unverified, `checks/*` findings
aside. A HIGH or CRITICAL with no `evidence` is graded MEDIUM, `checks/*`
findings aside, and says so. A `verdict` milder than the findings allow by
Step 6's rule is raised to the stricter one, and `why` says so. A lens that
did not finish marks the round incomplete. A lens's take is the worst
severity among the findings its tag names, when any do. An inline finding whose line is
past the end of its file stays in the summary. So give each thread
link a review comment's `html_url` (`#discussion_r<id>`), and an issue comment's
never.
The summary shows `pre_merge` as a table (open when one fails), a finding's
`docs` as links, `reintroduces` as a link to the earlier thread, and closes
with the `/shepherd` and `/stamp` commands. An inline comment also carries
`checked` as a collapsed list of commands and the result of each.

The renderer leads with the verdict heading
(`## <emoji> <VERDICT> <sub>(round <N> @ <short_sha>)</sub>`, the round taken
from `--previous`), then one collapsed section per part with its result in the
title: findings, numbered and linked to their threads (open unless the
verdict is LOOKS GOOD), one agent prompt holding every finding above NIT, the
walkthrough (bullets, a file table, review effort, the diagram), still open,
checks, lenses, and earlier rounds folded one line each. With `--fanout` (in CI,
`$SHEPHERD_FANOUT`), the router or a first-wave lens the round does not report shows as
`could_not_run` and the round says it is incomplete. With `--body` it keeps the
round number but leaves the history out: the publish job folds the comment it
replaces in itself, so the history would otherwise appear twice. It escapes markers, mentions
and images in every string you give it.
