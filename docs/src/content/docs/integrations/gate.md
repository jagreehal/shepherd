---
title: "Use Shepherd with the gate"
---

```mermaid
sequenceDiagram
    participant SH as shepherd
    participant GH as GitHub
    participant ST as the gate (CI)
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

The gate's deterministic gates and approval sit at the end of the loop. In label mode shepherd applies the label once per head; in all-PRs mode the gate runs on each push by itself. Either way shepherd reads the verdict, acts on a refusal's issues through triage, and leaves an escalation to you. The gate keeps an approval across a base merge that leaves the diff unchanged, so ci-repair's branch updates cost no re-review.

Run locally, swarm's comments post through the author's account; in GitHub Actions they post as `github-actions[bot]`. A gate that treats another reviewer's comment as assurance must not count them; the comment header tells them apart. The gate treats both as automated.
