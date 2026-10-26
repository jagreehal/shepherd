---
"@jagreehal/shepherd": patch
---

The summary renderer accepts a round that borrows words from swarm's other JSON shapes. It maps `changes_needed`, `approve_with_nits` and `looks_good` onto the round's verdicts, maps lens statuses such as `completed` and `skipped` onto `ok` and `could_not_run`, keeps a lens's `reason` as its take, reads `verified: true` as unverified, and defaults a missing `why` to empty. Unknown values still fail.

In handoff mode, swarm and the workflow prompt have the model check `round.json` with `shepherd summary <round.json> --body > /dev/null` and fix each error before it stops. Run `shepherd workflows --upgrade` to pick up the new prompt.
