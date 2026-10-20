---
title: "Run your first review"
---

Install the skills, choose what the agent may change, and review a test PR. This guide starts with findings only.

## Prerequisites

You need Bun 1.2 or later, Git, an authenticated GitHub CLI (`gh`) and a coding agent that can load skills and run subagents. Use a clone of the GitHub repository you want to review. Your agent needs access to its model provider.

```bash
bun --version
git remote -v
gh auth status
```

For the PR example, choose an open PR from a branch in the repository. Use [local review](/shepherd/guides/local-review/) if you do not have a PR yet.

## 1. Install the CLI and skills

In your terminal:

```bash
bun add -g @jagreehal/shepherd
shepherd install
```

The default installation copies skills to `~/.claude/skills` and installs the `/shepherd` command. For a repository installation, use `shepherd install --project`. For another harness, use `shepherd install --target <skills-directory>` with the directory that harness reads. Install the full pack because skills reference siblings.

Confirm your agent can find the installed `shepherd` skill. The terminal CLI configures and supports the workflow; the coding agent executes the review skills.

## 2. Start in review-only mode

```bash
shepherd init --preset review-only
shepherd config validate
shepherd config explain --working-tree
shepherd preview --working-tree
```

Add `--stacks` to give the policy a lens for each stack your repository uses (React, Next.js, Node APIs, Go, Rust, Java, .NET, Python). Expect `fixes.mode: suggest` in the generated policy and a plan with review steps. Under this mode, the agent posts findings and changes no code. A repository with no policy uses the built-in `push` mode; create and merge policy before you rely on review-only behaviour. If `.shepherd/config.yml` already exists, `init` refuses to overwrite it, so inspect the effective mode.

Commit `.shepherd/config.yml` and merge it into the default branch. The PR workflow reads that trusted branch, not unmerged policy edits.

## 3. Check the setup

```bash
shepherd doctor
shepherd config explain
```

Fix lines marked `fail`. A missing Stamp workflow is a warning: you can review and fix without Stamp, but the PR loop cannot obtain its approval verdict. Other warnings include a CLI not on `PATH` and model IDs the harness cannot verify. Read each suggested action.

## 4. Review a PR

In your coding agent, from the repository clone:

```text
/shepherd 42
```

Replace `42` with your test PR number. Under review-only policy, expect a completed review with findings, if any, and a `reviewed` result. Inspect the PR comments; Shepherd labels its automated findings. A completed review does not grant approval.

If your harness uses skill names without slash commands, ask it to load the `shepherd` skill and review PR 42. The skill's instructions remain the same.

## 5. Choose the next mode

| Mode | Agent may do | You do next |
| --- | --- | --- |
| `suggest` | Post findings; change no code | Read and apply the findings |
| `local` | Edit the working tree; no commits, pushes or thread resolutions | Inspect, commit and push the fixes |
| `push` | Fix, commit and push under the skill rules | Review decisions left to you and the resulting diff |

Change `fixes.mode` in `.shepherd/config.yml`, validate and preview the change, then merge it. `--local` provides a separate pre-PR review path with no GitHub writes.

## Next steps

Add [team lenses and recipes](/shepherd/configuration/team-policy/), install [Stamp](/shepherd/integrations/stamp/), or enable [GitHub Actions](/shepherd/integrations/github-actions/). Use [troubleshooting](/shepherd/operations/troubleshooting/) if an expected step does not run.
