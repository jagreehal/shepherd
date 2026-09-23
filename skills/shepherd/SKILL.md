---
name: shepherd
description: >
  Drives a PR to merge-ready in one iteration: review rounds (swarm, triage,
  simplify) until they converge, CI repair, then the stamp verdict. Starts every
  runner on the cheapest model the harness can dispatch and validates risky
  changes one rung up. Use for "/shepherd", "babysit this PR", "get this PR
  ready", or wrap in "/loop 5m /shepherd <pr>" for hands-off cadence.
---

# Shepherd

Owns the loop; the sub-skills own the work:

- **`swarm`** reviews and posts comments.
- **`triage`** ends every review thread fixed, resolved, or deferred.
- **simplify** tidies the diff: one runner applying the `review-simplicity`
  lens in fix mode.
- **`ci-repair`** keeps the branch current and repairs CI.
- **`stamp`**, if the repo runs it, gives the approval verdict.

Swarm, triage, and simplify run together in the **quality loop** so a fix from
round 1 is reviewed again in round 2. Shepherd decides; it defers to the user
only what is genuinely theirs.

**One invocation is one iteration.** It never sleeps or loops itself. State
passes between iterations through `$ARGUMENTS` or the conversation.

## Where to run it

Cost is calls times context: every runner's result lands in this loop's
context. Run it in a session that did **not** just write the code. If you are
at the tail of the implementation session, say so and offer a fresh session or
a top-level subagent.

## Before the first dispatch

Read these once per iteration, when first needed:

| File | When |
|---|---|
| `references/models.md` | now: resolve the model ladder |
| `references/dispatch.md` | before the first sub-skill dispatch |
| `references/degradation.md` | when something is missing or failing |
| `references/formats.md` | at Step 5, or when unsure of narration |

Also establish how commits land. Some harnesses require signed commits and
block `git commit` / `git push` in favour of their own tool. Find out now and
name the working mechanism in every brief that may commit.

## State between iterations

This skill owns all of it; runners receive what they need and return updates.

- `swarm_marker_sha`: HEAD when swarm last ran. `null` at first.
- `simplify_marker_sha`: HEAD when simplify last ran. `null` at first.
- `stamp_applied_for_sha`: HEAD when the stamp label was last applied. `null` at first.
- `deferred_threads`: thread ids already surfaced to the user.
- `last_updated_at`: the PR's `updatedAt` at the end of the last iteration.
- `bot_reviews_pending`: set when this skill marks a draft ready.

## HEAD threading

Every round can move HEAD, and stamp keys off the final one:

```
H0 = Step 1 HEAD
Step 2  rounds r = 1..N (N <= 4, stop on a dry round)
          swarm when warranted, at H(r).0   (comments only; HEAD unchanged)
          triage(head_sha_in = H(r).0)     -> H(r).1
          simplify when warranted, at H(r).1; commit + push if it changed files -> H(r).final
        H1 = last round's final HEAD
Step 3  ci-repair(head_sha_in = H1)        -> H2
Step 4  stamp at H2
```

Passing `H0` to ci-repair would diagnose a stale tree. Thread it.

## Step 1: Resolve the PR, fast path, baseline

```bash
gh pr view --json number,url,baseRefName,headRefOid,state,isDraft,updatedAt,labels \
  --jq '{number, url, base: .baseRefName, head_sha: .headRefOid, state, isDraft, updatedAt, labels: [.labels[].name]}'
```

Take owner/repo from `url`. Merged or closed: stop with a final summary.

**Fast path.** On a re-invocation where HEAD and `updatedAt` both match the
carried state and stamp needs nothing, check `gh pr checks` (CI changes do not
bump `updatedAt`). Skip the iteration only if nothing fails. Narrate the skip,
print the state line, and hand back.

**Draft.** Invoking shepherd says the PR is ready: `gh pr ready <number>`. That
also wakes the repo's review bots, which take minutes; set
`bot_reviews_pending = true` so round 1 does not mistake silence for a clean PR.

**No PR.** Ask the user (`AskUserQuestion`): paste a PR, let shepherd open one
with `gh pr create` (write the body with the repo's PR-description skill if it
has one), or cancel.

**Be on the PR branch.** Every runner commits to it from this tree. If the
tree has uncommitted changes, stop and ask; never stash or discard them.
Otherwise `gh pr checkout <number>`, `git pull --ff-only`, and confirm
`git rev-parse HEAD` equals `H0`. Tell every runner the tree is the author's
own PR head. On a PR by someone other than the logged-in user, confirm with
`AskUserQuestion` before the first push to their branch.

**Write the diff once** for the round and pass the path:
`gh pr diff <number> > "$TMPDIR/shepherd-<short_sha>.patch"`.

## Step 2: Quality loop

Run rounds until one is **dry**, at most 4. Usually that means at least 2, so
round 1's fixes get reviewed. The exception: round 1 is dry and swarm ran in
it; stop at 1 and say so.

