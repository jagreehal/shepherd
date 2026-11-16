---
title: "Upgrade and maintain your setup"
---

Review a version upgrade in its own PR. Commit your current policy and workflow files before you change them.

## Update the package

Choose the release you want to run and substitute its version:

```bash
bun add -g @jagreehal/shepherd@<version>
```

If you use `bunx`, include `@<version>` when reproducibility matters. `shepherd.yml` pins `SHEPHERD_VERSION` and keeps that version until you upgrade it (below).

## Update generated files

Run `shepherd workflows --upgrade` with the new version. It rewrites `.github/workflows/shepherd.yml` from that release's template and pins `SHEPHERD_VERSION`, keeping the job's environment, OIDC and region. It moves an older `.shepherd/gate.yml` under `review:` in `.shepherd/config.yml` and removes it once it reads back, and prints which older workflow files to delete (`shepherd-gate.yml`, `shepherd-gate-edited.yml`, `shepherd-gate-actions.yml`, `shepherd-incident.yml`, `shepherd-audit.yml`). `shepherd init` keeps your `.shepherd/config.yml`. Review the diff, then run `shepherd doctor`.

Where workflow edits are blocked, set the `SHEPHERD_VERSION` repository variable to the new version instead: the job installs that version over the pin written in the file. Delete the variable to return to the pin.

Review custom policy separately from engine changes. Shepherd reads repository policy from the default branch, so an unmerged policy edit does not govern a PR run.

## Check an upgrade

Run the first-run checks on a test PR. Confirm the expected verdict or mode, check the diff and GitHub writes, and verify notifications if you enabled them. Keep the previous version available so you can restore the workflow pin if the upgrade fails.

Read the [changelog](https://github.com/jagreehal/shepherd/blob/main/CHANGELOG.md) for release changes and [GitHub Actions](/shepherd/integrations/github-actions/) for the workflow.
