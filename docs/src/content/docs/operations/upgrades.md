---
title: "Upgrade and maintain your setup"
---

Review a version upgrade in its own PR. Commit your current policy and workflow files before you change them.

## Update the package

Choose the release you want to run and substitute its version:

```bash
bun add -g @jagreehal/shepherd@<version>
```

If you use `bunx`, include `@<version>` when reproducibility matters. Update `SHEPHERD_VERSION` in your GitHub Actions workflows too: every job that installs the CLI pins it (`iterate` and `publish` in `shepherd.yml`, `investigate` in `shepherd-incident.yml`). An existing workflow continues to use its pinned version until you edit it.

## Update generated files

`shepherd workflows` keeps existing files, and `shepherd init` refuses to overwrite a policy file. Rerunning setup does not upgrade a workflow you already have. Compare your files with the templates at the chosen release and carry over the changes you need, including permissions, triggers and credential handling.

Review custom policy separately from engine changes. Both tools read repository policy from the default branch, so an unmerged policy edit does not govern a PR run.

## Check an upgrade

Run the first-run checks on a test PR. Confirm the expected verdict or mode, check the diff and GitHub writes, and verify notifications if you enabled them. Keep the previous version available so you can restore the workflow pin if the upgrade fails.

Read the [changelog](https://github.com/jagreehal/shepherd/blob/main/CHANGELOG.md) for release changes and [Stamp integration](/shepherd/integrations/stamp/) for the other half of the review loop.
