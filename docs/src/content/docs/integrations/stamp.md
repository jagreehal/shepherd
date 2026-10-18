---
title: "Use Shepherd with Stamp"
---

```mermaid
sequenceDiagram
    participant SH as shepherd
    participant GH as GitHub
    participant ST as stamp (CI)
    participant You
    SH->>GH: push fixes, apply label in label mode
    GH->>ST: workflow runs on the head
    ST->>GH: verdict review
    SH->>GH: read the verdict
    alt APPROVED
        SH->>GH: status success
    else REFUSED
        SH->>SH: triage the refusal's issues
    else ESCALATE
        SH->>You: leave it for you
    end
```

stamp's deterministic gates and approval sit at the end of the loop. In label mode shepherd applies the label once per head; in all-PRs mode stamp runs on each push by itself. Either way shepherd reads the verdict, acts on a refusal's issues through triage, and leaves an escalation to you. stamp keeps an approval across a base merge that leaves the diff unchanged, so ci-repair's branch updates cost no re-review.

Run locally, swarm's comments post through the author's account; in GitHub Actions they post as `github-actions[bot]`. A gate that treats another reviewer's comment as assurance must not count them; the comment header tells them apart. stamp treats both as automated.
