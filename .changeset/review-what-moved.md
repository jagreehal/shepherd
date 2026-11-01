---
"@jagreehal/shepherd": minor
---

Later rounds review what moved. `shepherd interdiff` squashes the PR at the last reviewed head and at the new head onto their merge bases and compares them with `git range-diff`, so base merges, rebases and force-pushes leave the focus alone. An `unchanged` result ends the round dry. Each summary records the base tip it reviewed, and `interdiff --since-base` uses it to keep a stacked parent's earlier change out.

Swarm checks coverage before it posts: `shepherd coverage` lists changed ranges no finished lens reached, and the correctness lens takes them. `shepherd impact` hands the router and the correctness lens each changed export's callers and each changed file's tests.

`shepherd inline --diff` posts only findings inside the diff's hunks, so GitHub accepts every review. The summary comment keeps the rest.

Triage applies an all-automated finding the operator gave a 👍.

`shepherd eval export` and `eval import` score another reviewer on the same cases as shepherd.
