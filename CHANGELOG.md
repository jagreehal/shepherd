# @jagreehal/shepherd

## 0.12.1

### Patch Changes

- 928199c: The summary renderer accepts a round that borrows words from swarm's other JSON shapes. It maps `changes_needed`, `approve_with_nits` and `looks_good` onto the round's verdicts, maps lens statuses such as `completed` and `skipped` onto `ok` and `could_not_run`, keeps a lens's `reason` as its take, reads `verified: true` as unverified, and defaults a missing `why` to empty. Unknown values still fail.
  
  In handoff mode, swarm and the workflow prompt have the model check `round.json` with `shepherd summary <round.json> --body > /dev/null` and fix each error before it stops. Run `shepherd workflows --upgrade` to pick up the new prompt.

## 0.12.0

### Minor Changes

- 9428e0c: Swarm's verdict, lens table and inline review follow the findings more closely.
  
  - A confirmed HIGH reads CHANGES NEEDED. A MEDIUM alone still reads APPROVE WITH NITS.
  - A lens's take in the lens table is the worst severity among the findings that name it. When `shepherd fanout` listed a first wave for the head, the router is expected too, and a round without it shows it as `could_not_run`.
  - The inline review's marker carries a fingerprint of its comments, so a new round on the same head posts its own comments. Run `shepherd workflows --upgrade` to pick this up.
  - A thread link that is not a GitHub URL is dropped and the finding kept. The publish job warns and stops when it has nothing to render.

## 0.11.0

### Minor Changes

- 1c15dea: Measure review accuracy, and check more of each round in code.
  
  - `shepherd eval run` reviews frozen cases in fresh clones with any agent command and records each run with its version, skill hash, command, cost and duration. `shepherd eval score` reports recall, precision, false positives, near misses and duplicates per configuration, with development and held-out cases apart, and names the cheapest configuration within noise of the best.
  - Swarm verifies every finding above NIT with a worked example (input, expected, actual), carried in a new `evidence` field. It merges findings that share a root cause and fix, and the correctness lens starts from what the change promises.
  - `shepherd summary` and `shepherd inline` grade a HIGH or CRITICAL without `evidence` as MEDIUM, mark unverified findings, keep the verdict at least as strict as its findings, mark a round with an unfinished lens incomplete, and keep thread links only when they match a review comment's URL on the PR. One-click suggestions land on the lines they rewrite.

## 0.10.0

### Minor Changes

- e32d26a: In CI, swarm hands its round off as `round.json` and the publish job, which runs no model, posts it. Publish renders the inline review with `shepherd inline` and the summary with `shepherd summary`, including the fanout check, so a model can no longer post a hand-written review. Before this, a live run on PR 1 posted bare `HIGH: …` comments with no header, title or prompt, and left the old summary in place.
  
  Publish also checks that the summary on the PR came from this run before skipping its own post. A summary an earlier round left on the same head used to pass for the current one, so the new round was never posted. A check that cannot start (`Startup Error`, `Cannot find module`) is reported as unavailable, not as passing.
  
  **Workflow change:** regenerate `.github/workflows/shepherd.yml` with `shepherd workflows --upgrade`.

## 0.9.0

### Minor Changes

- cd00adc: Swarm renders its inline review and its summary from one round JSON.
  
  - `shepherd inline <round.json>` prints the inline review. Each comment carries the severity tag, a bold title, the input with the actual and expected result, a one-click `suggestion` when the fix replaces exactly its lines, `Verified:`, and a collapsed "Prompt for AI agents". It posts at most 10, most severe first, and anchors line ranges with `start_line`.
  - `shepherd summary` adds a confidence score out of 5 and numbered findings, each titled and linked to its thread. One "Fix with an agent" prompt holds every finding above NIT. A walkthrough holds bullets, a per-file table, the review effort out of 5 and an optional mermaid diagram.
  - `shepherd summary --fanout` (default `$SHEPHERD_FANOUT`) shows each first-wave lens the round never reported as `could_not_run`.
  - A wrong result on an ordinary input in new code grades HIGH. A runtime claim with no input grades MEDIUM at most, and `checks/*` findings keep their grade.
  - Rounds can carry pre-merge checks (title, description, linked issue, scope, tests), documentation links, the read-only commands that checked a finding, and `reintroduces`, a link to the resolved thread whose fix the change undoes.

