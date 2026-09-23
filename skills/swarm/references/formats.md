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
- lens: <correctness|security|simplicity|maintainability|slop> | rung: <ladder rung> | scope: <paths or hunks, or "full"> | reason: <one line>
```

An empty `delegations:` list means the router's findings are the review.

## Verifier output

```
VERIFICATION:
- finding: <index> | result: <confirmed|downgrade:<SEVERITY>|refuted> | evidence: <quoted code or one-line reason>
```

## Summary comment

```markdown
<!-- shepherd-swarm-summary -->
> [!NOTE]
> 🤖 Automated comment by **Shepherd swarm**, not written by a human

## <emoji> <VERDICT> <sub>(round <N> @ <short_sha>)</sub>

<one or two sentences on why>

### Findings

<current round only, grouped by severity, one line each with file:line>

### Convergent

<findings two or more lenses reached on their own; omit the section when empty>

### Checks

<one line per repo check that ran, with its finding count; say which were unavailable>

### Lenses

| Lens | Model | Scope | Take |
| --- | --- | --- | --- |
| router | <model> | full | <danger grade, what it delegated> |
<one row per lens that ran this round>

<details>
<summary>Earlier rounds (<n>)</summary>

round <N> @ <short_sha>: <verdict>, <one-line disposition>

</details>
```

When updating, fold the previous "latest" header into one history line. Never
carry an earlier round's full detail forward.
