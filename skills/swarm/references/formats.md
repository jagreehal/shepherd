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
- finding: <index> | result: <confirmed|downgrade:<SEVERITY>|refuted> | evidence: <quoted code or one-line reason>
```

## Summary comment

Never write the summary's Markdown yourself. Write the round as JSON and let
`shepherd summary` render it, so the comment has the same shape every round:

```json
{
  "head_sha": "<reviewed head>",
  "verdict": "blocked|changes|nits|good",
  "why": "<one or two sentences on why>",
  "findings": [{"file": "src/a.ts", "line": 3, "severity": "HIGH", "lens": "correctness/data", "body": "<finding and fix>", "convergent": false}],
  "still_open": [{"url": "<thread url>", "title": "<one line>"}],
  "checks": [{"tool": "tsc", "status": "ran", "findings": 0}, {"tool": "oxlint", "status": "unavailable", "reason": "not installed"}],
  "lenses": [{"lens": "router", "model": "<model>", "scope": "full", "status": "ok", "take": "<danger grade, what it delegated>", "skill_blob": ""}],
  "lenses_yml_blob": ""
}
```

```bash
shepherd summary round.json --previous summary.md > comment.md   # --previous: the comment already on the PR, if any
shepherd summary round.json --previous summary.md --body > "$SHEPHERD_HANDOFF/findings.md"   # the handoff copy: no marker, header or history
```

`findings` holds the current round only, with a convergent finding's `lens`
carrying every lens's full tag. The renderer leads with the verdict heading
(`## <emoji> <VERDICT> <sub>(round <N> @ <short_sha>)</sub>`, the round taken
from `--previous`), then one collapsed section per part with its result in the
title: findings (open unless the verdict is LOOKS GOOD), still open, checks,
lenses, and earlier rounds folded one line each. With `--body` it keeps the
round number but leaves the history out: the publish job folds the comment it
replaces in itself, so the history would otherwise appear twice. It escapes markers, mentions
and images in every string you give it.
