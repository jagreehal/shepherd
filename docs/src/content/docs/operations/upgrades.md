---
title: "Upgrade and maintain your setup"
---

Review a version upgrade in its own PR. Commit your current policy and workflow files before you change them.

## Update the package

Choose the release you want to run and substitute its version:

```bash
bun add -g @jagreehal/shepherd@<version>
```

If you use `bunx`, include `@<version>` when reproducibility matters. Every workflow job that installs the CLI pins `SHEPHERD_VERSION`, and keeps its pinned version until you upgrade it (below).

## Update generated files

Run `shepherd workflows --upgrade` with the new version. It rewrites your workflow files from that release's templates and pins `SHEPHERD_VERSION`, keeping the model job's environment and your `workflows:` list; it stops with `update it by hand` on a file it cannot read. `shepherd init` keeps your `.shepherd/config.yml`. Review the diff, then run `shepherd doctor`.

Review custom policy separately from engine changes. Shepherd and the gate read repository policy from the default branch, so an unmerged policy edit does not govern a PR run.

## Check an upgrade

Run the first-run checks on a test PR. Confirm the expected verdict or mode, check the diff and GitHub writes, and verify notifications if you enabled them. Keep the previous version available so you can restore the workflow pin if the upgrade fails.

Read the [changelog](https://github.com/jagreehal/shepherd/blob/main/CHANGELOG.md) for release changes and [the gate integration](/shepherd/integrations/gate/) for the other half of the review loop.
