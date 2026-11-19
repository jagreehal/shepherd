---
title: "Upgrade and maintain your setup"
description: "Install a new Shepherd release, regenerate the workflow and policy files from it, and check the upgrade on a test pull request before you rely on it."
---

Shepherd runs at the version pinned in your workflow, so an upgrade is a change you make and review like any other. This page is for whoever maintains Shepherd in a repository. Before you start, commit your current policy and workflow files, and review the upgrade in its own pull request.

## Update the package

To install a release, choose the version you want and substitute it:

```bash
bun add -g @jagreehal/shepherd@<version>
```

If you run Shepherd with `bunx`, include `@<version>` when reproducibility matters. `shepherd.yml` pins `SHEPHERD_VERSION` and keeps that version until you [update the generated files](#update-generated-files).

## Update generated files

To move the workflow to the new release, run `shepherd workflows --upgrade` with the new version, then review what it changed.

**1. Run the upgrade**

```bash
shepherd workflows --upgrade
```

The command does each of these:

- **Workflow**: rewrites `.github/workflows/shepherd.yml` from that release's template and pins `SHEPHERD_VERSION`. It keeps the job's environment, OIDC and region.
- **Older gate policy**: moves an older `.shepherd/gate.yml` under `review:` in `.shepherd/config.yml`, and removes `gate.yml` once the new file reads back.
- **Older workflows**: prints which older workflow files to delete: `shepherd-gate.yml`, `shepherd-gate-edited.yml`, `shepherd-gate-actions.yml`, `shepherd-incident.yml` and `shepherd-audit.yml`.

`shepherd init` keeps your `.shepherd/config.yml`.

**2. Review the diff and run doctor**

Read the diff, delete the older workflow files the command named, then run:

```bash
shepherd doctor
```

**3. Review custom policy on its own**

Review custom policy changes separately from engine changes. Shepherd reads repository policy from the default branch, so a policy edit that isn't merged doesn't govern a pull request's run.

### Upgrade when you can't edit workflows

If workflow edits are blocked, set the `SHEPHERD_VERSION` repository variable to the new version instead. The job installs that version over the pin written in the file. To return to the pin, delete the variable.

## Check an upgrade

To confirm the upgrade works, run the [first-run checks](/shepherd/start/quickstart/) on a test pull request. Check each of these:

- **Verdict or mode**: the review reaches the one you expect.
- **Diff and GitHub writes**: read the diff and each write Shepherd made to GitHub.
- **Notifications**: if you enabled them, confirm they arrive.

Keep the previous version available. If the upgrade fails, restore the workflow pin to that version.

## Related resources

- [Changelog](https://github.com/jagreehal/shepherd/blob/main/CHANGELOG.md): what changed in each release
- [Set up the review in GitHub Actions](/shepherd/integrations/github-actions/): the workflow the upgrade rewrites
- [Send pull request state notifications](/shepherd/integrations/notifications/): the notifications to check after an upgrade
- [Troubleshoot a review or repair](/shepherd/operations/troubleshooting/): a review that didn't start or didn't finish after the upgrade