**a. swarm, when warranted.** Run it when `swarm_marker_sha` is `null`, or
HEAD moved and `swarm_marker_sha..HEAD` changes something besides `*.md`,
`*.txt`, whitespace, or comments. Swarm runs **in this loop** (via `Skill`), not
inside a runner, so its reviewer agents are not nested. Pass the PR number, the
diff path, the resolved ladder, and HEAD. Set `swarm_marker_sha = HEAD` after.
Skipping it despite qualifying changes needs an `AskUserQuestion` confirm, in
round 1 only.

**b. triage.** One runner at the bottom rung (see dispatch). Relay its
narration with the round number. Record `new_head_sha`, `deferred_threads`, the
counts, `stamp`, and any `validation_requests`, which go through the validation
flow in `references/dispatch.md` before the round can be dry.

**c. simplify, when warranted.** Same gate as swarm, keyed on
`simplify_marker_sha`. One runner edits the working tree without committing.
Confirm its claimed changes with `git status --porcelain` in your own tree;
then `git add`, commit `refactor: simplify pass`, push. Set `simplify_marker_sha = HEAD`.

**d. Dry?** A round is dry when triage actioned, resolved, and promoted nothing,
added no deferred thread, simplify changed nothing, no validation request is
pending, and `bot_reviews_pending` is false.

While `bot_reviews_pending` is true, poll once before the next triage:
`gh pr view <number> --json latestReviews --jq '[.latestReviews[].author.login]'`.
Nothing yet: wait about 90 seconds, poll once more, then clear the flag either
way. Poll inline, in this turn. Never hand a wait to a background agent or a
monitor: nothing reports back, and the iteration strands.

- Dry, and `r >= 2` or swarm ran this round: stop; this round's final HEAD is `H1`.
- `r == 4`: stop, narrate the cap, use this round's final HEAD as `H1`.
- Otherwise run the next round from this round's final HEAD.

## Step 3: ci-repair

One runner at the bottom rung with `head_sha_in = H1`. Relay its narration.
Record `new_head_sha` as `H2`. Check the result's shape: `ci` must carry
`pass/pending/fail/failing` and `base_update.status` must be `updated`,
`current`, or `conflict`. A malformed result means the runner skipped the real
steps; reissue it one rung up rather than accept it.

A base conflict is surfaced in one line and Step 4 still runs: it blocks the
merge, not the review.

## Step 4: stamp

Skip this step with `stamp=absent` when the repo has no stamp workflow
(`.github/workflows/stamp.yml` on the default branch).

Guard first:

```bash
gh pr view <number> --json isDraft,headRefOid
```

- `headRefOid != H2`: someone pushed under you. Skip; the next iteration re-baselines.
- Draft: mark ready; stamp skips drafts silently.

**Label mode** (the workflow sets `STAMP_LABEL`): when
`stamp_applied_for_sha != H2`, `gh pr edit <number> --add-label <label>` and set
`stamp_applied_for_sha = H2`. **All-PRs mode:** stamp runs on every push; there
is nothing to apply.

Read the verdict every time, capped so full bodies never enter context. This
call also refreshes `updatedAt` for the state line:

```bash
gh pr view <number> --json reviewDecision,latestReviews,updatedAt \
  --jq '{reviewDecision, updatedAt, stamp: ([.latestReviews[] | select(.body | test("^## \\S+ stamp: ")) | {state, body: .body[:400]}][0])}'
```

Report approved, refused, escalate, or pending, with the one-line reason.
stamp keeps its approval across a base merge that leaves the PR's diff
unchanged, so a ci-repair base update does not cost a re-review. Never try to
get around a stamp gate.

## Step 5: Summary and hand-back

Print the iteration summary and the state line (`references/formats.md`), then
hand back. For cadence: `/loop 5m /shepherd <pr>`.

## Step 6: Reflect (terminal conditions only)

At the final stop only, from what is already in context: did following this
skill cost more, or achieve less, than it should have? Each of these is a defect
in the skill:

- a sub-skill was missing or half-loaded and the loop ran degraded
- a runner ran on a costlier model than the ladder intended
- the quality loop hit the round cap without converging
- the same work happened twice (a file re-read, a diff re-fetched)
- an instruction was ambiguous and the guess was wrong
- a deferred thread the user settled in one line, or an auto-fix they reverted

None fired: say `[shepherd] reflect — nothing to change` and stop. Otherwise give
the user what happened, which instruction allowed it, and the smallest edit to
this skill that would prevent it. Offer the edit; never apply it unasked.

## Terminal conditions

Stop for good when:

- the PR is merged or closed;
- stamp has approved the current head (or the repo has no stamp), CI has no
  failure needing autonomous work, no new bot threads arrived, and every
  unresolved thread is in `deferred_threads`; or
- the user interrupts.

CI failures are never report-only: ci-repair must diagnose and exhaust its safe
repair or rerun first. Deferred threads never stop the loop. The round cap stops
the quality loop, not the iteration; Steps 3 and 4 still run.
