---
"@jagreehal/shepherd": minor
---

Review and fix a change before a PR exists with `/shepherd --local` and `/swarm --local`. `shepherd local change` captures unpushed commits, staged and unstaged edits and untracked files; `shepherd local finish` checks a review covered every changed range and writes a receipt for that exact content; `shepherd local status` reports whether the files still match it. `shepherd local demo` builds a repository with planted bugs to try it on.
