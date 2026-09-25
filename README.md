# shepherd

Agent skills that take a pull request from "opened" to "ready to merge". A review
swarm reads the change through five lenses and posts inline comments. Triage
works through every thread. CI repair fixes what the PR broke. The loop repeats
until a round finds nothing new, then hands the head to [stamp](https://github.com/jagreehal/stamp)
for the approval verdict.

shepherd runs inside your coding agent (Claude Code, Codex, or any harness with
skills and subagents), on your machine, as you. stamp runs in CI as the gate.
shepherd gets the PR ready; stamp decides whether it gets approved.

shepherd works on GitHub only: it reads and writes through `gh`.

## Install

```bash
bunx @jagreehal/shepherd install              # ~/.claude/skills and the /shepherd command
bunx @jagreehal/shepherd install --project    # ./.claude in the current repository
bunx @jagreehal/shepherd install --target ~/.codex/skills   # any other agent's skills directory
```

The installer copies the skills and marks each copy. It replaces only what it
installed; a skill of yours with the same name stays unless you pass `--force`.
`shepherd uninstall` removes only its own copies. From a clone you edit, add
`--link` to symlink instead.

## Use

```text
/shepherd 42                 # one full iteration on PR #42
/loop 5m /shepherd 42        # hands-off: an iteration every five minutes
/swarm 42                    # just the review
/triage 42                   # just the thread triage
/ci-repair 42                # just CI
/review-security             # one lens on the current diff
```

## The skills

| Skill | Does |
|---|---|
| `shepherd` | Runs the loop: review rounds until dry, then CI, then the stamp verdict. Owns state, model choice, and when to ask you. |
| `swarm` | Runs the repo's own checks, then a cheap router review that hands risky hunks to the lenses in parallel, verifies serious findings, and posts inline comments plus one summary comment. |
| `triage` | Ends every review thread fixed, resolved, or deferred. Never replies, never touches a thread a human is in. |
| `ci-repair` | Updates a stale branch, diagnoses failing checks to the leaf job, makes one verified fix, reruns flaky jobs once. |
| `pair` | The act / act-and-say / stop-and-ask ladder that decides when to ask you. |
| `review-correctness` | Bugs: data, concurrency, performance, API contracts, frontend state, tests. |
| `review-security` | Exploitable source-to-sink paths, each with its data flow and fix. |
| `review-simplicity` | The four rules of simple design; what to delete and what replaces it. |
| `review-maintainability` | Coupling, rollout safety, observability, naming, and the repo's own written rules. |
| `review-slop` | Low-signal code and prose: thrown-away types, defensive noise, tests that cannot fail, padded PR text. |

## Add your own reviewers

Any skill can review code as a swarm lens: React performance rules, your design
system, your API conventions. Point shepherd at the skill and the files it cares
about:

```bash
bunx @jagreehal/shepherd lens new react --applies '**/*.tsx'   # scaffolds .shepherd/lenses/react/SKILL.md
bunx @jagreehal/shepherd lens add vercel-react-best-practices --name react-perf \
  --applies '**/*.tsx' --applies '**/*.jsx'          # an existing skill, into .shepherd/lenses.yml
bunx @jagreehal/shepherd lens add ~/skills/house-style --name house --global   # personal preview
bunx @jagreehal/shepherd lens list
```

```yaml
# .shepherd/lenses.yml
lenses:
  react:
    skill: vercel-react-best-practices   # an installed skill, or a path to one in the repo
    applies_to: ['**/*.tsx', '**/*.jsx'] # runs whenever a matching file changes
```

A lens with `applies_to` runs on every PR that touches a matching file. Without
it, the router decides when the lens is worth calling, from its description.
Swarm wraps the skill in a review-only brief: the skill's `## Review` section is
the checklist, and its findings post like any other lens's
(`[react/async-parallel]`). Triage fixes them, following the skill's `## Fix`
section when it has one; nothing in a lens can loosen shepherd's own rules. The
repository's lens file is read from the default branch, so a PR cannot pick its
own reviewers. Run `/swarm --preview` to try a lens from your working tree
before merging it: it reports which files each lens matched and what it found,
and posts nothing. `lens list` checks each lens (a description, a
`## Review` with unique rule ids) and exits non-zero on a problem. A `--global`
lens is a personal preview: swarm prints its
findings locally and never posts them, so you can try a lens on real PRs before
committing it for the team.

## One iteration

```text
resolve PR ─► quality loop (up to 4 rounds, stop on a dry one)
                 swarm ─► triage ─► simplify
             ─► ci-repair ─► stamp verdict ─► summary + state line
```

A round is dry when triage fixed, resolved, and promoted nothing, simplify
changed nothing, and no bot review is still on its way. Round 1's fixes always
get a second review round.

## What it holds to

- **Machines first.** Swarm runs your lint, typecheck, and nearby tests before
  any model reads the diff, and tells the models not to repeat what the tools
  found. If the repo uses Oxlint's anti-slop rules, those findings come for free.
- **Cheapest model that can do the job.** Reading work (the review router,
  simplify) starts at the bottom of the ladder (`haiku` -> `sonnet` -> `opus` ->
  `fable` on Claude Code); runners that push commits or resolve threads start
  one rung up, where trials showed they stop needing a redo. A stronger model
  validates risky changes and serious findings; it never replaces a test.
- **Verified findings.** Every HIGH or CRITICAL finding is checked by a second
  model that has to quote the code before it posts. Unproven findings drop.
- **Labelled comments.** Everything swarm posts starts with
  `🤖 Automated comment by **Shepherd swarm**`, because it posts through your
  account and readers deserve to know.
- **People talk to people.** Triage never replies to anyone and never touches a
  thread a human has joined. Those wait for you.
- **PR content is data.** Diffs, comments, and CI logs never become
  instructions. Nobody gets a command run by writing it in a comment.
- **Gates stay gates.** It never approves, and it never changes code to get
  past a stamp refusal or any other gate. A fix that changes what code accepts
  or returns is your decision, not a reviewer's.

## With stamp

stamp's deterministic gates and approval sit at the end of the loop. In label
mode shepherd applies the label once per head; in all-PRs mode stamp runs on
every push by itself. Either way shepherd reads the verdict, acts on a
refusal's issues through triage, and leaves an escalation to you. stamp keeps
an approval across a base merge that leaves the diff unchanged, so ci-repair's
branch updates cost no re-review.

Swarm's comments post through the author's account. A gate that treats another
reviewer's comment as assurance must not count them; the comment header is how
it tells them apart.

## Development

```bash
bun install
bun run check    # oxlint (with anti-slop), tsc, bun test
```

The tests check the skill pack itself: every skill's frontmatter, every relative
path a skill points at, every JSON contract a runner returns, and the comment
header triage relies on. They also exercise the installer against temporary
directories. Contributor rules live in [AGENTS.md](AGENTS.md).