## 0.8.0

### Minor Changes

- c95c9ff: `shepherd summary <round.json>` renders swarm's summary comment from the round's JSON. You see the verdict heading, then collapsed sections for findings, still open threads, checks, lenses and earlier rounds. The renderer escapes markers, mentions and images in model text. Swarm finds the summary under the CI bot or the account that posts it and carries the round number forward, including in the handoff copy. Triage and swarm read stamp's collapsed review layout.

## 0.7.0

### Minor Changes

- 61e7880: CI setup in one config file, model keys scoped to the model job, and lenses that start together.
  
  - `ci:` in `.shepherd/config.yml` holds every non-secret CI setting (`label`, `aws_region`, `notify_on`, `max_commits`, `push_deny`, `incident_paths`, `audit.plays`, `audit.public`). A repository variable overrides its key. `shepherd ci-settings` resolves them from the default branch in a job that runs no model, and `shepherd config explain` lists each with its source.
  - `.shepherd/config.yml` has a JSON Schema. `shepherd init` links it on the first line, so editors autocomplete and check the file; `shepherd config schema` prints it.
  - `shepherd workflows` takes `--model`, `--label`, `--aws-region` and `--environment`. `--environment` puts only the model job in that GitHub environment, in new workflows and kept ones. `--upgrade` rewrites kept workflows from the current templates and keeps their environment and `workflows:` list.
  - `shepherd init --model` pins `models.loop`. A migrated `lenses.yml` starts review-only.
  - Swarm starts the router, the correctness lens and every custom lens whose `applies_to` matches in one parallel wave. `shepherd fanout` lists that wave, and in CI the workflow writes it before the model starts.
  - `config explain --json` and `fanout` give each lens its directory from the default branch, siblings included, extracted fresh for every run.
  - A `/shepherd` comment or the handoff label starts a run through the gate, which checks the commenter's write access with the permission API and queues the run behind any run on the PR.
  - CI runs OpenCode's built-in agents and small model on the session model, with only the plan's providers enabled.
  - In CI handoff mode, swarm posts its findings. When it has not, `publish` writes the handed-off findings into the bot's swarm summary.
  - `branding:` sets the name, avatar and glyphs on posted comments. `shepherd branding` prints them resolved. Shepherd and triage find stamp's review by its hidden marker.
  - `/swarm --local` and `/shepherd --local` take `--base <ref>`, and the summary names each check that did not run.

## 0.6.0

### Minor Changes

- 1601a5e: - Install Shepherd as a Claude Code plugin with `/plugin install shepherd --marketplace jagreehal/shepherd`, or as a Cursor plugin from `.cursor-plugin/`.
  - Name any installed plugin's skill as a lens with `<plugin>:<skill>`. Lenses also resolve from Cursor's skills directories.
  - The `pstack` lens and pack turn pstack's engineering principles into review rules. `shepherd init` suggests the lens when pstack is installed, and `shepherd doctor` lists skill names that other plugins share with Shepherd.
  - The loop loads its sub-skills by path, so it runs Shepherd's own `swarm`, `triage` and `ci-repair`.
  - Swarm matches a base-merge head by `git patch-id`. ci-repair and triage test the premise behind two earlier fixes before a third, and triage reuses a bot's checked dismissals from the bot's third pass.
  - CI model jobs receive only the provider keys their models use.

## 0.5.0

### Minor Changes

