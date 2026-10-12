# Team policy

A team sets shepherd's policy in `.shepherd/config.yml` (an older repository
may have only `.shepherd/lenses.yml`; it reads the same way). It can extend
packs, which apply first, and the repository file wins over them. Every
runner reads the policy the same way and holds to it.

## Load it once per run

```bash
git fetch -q origin <default>
shepherd config explain --json      # or: bunx @jagreehal/shepherd config explain --json
```

It reads the **default branch**, never the PR head, so a PR cannot change the
policy it is reviewed under. It resolves the packs, and each value carries its
`source`. Done when you hold the JSON.

Without the CLI, read the file yourself:
`git show origin/<default>:.shepherd/config.yml`, else
`git show origin/<default>:.shepherd/lenses.yml`. If that file has `extends`,
the packs are unresolved: run as `fixes.mode: suggest` (nothing edits code)
and say `policy packs unresolved` in the summary. Never guess a pack's
contents.

Personal settings (`~/.config/shepherd/lenses.yml`) are a preview: their
lenses print locally and never post, and their ladder and pins fill in only
where the team set none. They never change checks, fixes, escalation or
recipes.

## What each setting means

- **`checks`**: named commands. When set, swarm runs exactly these as its
  machine checks; ci-repair looks here first for the local command behind a
  failing job; incident runs them before calling a fix done. When empty, each
  runner finds the commands as its own skill says.
- **`fixes.mode`**: how far fixing goes.
  - `push` (default): fix, commit, push, as each skill says.
  - `local`: fix in the working tree; never commit, push, or resolve a
    thread. The review after a fix is `swarm --local` on the working tree,
    which leaves the receipt `shepherd local status` checks. Report "fixes
    left in the working tree".
  - `suggest`: change no code. Triage, simplify, ci-repair and incident report
    what they would fix and stop; review threads stay open for the author.
- **`escalate.paths`**: globs a person must decide. No runner changes a
  matching file. A finding whose fix needs one is deferred to the author with
  `escalate.reason` (or "team policy: a person changes <path>"); ci-repair
  classifies it `needs-decision`; incident stops with
  `outcome=needs_decision`. A gate or deny-list elsewhere still applies.
- **`lenses`**, **`ladder`**, **`models`**: as in `../../swarm/references/custom-lenses.md`
  and `models.md`.
- **`recipes`**: named step lists for `/shepherd <pr> --recipe <name>`. See
  below.

## Recipes

A recipe is an ordered list of shepherd's own steps: `swarm`, `triage`,
`simplify`, `ci-repair`, `stamp`, `incident`. `shepherd config validate`
rejects an order that cannot work (triage before any swarm, stamp anywhere
but last, a code change nothing reviews afterwards, a fixing step under
`fixes.mode: suggest`, and under `local` a fix that only stamp reviews, since
stamp sees the pushed head and local fixes never reach it). A built-in recipe
the fix mode rules out is unavailable rather than an error; `shepherd preview
--recipe <name>` says why. The built-in ones:

| Recipe | Steps | Runs under |
|---|---|---|
| `review` | swarm | every mode |
| `fix` | swarm, triage, simplify, swarm | local, push |
| `pr` | swarm, triage, simplify, swarm, ci-repair, stamp | push |
| `incident` | incident, swarm, triage, simplify, swarm, ci-repair, stamp | push |

Without `--recipe`, `/shepherd` runs the recipe its fix mode selects:
`review` under `suggest`, `fix` under `local`, `pr` under `push`. `pr` is
shepherd's own loop (`../SKILL.md`, Steps 1 to 5).

Running one:

1. Run the steps in the order listed, one at a time. Code-changing steps
   never overlap: they share one working tree and one branch.
2. Each step keeps every rule of its own skill and of `AGENTS.md`.
3. A review step (a swarm round that finds nothing new, or a stamp approval)
   must run **after the last change** this iteration made. Otherwise the
   result is `pending`, naming the step that still needs to review.

## How a recipe finishes

Finishing a recipe is not the same as a PR being ready. Report exactly one of:

- **`reviewed`**: a recipe with no fixing step (`review`) finished. Findings
  are posted for the author. It says nothing about merge readiness; never
  call the PR ready or approved.
- **`fixes_uncommitted`**: under `fixes.mode: local`, the fixes sit in the
  working tree and the last swarm reviewed the tree, not the PR head. The PR
  is unchanged; the person commits, pushes and runs again.
- **`ready`**: only when all three hold on the current head: stamp approved
  it, CI is green, and no review thread is open. A recipe without stamp can
  reach `reviewed`, never `ready`.
- **`pending`**: anything short of those, naming what is missing.

## Packs and lens files

A lens in a pack pinned to a commit (`github:owner/repo/pack.yml@<sha>`) can
name a path in the pack's own repository (`skill: lenses/payments`). It
resolves at the same commit, which must be on that repository's default branch: shepherd fetches that directory once into
`~/.cache/shepherd/packs/`, keyed by the commit, and `config explain --json`
gives the lens's `path` there. A bare name (`skill: payments-rules`) is an
installed skill. A lens path in a pack inside this repository resolves in
this repository. `shepherd config validate` reports a lens skill it cannot
find.
