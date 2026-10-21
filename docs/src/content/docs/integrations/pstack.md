---
title: "Use Shepherd with pstack"
---

[pstack](https://github.com/cursor/plugins/tree/main/pstack) shapes how an agent writes a change: its `poteto-mode` skill routes a task to a playbook and holds the agent to a set of engineering principles. Shepherd starts once the change exists: it reviews it, fixes the findings, repairs CI and hands the result to [Stamp](https://github.com/jagreehal/stamp) for the approval verdict. Install both to cover the change from first edit to approval.

## Install side by side

Shepherd installs as a plugin, like pstack, or with its CLI:

```text
/plugin marketplace add jagreehal/shepherd
/plugin install shepherd@shepherd
```

Its Cursor manifest is `.cursor-plugin/plugin.json`: for a local install, clone the repository into `~/.cursor/plugins/local/shepherd`. The CLI install still works: `bun add -g @jagreehal/shepherd` puts the `shepherd` command on your PATH, and `shepherd install` (or `shepherd install --target ~/.cursor/skills`) copies the skills. A plugin install has no command on your PATH, so the skills fall back to `bunx @jagreehal/shepherd`.

Both packs ship a skill named `swarm`. pstack's runs parallel workers over slices of a task; Shepherd's reviews a PR through lenses. `/shepherd` loads its own sub-skills by path, so the loop runs Shepherd's `swarm`. When you type a skill on its own, use the plugin prefix in Claude Code (`/pstack:swarm`, `/shepherd:swarm`); in Cursor, pick it from the `/` menu by its description. `shepherd doctor` lists every skill name another plugin shares with Shepherd.

## Review against pstack's principles

The `pstack` lens turns the principles that pstack's agents follow into review rules: fix the root cause, keep checks at the boundary, let types and data structures carry the domain, collapse one-caller layers, delete the old API with its last caller, make steps idempotent, write tests that can fail, and prove what the PR claims. Swarm reviews against them, and Stamp reads them as a rule pack through `rules_from: { shepherd: {} }`.

```bash
bunx @jagreehal/shepherd lens new pstack --from pstack   # a copy your team owns and trims
```

Or extend the pack pinned to a commit, to stay in step with Shepherd's copy:

```yaml
# .shepherd/config.yml
extends:
  - github:jagreehal/shepherd/packs/pstack.yml@<sha>
```

Its gate is `note`: the rules are judgement calls, so Stamp records a broken one without refusing the PR. Raise it to `escalate` once the team agrees.

`shepherd init` tells you when pstack is installed and the lens is not yet in your policy.

## Use any pstack skill as a lens

A lens can name an installed plugin's skill as `<plugin>:<skill>`. Shepherd finds it in Claude Code's plugin install record and in Cursor's plugin cache:

```bash
bunx @jagreehal/shepherd lens add pstack:principle-type-system-discipline --name types --applies '**/*.ts'
```

A pstack skill written for an agent doing the work, not reviewing it, has no `## Review` rules. Run `/lens-import pstack:<skill>` to convert one into a lens with stable rule ids first.

## Where the two meet

| Step | pstack | Shepherd and Stamp |
| --- | --- | --- |
| Write the change | `poteto-mode` playbooks, principles | |
| Review it | `interrogate` on demand | `swarm` on every round, lenses including `pstack` |
| Work the review threads | `babysit` playbook | `triage`, which never touches a thread a person is in |
| Repair CI | `babysit` playbook | `ci-repair` |
| Approve | | Stamp's verdict, with the fact it rests on |
| Land | `shipping` playbook | you merge |

Pick one owner for a PR's review threads and CI. When `/shepherd` runs on a PR, leave pstack's `babysit` off it, so two loops do not push to the same branch.