- c2890db: - Lenses for React, Next.js, Node APIs, Go, Rust, Java, .NET, Python and Nx monorepos, plus OWASP ASVS and OWASP LLM lenses. `shepherd stack` detects your stack and `shepherd init --stacks` adds its lenses.
  - Policy files compose: packs and `extends` nest, and each lens takes `gate`, `only` and `disable`.
  - `tiers` name models once, and the `reviewers`, `fixers` and `validators` groups pin a tier to each role. `shepherd ci-models` hands CI the team's ladder, and `SHEPHERD_API_KEY` reaches whichever provider the session model uses.
  - `shepherd workflows --audit` installs a weekly security audit that runs OWASP Secure Agent Playbook plays.
  - The `lens-import` skill turns a skill, style guide or rule set into a lens that stamp can also read.

## 0.4.0

### Minor Changes

- 1deaaf6: - `shepherd workflows` installs the PR loop and incident workflows for GitHub Actions, pinned to your version.
  - The PR loop gives the model a token that reads and comments. A job with no model checks its commits, pushes them to the PR branch as a fast-forward, and refuses changes to protected paths.
  - Handoff mode lets an iteration commit and leave the push to that job.
  - `shepherd notify` tells Slack or any JSON endpoint when a PR needs you, is ready to merge, or the CI iteration stopped. It sends once per change.
  - A documentation site covers setup, configuration, CI and operations.
- b6ed516: The observability lens grows to thirteen rules that ask whether an on-call engineer could debug a change in production from its telemetry: spans on entry points and outbound calls, trace context across services and queues, errors with their cause, trace-linked structured logs, request identifiers and decisions, no sensitive data, counted drops, bounded names, alertable signals, feature signals, stable telemetry names, safe startup and shutdown, and sampling and redaction changes.
- f2239fd: - Swarm, triage, ci-repair and incident read executable-stories runs as evidence, and compare runs of the same scope.
  - `shepherd trace event` and `shepherd trace flush` export each iteration as a `shepherd.iteration` span with a span per stage.
  - `shepherd garden` adds trace measurements from OTLP files, Grafana Tempo or Datadog to its GitHub scores.
  - Triage reads Claude Code Review's severity markers, and the loop waits on its check run.
  - Updated autotel, zod and yaml.

## 0.3.0

### Minor Changes

- 771b7aa: `shepherd garden` lists `escapes`: incidents whose culprit PR stamp approved. The garden skill proposes, for each one, the smallest lint rule, stamp rule or lens rule that flags the culprit diff and passes the fix.

### Patch Changes

- bc47888: The `incident` skill names a culprit only from its probe, looks up stamp's review with one `gh api` call, and writes the `Regressed-by`, `Coverage gap` and `Merge skew` lines exactly as garden reads them. A failed duplicate search is retried before an issue opens.

## 0.2.0

### Minor Changes

- 6476b73: `shepherd lens new <name> --from observability` starts a team lens from a bundled observability pack: spans or logs on outbound calls, errors that keep their cause, structured logs, no secrets or personal data in telemetry, counted drops, bounded labels, and a signal for user-facing changes. The pack is the same file stamp reads as a rule pack.
- de0d139: Review and fix a change before a PR exists with `/shepherd --local` and `/swarm --local`. `shepherd local change` captures unpushed commits, staged and unstaged edits and untracked files; `shepherd local finish` checks a review covered every changed range and writes a receipt for that exact content; `shepherd local status` reports whether the files still match it. `shepherd local demo` builds a repository with planted bugs to try it on.
- 6bc8d55: Choose the models, see where the loop got to, and let shepherd improve itself.
  
  - `ladder:` and `models:` in `.shepherd/lenses.yml` pick the model for each rung, lens, and runner, from any provider your harness reaches. `shepherd models ladder`, `shepherd models pin`, and `lens add --model` write them; `shepherd models` prints what will run.
  - `shepherd opencode-agents` prints one OpenCode agent per rung and pin, so OpenCode 1.x runs each subagent on its own model.
  - Every iteration sets a `shepherd` commit status on the head: `pending` while work remains, `failure` naming what the author needs to do, `success` once stamp approves and nothing is open. The loop stops when only the author can move the PR.
  - Triage names each rule it fixes in a `Shepherd-Fixes` trailer.
  - `shepherd garden <owner/repo>...` scores recent runs from GitHub: reverted fixes, replies in shepherd threads, round caps, loops that stopped short or went quiet, and the lens rules triage fixed on 3+ PRs.
  - The `garden` skill turns those scores into PRs with skill edits and lint rules, and `.github/workflows/garden.yml` runs it weekly with the agent read-only and a separate job opening the PRs.
