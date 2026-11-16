---
"@jagreehal/shepherd": minor
---

Workflow version pins now read `${{ vars.SHEPHERD_VERSION || '<version>' }}`. Set the `SHEPHERD_VERSION` repository variable to move every job to a new release without editing workflow files. `workflows --upgrade` and `gate init --upgrade` write pins in this form. `shepherd review` runs from a terminal and exits inside GitHub Actions, where the workflow already drives the loop.
