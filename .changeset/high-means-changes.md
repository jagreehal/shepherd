---
"@jagreehal/shepherd": minor
---

Swarm's verdict, lens table and inline review follow the findings more closely.

- A confirmed HIGH reads CHANGES NEEDED. A MEDIUM alone still reads APPROVE WITH NITS.
- A lens's take in the lens table is the worst severity among the findings that name it. When `shepherd fanout` listed a first wave for the head, the router is expected too, and a round without it shows it as `could_not_run`.
- The inline review's marker carries a fingerprint of its comments, so a new round on the same head posts its own comments. Run `shepherd workflows --upgrade` to pick this up.
- A thread link that is not a GitHub URL is dropped and the finding kept. The publish job warns and stops when it has nothing to render.
