# Model ladder

Every runner starts as low on the ladder as its job allows. A stronger model
validates a result; it never replaces a test.

## Resolve the ladder before pinning anything

| Harness | Ladder, cheapest first |
|---|---|
| Claude Code | `haiku` -> `sonnet` -> `opus` -> `fable` |
| Codex | the harness's own subagent models, cheapest first; with no per-agent model choice, one rung |
| Anything else | whatever the agent tool accepts, cheapest first |

If you cannot tell which models the agent tool accepts, assume the Claude Code
ladder and fall back one rung at a time on rejection. Never let a rejected pin
silently land every runner on the session model: that is the costliest outcome
and the one this ladder exists to prevent. When a caller passes a ladder, use it
exactly and ignore this table.

## Roles

- **Bottom rung:** work that only reads, or that a later check catches: the
  swarm router and simplify.
- **Second rung:** runners that push commits or resolve threads: triage and
  ci-repair. In trials the bottom rung fixed code and forgot to resolve the
  thread, committed without pushing, invented domain rules, and edited code to
  get past a gate. Each slip cost a redo one rung up, so starting there is the
  cheaper path.
- **One rung up:** swarm's default delegation target; the validator for a risky
  change; swarm's verifier for a bottom-rung finding.
- **Two rungs up:** fallback when the rung below is unavailable.
- **Top rung:** a delegation the rungs below could not settle, or reviewers who
  disagree and need a stronger read.

## Validation

1. Prefer deterministic proof: tests, typecheck, lint, the final diff, evidence
   from GitHub or CI.
2. For a risky or uncertain decision, ask the next rung up with only the
   evidence and the narrow question.
3. Climb one rung at a time; stop when the evidence is clear.
4. Record which model ran each step.

A second-model validation is **required** before an autonomous change that
touches authentication, permissions, billing, data deletion, migrations,
concurrency, a public API, or a broad shared abstraction, and whenever reviewers
disagree or the checks cannot prove the change safe. Mechanical work the checks
prove needs no stronger model.

## When nothing cheaper exists

If no rung below the session model can be dispatched, every runner costs
session rates. Say so in the narration and the summary, and cut the quality
loop's round cap to 2.
