---
"@jagreehal/shepherd": minor
---

Add team policy in `.shepherd/config.yml`. A team sets how far fixes go (`suggest`, `local` or `push`), extends packs pinned to a commit, names its checks and the paths a person decides, and composes recipes. `shepherd init --preset`, `config validate`, `config explain` and `preview` show each setting and its source before you merge.

Add `shepherd doctor` to check a machine and repository, `shepherd acceptance` to confirm an agent kept to its fix mode, the `incident` skill that takes a production error to a fix PR with a reproducing test, and `docs/onboarding.md`.
