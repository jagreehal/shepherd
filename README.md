# Shepherd

Shepherd reviews changes, fixes findings and repairs CI through skills in your coding agent. Use it before you open a PR, on an existing PR, or through GitHub Actions.

Use Shepherd to work through review comments and failing CI logs under your team's policy. It leaves human decisions for you. [Stamp](https://github.com/jagreehal/stamp) supplies the approval verdict; you decide when to merge.

## Start here

- [Run your first review](docs/src/content/docs/start/quickstart.md)
- [Choose local review, a PR loop, or CI](docs/src/content/docs/start/choose-a-setup.md)
- [Browse the documentation](docs/src/content/docs/index.md)

You need Bun 1.2 or later, Git, an authenticated GitHub CLI and a coding agent that can load skills and run subagents.

In your terminal, from the repository clone:

```bash
bun add -g @jagreehal/shepherd
shepherd install
shepherd init --preset review-only
shepherd config validate
shepherd preview --working-tree
```

The default install targets Claude Code. For another harness, use `shepherd install --target <skills-directory>`. Commit and merge the generated review-only policy before you run it against a PR: PR reviews read policy from the default branch. Without policy, the built-in fix mode is `push`.

In your coding agent:

```text
/shepherd 42
```

Replace `42` with your PR number. Expect findings on the PR and a `reviewed` result under review-only policy. Read the [first-run guide](docs/src/content/docs/start/quickstart.md) for setup checks and expected results.

## Choose what the agent may change

| Mode | Result |
| --- | --- |
| `suggest` | Findings posted; no code edits |
| `local` | Fixes left in your working tree; you commit and push |
| `push` | Fixes committed and pushed under the skill rules |

`/shepherd --local` provides a pre-PR review-and-fix path with no GitHub writes. A completed review does not establish merge readiness. The PR loop reports ready only when Stamp approves the current head, CI passes and no review thread remains open.

## Configure it for your team

| Task | Guide |
| --- | --- |
| Review before opening a PR | [Local review](docs/src/content/docs/guides/local-review.md) |
| Compose checks, modes and recipes | [Configuration reference](docs/src/content/docs/reference/configuration.md) |
| Share organisation policy | [Team examples](docs/src/content/docs/configuration/examples.md) |
| Add domain-specific reviewers | [Lenses](docs/src/content/docs/configuration/lenses.md) |
| Review React, Next.js, Node, Go, Rust, Java, .NET or Python code, or import any skill as a lens | [Stack packs](docs/src/content/docs/configuration/stacks.md) |
| Select models by role | [Model routing](docs/src/content/docs/configuration/models.md) |
| Run without your laptop | [GitHub Actions](docs/src/content/docs/integrations/github-actions.md) |
| Get told when a PR needs you | [Notifications](docs/src/content/docs/integrations/notifications.md) |
| Investigate a failure after merge | [Incidents](docs/src/content/docs/guides/incidents.md) |
| Improve recurring findings | [Gardening](docs/src/content/docs/operations/gardening.md) |
| Diagnose a stopped loop | [Troubleshooting](docs/src/content/docs/operations/troubleshooting.md) |

## Development

```bash
bun install
bun run check
```

For the docs site, run `bun install --cwd docs --frozen-lockfile`, then `bun run docs:dev`. Run `bun run docs:build` to validate and build it. Read [documentation maintenance](docs/src/content/docs/contributing/docs.md), [contributor rules](AGENTS.md) and [third-party credits](THIRD_PARTY_NOTICES.md).
