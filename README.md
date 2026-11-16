# Shepherd

<p align="center"><img src="assets/shepherd.jpg" alt="Shepherd: a shepherd with a crook herding code-bracket sheep" width="480"></p>

Shepherd reviews every PR in GitHub Actions and posts one review per push, with a verdict and one inline comment per finding. The model reads the code and holds no token; shepherd's own process posts the review and sets the `shepherd` commit status. A person approves and merges.

On your own machine, Shepherd's skills in your coding agent review your change before you open a PR, fix findings and repair CI under your team's policy. They leave human decisions for you.

## Set it up

In your repository, with Bun and an authenticated GitHub CLI, and a model key in your environment (`OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`):

```bash
bunx @jagreehal/shepherd init
```

That picks the model from your key, writes `.github/workflows/shepherd.yml` and `.shepherd/config.yml`, and sets the key as an Actions secret. Commit the files, merge, and every PR gets a review and a verdict. Pick the model yourself with `--model provider/model` (`opencode-go/…`, `anthropic/…`, `openai/…`, `openrouter/…`, `amazon-bedrock/…`).

Once merged, `shepherd doctor` checks the setup. On any PR:

```bash
shepherd review 42   # comments /review, which reviews the head again in GitHub Actions
shepherd status 42   # the review, the shepherd status, CI and open threads, and what to do next
```

To run it from your coding agent instead, `shepherd install`, then `/shepherd 42` on a PR, or `/shepherd --local` before you open one.

## Customize it

Your team's rules live in `.shepherd/config.yml` and the lenses it names. Shepherd reads them from the default branch, so a change takes effect once you merge it.

| I want to… | Edit |
| --- | --- |
| Add my team's review rules | `.shepherd/lenses/<name>/SKILL.md`, made by `shepherd lens new <name>` |
| Run those rules only on some directories | The lens's `applies_to` in `.shepherd/config.yml` |
| Choose what the local skills may change | `fixes.mode` in `.shepherd/config.yml` |
| Keep fixes out of code a person must own | `escalate.paths` in `.shepherd/config.yml` |
| Stop the review approving changes to some files | A `deny` category under `review:` in `.shepherd/config.yml` |
| Share all of this across repositories | A pack, named under `extends` |

The top of `config.yml` decides what Shepherd reviews and fixes; `review:` decides what the review approves. [Customize Shepherd for your team](docs/src/content/docs/start/customize.md) walks through one rule from checklist to enforced, and how to check it before you merge:

```bash
shepherd config validate                     # config.yml and its lenses
shepherd gate config --policy-dir .shepherd  # the review: section
shepherd preview --working-tree              # the plan for your current change
```

## Read more

- [Run your first review](docs/src/content/docs/start/quickstart.md)
- [Choose local review, a PR loop, or CI](docs/src/content/docs/start/choose-a-setup.md)
- [Browse the documentation](docs/src/content/docs/index.md)

## Choose what the local agent may change

`fixes.mode` governs the skills you run in your coding agent. The review in GitHub Actions changes no code.

| Mode | Result |
| --- | --- |
| `suggest` | Findings posted; no code edits |
| `local` | Fixes left in your working tree; you commit and push |
| `push` | Fixes committed and pushed under the skill rules |

`/shepherd --local` provides a pre-PR review-and-fix path with no GitHub writes. A completed local review does not establish merge readiness: the `shepherd` status does, once the review approves the current head and no thread a person wrote in is open.

## Go further

None of this is needed for a first run.

| Task | Guide |
| --- | --- |
| Review before opening a PR | [Local review](docs/src/content/docs/guides/local-review.md) |
| Every configuration key, and team examples | [Configuration reference](docs/src/content/docs/reference/configuration.md), [Team examples](docs/src/content/docs/configuration/examples.md) |
| Review React, Next.js, Node, Go, Rust, Java, .NET or Python code, or import any skill as a lens | [Stack packs](docs/src/content/docs/configuration/stacks.md) |
| Use with pstack, or any plugin's skills as lenses | [pstack](docs/src/content/docs/integrations/pstack.md) |
| Select models by role | [Model routing](docs/src/content/docs/configuration/models.md) |
| Review every PR in CI | [GitHub Actions](docs/src/content/docs/integrations/github-actions.md): `shepherd workflows --model <provider/model>` writes `shepherd.yml` |
| Pick a model and its key | [Environment](docs/src/content/docs/reference/environment.md): `SHEPHERD_MODEL=provider/model` and the provider's own key |
| Get told when a PR needs you | [Notifications](docs/src/content/docs/integrations/notifications.md) |
| Investigate a failure after merge | [Incidents](docs/src/content/docs/guides/incidents.md) |
| Improve recurring findings | [Gardening](docs/src/content/docs/operations/gardening.md) |
| Diagnose a missing review or status | [Troubleshooting](docs/src/content/docs/operations/troubleshooting.md) |

## Development

```bash
bun install
bun run check
```

For the docs site, run `bun install --cwd docs --frozen-lockfile`, then `bun run docs:dev`. Run `bun run docs:build` to validate and build it. Read [documentation maintenance](docs/src/content/docs/contributing/docs.md), [contributor rules](AGENTS.md) and [third-party credits](THIRD_PARTY_NOTICES.md).