- a026a64: Swarm runs installed scanners (`gitleaks`, `semgrep`, `osv-scanner`, `actionlint`, `shellcheck`, `hadolint`) on the files they read, keeps findings on changed lines and the lines beside a deletion, and lists suppression comments the PR adds.
- 4e8a2a5: Teams can write their own review lenses and have shepherd fix what they find.
  
  - `shepherd lens new <name> --applies '<glob>'` scaffolds `.shepherd/lenses/<name>/SKILL.md` with `## Review` rules and an optional `## Fix` section (Prefer, Never touch, Escalate), and registers it.
  - `shepherd lens add` and `shepherd lens list` validate each lens: a description, a `## Review` section, unique rule ids. `lens list` exits non-zero on a problem, so CI can run it.
  - Triage fixes a lens's findings by its `## Fix` guidance, defers anything under Escalate, and adds a `Shepherd-Lens: <name>` trailer. A lens can make shepherd stricter, never looser.
  - `/swarm --preview` runs lenses from your working tree, reports which files each one matched, and posts nothing.
  - Personal lenses (`--global`) print locally and never post.
  - Fixers follow `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and `docs/adr/` from the default branch.
  - A thread left for the author fences its code, so fixes stay clear of the decisions it holds.
  - Each lens reports `ok`, `failed`, or `could_not_run`, with the blob of the `SKILL.md` it ran.
  - The router receives PR text inside a fence and leaves a matched custom lens its concern.
- 29b97f1: Add team policy in `.shepherd/config.yml`. A team sets how far fixes go (`suggest`, `local` or `push`), extends packs pinned to a commit, names its checks and the paths a person decides, and composes recipes. `shepherd init --preset`, `config validate`, `config explain` and `preview` show each setting and its source before you merge.
  
  Add `shepherd doctor` to check a machine and repository, `shepherd acceptance` to confirm an agent kept to its fix mode, the `incident` skill that takes a production error to a fix PR with a reproducing test, and `docs/onboarding.md`.
- de0d139: Ship Matt Pocock's `code-review`, `diagnosing-bugs`, `pr`, `retro` and `writing-for-agents` skills unchanged, with a new `review-spec` lens that checks a change against its linked issue or spec. The simplicity lens adds code-review's smell baseline, ci-repair diagnoses unclear failures with diagnosing-bugs, shepherd writes PR bodies with pr, and garden sorts causes with retro.

### Patch Changes

- 20d05d7: `/shepherd --local` follows the fix mode: under `suggest` it runs one swarm round and reports `reviewed`. An accepted change from the validator goes to a new foreground runner.
- dc5d63f: Triage and swarm weigh everything open on a PR.
  
  - Triage names a custom lens's threads when it classifies them, and judges a finding from the code, the threads and the default branch's rules, never from the PR title, body or repository description.
  - A thread left for the author holds back only the fixes that would carry out its decision; local fixes inside the same code go ahead.
  - Triage resolves a thread only when everything it names is fixed, adds a test that pins any behaviour it changes, and keeps each behaviour change the PR already disclosed.
  - Swarm grades its verdict on its findings plus every open thread from any reviewer, and a current gate refusal.
  - A diff over ~400 lines always gets a `correctness` delegation.
  - A finding whose fix would keep a problem an open thread names says so and names the thread.
  - Resolved Shepherd threads show `✅ Resolved at <sha>`, "still open" entries link to their threads, and HIGH and CRITICAL comments carry the verifier's evidence.
  - The "Changes made during review" section drops or corrects any line a later commit undid.
