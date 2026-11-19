---
title: "Measure review accuracy"
description: "Run swarm over frozen changes with confirmed bugs, score precision and recall per configuration, and compare skill edits and model choices."
---

`shepherd eval` measures how well reviews find bugs. It runs swarm over frozen changes whose bugs a person confirmed, so you can compare skill edits and model choices by precision and recall. This page is for contributors changing a skill or the model ladder; the full method lives in [evals/README.md](https://github.com/jagreehal/shepherd/blob/main/evals/README.md).

## Run it around a skill or model change

Run an eval before and after these changes:

- **Skill edits**: any edit meant to change what reviews find.
- **Model ladder**: any change to the model ladder.

## Run and score the cases

**1. Run the cases**

This runs one configuration, three reviews per case:

```bash
shepherd eval run evals/cases --config sonnet --repeat 3 -- \
  claude -p "/swarm --local --base {base}" --model sonnet --output-format json
```

`{base}` and `{head}` in the agent command are filled in per case. Each run reviews a fresh clone of the case's head, so no pull request comment reaches the reviewer. Each invocation's runs land in a directory of their own.

**2. Score the runs**

```bash
shepherd eval score evals/runs
```

The score reports results per configuration, with development and held-out cases apart.

## Read the scores

The score reports these figures:

- **Recall**: bugs found over bugs. A run that didn't complete found nothing.
- **Precision**: bugs found over findings above NIT, across completed runs.
- **False positives, near misses and duplicates**: findings credited to no bug, those beside a bug that didn't name it, and repeats of a bug already found.
- **Incomplete runs**: runs whose record was missing, not JSON, invalid or incomplete. The score keeps them and never reads them as a clean review.

A finding is credited to a bug only when it sits near it and names the defect.

The score picks the cheapest configuration within noise of the best held-out scores. It picks one only once every configuration completed the same cases the same number of times.

## Related resources

- [evals/README.md](https://github.com/jagreehal/shepherd/blob/main/evals/README.md): reading the scores in detail, the dev and held-out splits, and adding cases
- [Choose models](/shepherd/configuration/models/): the model ladder an eval decides
- [Improve reviews with garden](/shepherd/operations/gardening/): garden proposes a held-out case for each incident review let through
- [Develop Shepherd](/shepherd/contributing/development/): the checks that run on every commit
