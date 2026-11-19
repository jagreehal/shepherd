---
title: "Run your first review"
description: "Install Shepherd's CLI and skills, start in review-only mode, check the setup, and review a test pull request from your coding agent."
---

This guide takes you from nothing installed to a review of a test pull request from your coding agent. You start in review-only mode, so Shepherd posts findings and changes no code until you choose to let it.

:::note
To review each pull request in CI instead, see [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/).
:::

## Before you begin

Make sure you have:

- **Bun 1.2 or later** and **Git**.
- **An authenticated GitHub CLI (`gh`)**.
- **A coding agent** that loads skills and runs subagents, with access to its model provider.
- **A clone of the GitHub repository** you want to review.

Check them from the clone:

```bash
bun --version
git remote -v
gh auth status
```

For the pull request steps, pick an open pull request from a branch in the repository. If you don't have one yet, use [local review](/shepherd/guides/local-review/).

## Run the review

**1. Install the CLI and skills**

In your terminal:

```bash
bun add -g @jagreehal/shepherd
shepherd install
```

By default, `install` copies the skills to `~/.claude/skills` and installs the `/shepherd` command. To install into the repository, use `shepherd install --project`. For another harness, use `shepherd install --target <skills-directory>` with the directory that harness reads. Install the full pack, because the skills reference each other.

Confirm your agent can find the `shepherd` skill. The terminal CLI configures Shepherd; your coding agent runs the review skills.

**2. Start in review-only mode**

```bash
shepherd init --preset review-only
shepherd config validate
shepherd config explain --working-tree
shepherd preview --working-tree
```

You should see `fixes.mode: suggest` in the generated policy, and a plan with review steps. In this mode, the agent posts findings and changes no code.

To give the policy a lens for each stack your repository uses (React, Next.js, Node APIs, Go, Rust, Java, .NET, Python), add `--stacks`.

Keep these in mind:

- **No policy yet**: a repository with no policy uses the built-in `push` mode. Create and merge a policy before you rely on review-only behaviour.
- **Existing policy**: rerunning `init` keeps an existing `.shepherd/config.yml`, and `--preset` on it changes only `fixes.mode`. `shepherd config explain` shows the effective mode.

Commit `.shepherd/config.yml` and merge it into the default branch. The pull request workflow reads that branch, never unmerged policy edits.

**3. Check the setup**

```bash
shepherd doctor
shepherd config explain
```

Fix each line marked `fail`, and read each suggested action. These warnings are common:

- **Missing `shepherd.yml` workflow**: you can review and fix from your agent without it, but no pull request gets a verdict in CI.
- **CLI not on `PATH`**: use `bunx @jagreehal/shepherd <command>`.
- **Unverified model ids**: the harness can't confirm the ids exist.

**4. Review a pull request**

In your coding agent, from the repository clone:

```text
/shepherd 42
```

Replace `42` with your test pull request's number. Under review-only policy, you get a completed review with any findings and a `reviewed` result. Read the pull request's comments: Shepherd labels each automated finding. A completed review doesn't grant approval.

If your harness uses skill names without slash commands, ask it to load the `shepherd` skill and review pull request 42. The skill's instructions stay the same.

Once `shepherd.yml` is on the default branch, Shepherd reviews each pull request in GitHub Actions. To review a head again from the terminal:

```bash
shepherd review 42   # comments /review on the pull request
shepherd status 42   # the review, the shepherd status, CI and open threads, and what to do next
```

## Choose the next mode

Once you trust the findings, let Shepherd do more. Find the mode that fits in the first column:

| Mode | What the agent may do | What you do next |
| --- | --- | --- |
| `suggest` | Post findings, and change no code | Read and apply the findings |
| `local` | Edit the working tree, with no commits, pushes or thread resolutions | Inspect, commit and push the fixes |
| `push` | Fix, commit and push under the skill rules | Review the decisions left to you and the resulting diff |

To change mode, edit `fixes.mode` in `.shepherd/config.yml`, validate and preview the change, then merge it. `--local` is a separate pre-pull-request path with no GitHub writes.

## Related resources

- [Customize Shepherd for your team](/shepherd/start/customize/): add your own review rules
- [Compose team policy and recipes](/shepherd/configuration/team-policy/): packs, layering and recipes
- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): a review and a verdict on each pull request
- [Troubleshoot a review or repair](/shepherd/operations/troubleshooting/): a step that doesn't run
