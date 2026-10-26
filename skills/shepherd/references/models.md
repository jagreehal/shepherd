# Model ladder

Every runner starts as low on the ladder as its job allows. A stronger model
validates a result; it never replaces a test.

## Resolve the ladder before pinning anything

**The operator's choice comes first.** Take `ladder` and `models` from the
team policy (`policy.md`): `.shepherd/config.yml` or `.shepherd/lenses.yml`
and its packs, on the **default branch**, never the PR head; then from
`~/.config/shepherd/lenses.yml`. The repository's ladder wins; a personal
ladder applies only when the repository sets none. `models:` pins merge per
name, the repository winning. `shepherd models` prints the result.

```yaml
tiers:                  # a name for a model, defined once; a pack can define them for every repo
  fast: opencode/deepseek-v4.1-flash-free
  smart: bedrock:eu.anthropic.claude-sonnet-4-6
ladder: [fast, smart]   # tiers or model ids, cheapest first
models:                 # a name runs on exactly this model or tier, whatever its rung
  reviewers: fast       # role group: the router and every lens
  fixers: smart         # role group: triage, simplify, ci-repair, incident
  security: smart       # one runner or lens beats its group
```

Pin names: `router`, `verifier`, `validator`, `triage`, `simplify`,
`ci-repair`, `loop` (the session model in CI), any lens, built-in
(`correctness`, `security`, `simplicity`, `maintainability`, `slop`) or
custom, and the role groups `reviewers`, `fixers` and `validators`. Take the
ladder and pins from `shepherd config explain --json`: tiers and groups are
already resolved there, so every value is a model id and every pin names one
runner. A model id passes to the agent tool's
model parameter exactly as written: `haiku` on Claude Code, `provider/model`
on OpenCode. Never translate one id into another provider's yourself. The one
translation is `shepherd opencode-agents`, which accepts stamp's canonical
`provider:model` ids and writes them the OpenCode way (`bedrock:` becomes
`amazon-bedrock/`, `vertex:` becomes `google-vertex/`, any other provider keeps
its name), so one ladder serves stamp and shepherd. `shepherd models` shows
both spellings. Claude Code aliases pass through. A pin replaces
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
| OpenCode | none built in: take the operator's ladder; with none set, the session model is the only rung. Never pick a model from `opencode models`: a free model there is a provider the team did not choose |
| Codex | the harness's own subagent models, cheapest first; with no per-agent model choice, one rung |
| Anything else | whatever the agent tool accepts, cheapest first |

If you cannot tell which models the agent tool accepts, assume the Claude Code
ladder and fall back one rung at a time on rejection. Never let a rejected pin
silently land every runner on the session model: that is the costliest outcome
and the one this ladder exists to prevent. When a caller passes a ladder, use it
exactly and ignore this table.

## Changing the defaults

A default rung, the harness ladder above, or a role below changes only on
`shepherd eval score` results over the held-out cases (`evals/README.md` in the
shepherd repository): the cheapest configuration within noise of the best.
Price alone never moves a role down a rung.

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
