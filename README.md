# Shepherd

<p align="center"><img src="assets/shepherd.jpg" alt="Shepherd: a shepherd with a crook herding code-bracket sheep" width="480"></p>

Shepherd reviews changes, fixes findings and repairs CI through skills in your coding agent. Use it before you open a PR, on an existing PR, or through GitHub Actions.

Use Shepherd to work through review comments and failing CI logs under your team's policy. It leaves human decisions for you. `shepherd gate` is the approval gate: a separate read-only job decides whether the head is safe to approve, so the agent that fixes code never approves it. You decide when to merge.

## Set it up

In your repository, with Bun and an authenticated GitHub CLI, and a model key in your environment (`OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`):

```bash
bunx @jagreehal/shepherd init
```

That picks the model from your key, writes the workflows and `.shepherd/` config, sets the key as an Actions secret and lets Actions approve PRs. Commit the files, merge, and every PR gets a review and a verdict. It starts review-only: nothing is pushed until you run `shepherd init --preset push`. Pick the model yourself with `--model provider/model` (`opencode-go/…`, `anthropic/…`, `openai/…`, `openrouter/…`, `amazon-bedrock/…`).

Once merged, `shepherd doctor` checks the setup. On any PR:

```bash
shepherd review 42   # starts a review in GitHub Actions and prints the run's URL
shepherd status 42   # reviewing, fixing, waiting for CI, needs you or ready, and what to do next
```

To run it from your coding agent instead, `shepherd install`, then `/shepherd 42` on a PR, or `/shepherd --local` before you open one.

## Customize it

Your team's rules live in `.shepherd/`. Shepherd reads them from the default branch, so a change takes effect once you merge it.

| I want to… | Edit |
| --- | --- |
| Add my team's review rules | `.shepherd/lenses/<name>/SKILL.md`, made by `shepherd lens new <name>` |
| Run those rules only on some directories | The lens's `applies_to` in `.shepherd/config.yml` |
| Choose what Shepherd may change | `fixes.mode` in `.shepherd/config.yml` |
| Keep fixes out of code a person must own | `escalate.paths` in `.shepherd/config.yml` |
| Stop the gate approving changes to some files | A `deny` category in `.shepherd/gate.yml` |
| Share all of this across repositories | A pack, named under `extends` |

`config.yml` decides what Shepherd reviews and fixes; `gate.yml` decides what the gate approves. [Customize Shepherd for your team](docs/src/content/docs/start/customize.md) walks through one rule from checklist to enforced, and how to check it before you merge:

```bash
shepherd config validate                     # config.yml and its lenses
shepherd gate config --policy-dir .shepherd  # gate.yml
shepherd preview --working-tree              # the plan for your current change
```

## Read more

- [Run your first review](docs/src/content/docs/start/quickstart.md)
- [Choose local review, a PR loop, or CI](docs/src/content/docs/start/choose-a-setup.md)
- [Browse the documentation](docs/src/content/docs/index.md)

## Choose what the agent may change

| Mode | Result |
| --- | --- |
| `suggest` | Findings posted; no code edits |
| `local` | Fixes left in your working tree; you commit and push |
| `push` | Fixes committed and pushed under the skill rules |

`/shepherd --local` provides a pre-PR review-and-fix path with no GitHub writes. A completed review does not establish merge readiness. The PR loop reports ready only when the gate approves the current head, CI passes and no review thread remains open.

## Go further

None of this is needed for a first run.

| Task | Guide |
| --- | --- |
| Review before opening a PR | [Local review](docs/src/content/docs/guides/local-review.md) |
| Every configuration key, and team examples | [Configuration reference](docs/src/content/docs/reference/configuration.md), [Team examples](docs/src/content/docs/configuration/examples.md) |
| Review React, Next.js, Node, Go, Rust, Java, .NET or Python code, or import any skill as a lens | [Stack packs](docs/src/content/docs/configuration/stacks.md) |
| Use with pstack, or any plugin's skills as lenses | [pstack](docs/src/content/docs/integrations/pstack.md) |
| Select models by role | [Model routing](docs/src/content/docs/configuration/models.md) |
| Run without your laptop | [GitHub Actions](docs/src/content/docs/integrations/github-actions.md): `shepherd workflows --model <provider/model>` writes the loop and the gate |
| Pick a model and its key | [Environment](docs/src/content/docs/reference/environment.md): `SHEPHERD_MODEL=provider/model` and the provider's own key |
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
