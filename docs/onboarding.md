# Onboarding a repository

From nothing to a first review in seven steps. Every command is
`bunx @jagreehal/shepherd <command>`, shortened here to `shepherd`.

## 1. Install the skills

```bash
shepherd install              # Claude Code: ~/.claude/skills and the /shepherd command
shepherd install --project    # or into this repository's .claude/
shepherd install --target ~/.agents/skills   # any other agent's skills directory
```

## 2. Check the setup

```bash
shepherd doctor
```

It checks that gh is signed in, the `shepherd` CLI is on PATH, the default
branch is fetched, the skills are installed, the policy and its packs load,
every lens skill resolves, the models exist, and a workflow runs stamp. Each
failure comes with the fix. Run
it again after each fix until no line says `fail`.

## 3. Write the policy

```bash
shepherd init                       # review-only: findings are posted, no code changes
shepherd init --preset local-fix    # fixes go into your working tree, never committed
shepherd init --preset push         # fixes are committed and pushed to the PR branch
shepherd init --from github:acme/policy/shepherd.yml@<40-hex sha>   # extend the organisation pack
```

Start review-only, and move to `local-fix` or `push` once the findings are
ones you would have acted on.

**Already have `.shepherd/lenses.yml`?** `shepherd init` copies its lenses,
ladder and pins into `.shepherd/config.yml` and keeps push mode, which is what
the old file meant. Delete `lenses.yml` afterwards: `config validate` fails
while both exist.

## 4. Validate

```bash
shepherd config validate     # exits 1 on a problem; run it in CI too
```

## 5. Preview

```bash
shepherd config explain --working-tree   # every setting and the layer it came from
shepherd preview --working-tree          # on your current change: the full plan
```

`preview` lists every reviewer and the model it runs on, the checks, what each
step can write locally or to GitHub, anything escalated to a person, and how
the run finishes. Read the `writes` lines before you merge.

## 6. Merge the policy

Commit `.shepherd/config.yml` and merge it. shepherd reads the policy from the
default branch only, so it takes effect when it is merged, and a PR can never
change the policy it is reviewed under.

## 7. First review

```bash
/shepherd 42      # in your agent, on an open PR
```

Under review-only this posts findings and ends `reviewed`, which says nothing
about whether the PR is ready. A PR is ready only when stamp approves its head,
CI is green and no review thread is open.

To check that an agent kept to its mode, run it under `shepherd acceptance`:
`shepherd acceptance suggest --pr 42 -- claude -p "/shepherd 42"`. It fails if
the run committed, pushed, resolved a thread, or (review-only) changed code,
or if a local-fix run left edits that its last review did not cover.

## Private organisation packs

shepherd fetches a pinned pack (`github:owner/repo/path@<sha>`) through `gh`,
as whoever gh is signed in as.

- **On your machine:** sign gh in as an account that can read the policy
  repository. `shepherd doctor` names the repository when it cannot.
- **In CI:** the workflow's `GITHUB_TOKEN` reads only its own repository. Give
  the step a token that can read the policy repository (a fine-grained token
  with `contents: read` on it, or a GitHub App token) as `GH_TOKEN`.

## Lens skills that come with a pack

Keep the lens next to the pack in the policy repository and name it by its
path there. When the repository extends the pack at a commit, the lens comes
from that same commit:

```yaml
# acme/policy: shepherd.yml
lenses:
  payments:
    skill: lenses/payments          # acme/policy/lenses/payments/SKILL.md
    applies_to: ["src/payments/**"]
```

The pinned commit must be on the policy repository's default branch: GitHub serves commits from forks through the parent repository too, so shepherd checks the commit is in the default branch's history before it trusts it. shepherd fetches the lens directory through gh when it loads the policy
(`config explain`, `preview`, `doctor`), and keeps it in
`~/.cache/shepherd/packs/` by commit. Moving the pin moves the lens with it.
CI needs the same read access as the pack itself (see above).

A bare name (`skill: payments-rules`) still means a skill installed for the
agent, and a path in a pack inside the repository means a path in that
repository.
