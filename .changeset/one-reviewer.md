---
"@jagreehal/shepherd": minor
---

Shepherd reviews in CI as one reviewer, from one workflow: `.github/workflows/shepherd.yml` posts one review per push and sets the `shepherd` check.

- The model reads the checkout and holds no token. The job with the model keys reads code; a second job with no keys resolves threads and sets the check.
- Shepherd ships as one bundled file with no dependencies, so `bunx` fetches shepherd alone.
- A finding raised again on untouched code stays in its thread. Change the code under a thread and the thread resolves.
- The check goes green when the review approves and no thread of shepherd's or a person's stays open. When the review leaves a change to a person, their approval of the head settles it.
- Line comments open with their grade and a short title. Merge risk says what merging the head could break.
- The review reads your `AGENTS.md`, `CLAUDE.md`, `REVIEW.md` and `CONTRIBUTING.md` from the default branch and notes where a change departs from them. Lenses in `.shepherd/config.yml` apply in CI with their `gate`.
- The reviewer's policy lives under `review:` in `.shepherd/config.yml`. `shepherd workflows --upgrade` moves `.shepherd/gate.yml` there and names the workflow files it replaces.
- `shepherd doctor` checks that CODEOWNERS covers `/.shepherd/` and `/.github/` and that the default branch requires a code owner's review.

Local skills and `shepherd local` work as before.
