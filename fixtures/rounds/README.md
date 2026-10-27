# Replayed rounds

Real `round.json` files that models handed off in CI, with the files they reviewed. `src/replay.test.ts` renders each
one as the publish job does and checks that it renders, that each inline comment lands inside its file with one comment
per place, that the summary cites the same lines, and that a suggestion keeps the indentation of the line it replaces.

Each folder is one reviewed head:

```
<name>/
  files/<path>             the reviewed files at that head
  rounds/<version>-run<n>/ round.json and fanout.json from one CI run's shepherd-handoff artifact
```

Add a round from any CI run whose output you want to keep:

```bash
gh run download <run-id> -R <owner/repo> -n shepherd-handoff -D fixtures/rounds/<name>/rounds/<version>-run<n>
```

Keep the artifact's `round.json` and `fanout.json`, and add any reviewed file the round cites under `files/`. The
fixtures stay out of the npm package.
