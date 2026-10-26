---
"@jagreehal/shepherd": patch
---

`shepherd inline` places each one-click suggestion on the lines it rewrites. It checks the reviewed file and moves the comment to the most similar lines within five of the line the model gave. If nothing nearby is similar enough, it drops the suggestion and keeps the comment. On a live run, a test fix was anchored on the `it(` line above the assertion it rewrote, and committing it would have broken the test file.
