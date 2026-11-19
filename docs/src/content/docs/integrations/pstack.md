---
title: "Use Shepherd with pstack"
description: "Install Shepherd beside pstack, review against pstack's principles, use any pstack skill as a lens, and split the work on a pull request between the two."
---

[pstack](https://github.com/cursor/plugins/tree/main/pstack) shapes how an agent writes a change: its `poteto-mode` skill routes a task to a playbook and holds the agent to a set of engineering principles. Shepherd starts once the change exists. It reviews the change, fixes the findings and repairs CI, and its [review in GitHub Actions](/shepherd/integrations/github-actions/) gives the verdict. Install both to cover a change from first edit to approval.

## Install side by side

Shepherd installs as a plugin, like pstack. In Claude Code, run:

```text
/plugin marketplace add jagreehal/shepherd
/plugin install shepherd@shepherd
```

Pick the install that fits your setup:

- **Cursor plugin**: Shepherd's Cursor manifest is `.cursor-plugin/plugin.json`. For a local install, clone the repository into `~/.cursor/plugins/local/shepherd`.
- **CLI**: `bun add -g @jagreehal/shepherd` puts the `shepherd` command on your `PATH`. Then `shepherd install`, or `shepherd install --target ~/.cursor/skills`, copies the skills.

A plugin install puts no command on your `PATH`, so the skills fall back to `bunx @jagreehal/shepherd`.

### Run the right swarm skill

Both packs ship a skill named `swarm`. pstack's runs parallel workers over slices of a task. Shepherd's reviews a pull request through lenses. `/shepherd` loads its own sub-skills by path, so the loop runs Shepherd's `swarm`.

To type a `swarm` skill on its own:

- **In Claude Code**: use the plugin prefix, `/pstack:swarm` or `/shepherd:swarm`.
- **In Cursor**: pick the skill from the `/` menu by its description.

To list every skill name another plugin shares with Shepherd, run `shepherd doctor`.

## Review against pstack's principles

The `pstack` lens turns the principles pstack's agents follow into review rules:

- Fix the root cause.
- Keep checks at the boundary.
- Let types and data structures carry the domain.
- Collapse one-caller layers.
- Delete the old API with its last caller.
- Make steps idempotent.
- Write tests that can fail.
- Prove what the pull request claims.

Swarm reviews against these rules. The review in CI reads them as a rule pack through `rules_from: { shepherd: {} }` under `review:`.

To add the lens, pick one of these:

- **A copy your team owns and trims**: scaffold it from the template.

  ```bash
  bunx @jagreehal/shepherd lens new pstack --from pstack
  ```

- **The pack, pinned to a commit**: extend it to stay in step with Shepherd's copy.

  ```yaml
  # .shepherd/config.yml
  extends:
    - github:jagreehal/shepherd/packs/pstack.yml@<sha>
  ```

The lens's gate is `note`. The rules are judgement calls, so the review records a broken one without refusing the pull request. Raise the gate to `escalate` once the team agrees.

`shepherd init` tells you if pstack is installed and the lens isn't yet in your policy.

## Use any pstack skill as a lens

A lens can name an installed plugin's skill as `<plugin>:<skill>`. Shepherd finds the skill in Claude Code's plugin install record and in Cursor's plugin cache:

```bash
bunx @jagreehal/shepherd lens add pstack:principle-type-system-discipline --name types --applies '**/*.ts'
```

Some pstack skills target an agent doing the work, and they carry no `## Review` rules. To convert one into a lens with stable rule ids first, run `/lens-import pstack:<skill>`.

## Split the work between pstack and Shepherd

Find each step of a change in the first column to see which tool handles it:

| Step | pstack | Shepherd |
| --- | --- | --- |
| Write the change | `poteto-mode` playbooks, principles | |
| Review it | `interrogate` on demand | `swarm` on every round, lenses including `pstack` |
| Work the review threads | `babysit` playbook | `triage`, which never touches a thread a person is in |
| Repair CI | `babysit` playbook | `ci-repair` |
| Approve | | The CI review's verdict, with the fact it rests on; a person approves |
| Land | `shipping` playbook | You merge |

Pick one owner for a pull request's review threads and CI. If `/shepherd` runs on a pull request, leave pstack's `babysit` off it, so two loops don't push to the same branch.

## Related resources

- [Build and share review lenses](/shepherd/configuration/lenses/): write, add and share lenses like `pstack`
- [Compose team policy and recipes](/shepherd/configuration/team-policy/): extend packs such as `packs/pstack.yml`
- [Command reference](/shepherd/reference/commands/): `shepherd install`, `shepherd lens` and `shepherd doctor`
- [Credits](/shepherd/reference/credits/): the licence for the pstack principles the lens adapts
