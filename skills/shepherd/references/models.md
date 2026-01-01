# Model ladder

Every runner starts as low on the ladder as its job allows. A stronger model
validates a result; it never replaces a test.

## Resolve the ladder before pinning anything

**The operator's choice comes first.** Read `ladder:` and `models:` from the
repository's `.shepherd/lenses.yml` on the **default branch**
(`git show origin/<default>:.shepherd/lenses.yml`), never the PR head, then
from `~/.config/shepherd/lenses.yml`. The repository's ladder wins; a personal
ladder applies only when the repository sets none. `models:` pins merge per
name, the repository winning. `shepherd models` prints the result.

```yaml
ladder: [opencode-go/deepseek-v4-flash, opencode-go/glm-5.3, opencode-go/kimi-k3, opencode-go/qwen3.8-max]
models:                 # a name runs on exactly this model, whatever its rung
  security: opencode-go/qwen3.8-max
  router: opencode-go/deepseek-v4-flash
```

Pin names: `router`, `verifier`, `validator`, `triage`, `simplify`,
`ci-repair`, and any lens, built-in (`correctness`, `security`, `simplicity`,
`maintainability`, `slop`) or custom. A model id passes to the agent tool's
model parameter exactly as written: `haiku` on Claude Code, `provider/model`
on OpenCode. Never translate one id into another provider's. A pin replaces
the rung for that runner only; climbing for validation starts from the pin's
position on the ladder, or the top rung when the pin is not on it. A pin that
the agent tool rejects falls back to the runner's rung, and the summary says
so.

**When the subagent tool has no model parameter** (OpenCode 1.x), pick the
model by agent instead: `shepherd opencode-agents` generates one agent per rung
(`shepherd-r0` is the bottom rung, `shepherd-r1` the next) and one per pin
(`shepherd-pin-<name>`), each fixed to its model. Dispatch the runner with that
agent as its type. If those agents are not listed, say so in the summary: every
runner then runs on the session model.

With nothing configured, use the harness's ladder:

| Harness | Ladder, cheapest first |
|---|---|
| Claude Code | `haiku` -> `sonnet` -> `opus` -> `fable` |
| OpenCode | none built in: list `opencode models` and take the operator's ladder; with none set, the session model is one rung |
| Codex | the harness's own subagent models, cheapest first; with no per-agent model choice, one rung |
| Anything else | whatever the agent tool accepts, cheapest first |

If you cannot tell which models the agent tool accepts, assume the Claude Code
ladder and fall back one rung at a time on rejection. Never let a rejected pin
silently land every runner on the session model: that is the costliest outcome
and the one this ladder exists to prevent. When a caller passes a ladder, use it
exactly and ignore this table.

## Roles

- **Bottom rung:** work that only reads and that a later step checks: the swarm
  router, whose findings a verifier or lens confirms.
- **Second rung:** runners that edit code, push commits, or resolve threads:
  triage, simplify, and ci-repair. In trials the bottom rung fixed code and forgot to resolve the
  thread, committed without pushing, invented domain rules, edited code to
  get past a gate, and a simplify pass reverted a review fix. Each slip cost a redo one rung up, so starting there is the
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
