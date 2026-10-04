---
"@jagreehal/shepherd": patch
---

Triage and swarm weigh everything open on a PR.

- Triage names a custom lens's threads when it classifies them, and judges a finding from the code, the threads and the default branch's rules, never from the PR title, body or repository description.
- A thread left for the author holds back only the fixes that would carry out its decision; local fixes inside the same code go ahead.
- Triage resolves a thread only when everything it names is fixed, adds a test that pins any behaviour it changes, and keeps each behaviour change the PR already disclosed.
- Swarm grades its verdict on its findings plus every open thread from any reviewer, and a current gate refusal.
- A diff over ~400 lines always gets a `correctness` delegation.
- A finding whose fix would keep a problem an open thread names says so and names the thread.
- Resolved Shepherd threads show `✅ Resolved at <sha>`, "still open" entries link to their threads, and HIGH and CRITICAL comments carry the verifier's evidence.
- The "Changes made during review" section drops or corrects any line a later commit undid.
