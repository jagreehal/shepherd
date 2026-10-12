# @jagreehal/shepherd

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
