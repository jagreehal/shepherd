---
title: "Measure review accuracy"
---

`shepherd eval` measures how well reviews find bugs. It runs swarm over frozen changes whose bugs a person confirmed, so you can compare skill edits and model choices by precision and recall.

```bash
shepherd eval run evals/cases --config sonnet --repeat 3 -- \
  claude -p "/swarm --local --base {base}" --model sonnet --output-format json
shepherd eval score evals/runs
```

Each run reviews a fresh clone of the case's head, so no PR comment reaches the reviewer, and lands in a directory of its own invocation. A finding is credited to a bug only when it sits near it and names the defect. The score reports recall (a run that did not complete found nothing), precision, false positives, near misses, duplicates and incomplete runs, per configuration, with development and held-out cases apart. It picks the cheapest configuration within noise of the best held-out scores, and only once every configuration completed the same cases the same number of times.

Run it before and after any skill edit meant to change what reviews find, and before changing the model ladder. How to read the scores and add cases: [evals/README.md](https://github.com/jagreehal/shepherd/blob/main/evals/README.md).
