---
title: "Customize Shepherd for your team"
---

You customize Shepherd with two files in `.shepherd/` and a checklist per rule. Shepherd reads both files from your default branch, so a change takes effect once you merge it. A PR cannot change the rules it is reviewed against.

## Where each change goes

| I want to… | Edit |
| --- | --- |
| Add my team's review rules | `.shepherd/lenses/<name>/SKILL.md`, made by `shepherd lens new <name>` |
| Run those rules only on some directories | The lens's `applies_to` in `.shepherd/config.yml` |
| Choose what Shepherd may change: nothing, my working tree, or the PR branch | `fixes.mode` in `.shepherd/config.yml` |
| Keep fixes out of code a person must own | `escalate.paths` in `.shepherd/config.yml` |
| Make the gate refuse or escalate when a rule breaks | `gate:` on the lens, plus `rules_from` in `.shepherd/gate.yml` |
| Stop the gate approving changes to some files | A `deny` category in `.shepherd/gate.yml` |
| Set the tests, linters and models | `checks` and `models` in `.shepherd/config.yml` |
| Share all of this across repositories | A pack, named under `extends` |

## Two policies: fixing and approval

`.shepherd/config.yml` decides what Shepherd reviews and what it may fix. `.shepherd/gate.yml` decides what the gate may approve.

They answer different questions. `escalate.paths` stops Shepherd fixing `src/api/auth.ts`, but the gate can still approve a person's change to it. A `deny` category stops the gate approving any change to it, whoever wrote it. Most teams want both for their most sensitive code.

## Example: our team requires tenant ownership checks

Your API serves many customers from one database. Every handler that loads a record must check the record belongs to the caller's tenant. This walkthrough turns that rule into a reviewer, keeps fixes away from the auth module, and makes the gate send a missing check to a person.

### 1. Create the lens

```bash
shepherd lens new tenancy --applies 'src/api/**' --description "Tenant ownership checks for API handlers"
```

That writes `.shepherd/lenses/tenancy/SKILL.md` and registers it in `.shepherd/config.yml`. The lens runs on every PR that changes a file under `src/api/`.

### 2. Write the checklist

Replace the template's placeholders with your rules. Give each rule an id; findings post as `[tenancy/<id>]`.

```markdown
---
name: tenancy
description: Tenant ownership checks for API handlers. Flags a read or write of tenant data that does not check the caller's tenant.
---

# tenancy

## Review

- **owner-check** [refuse]: A handler that reads or writes a tenant's record checks that the record belongs to the caller's tenant before it returns or changes anything. Flag: a lookup by id alone, such as `db.invoices.find(id)`, with no `tenantId` condition. Why: one customer reads another's data.
- **tenant-from-session**: The tenant id comes from the authenticated session, never from the request body, query or headers. Flag: `req.body.tenantId` or a header used to scope a query. Why: a caller can name any tenant.

## Fix

- Prefer: `requireTenant(user, record)` from `src/api/auth.ts`.
- Escalate: any change to `src/api/auth.ts` itself.
```

`[refuse]` marks a rule that names a security or data-loss defect. Shepherd grades it at full severity, and the gate refuses a PR that breaks it. `## Fix` tells Shepherd how to fix a finding; leave it out and Shepherd uses its own rules.

### 3. Keep people in charge of the auth module

Add this to `.shepherd/config.yml`:

```yaml
lenses:
  tenancy:
    skill: .shepherd/lenses/tenancy
    applies_to: ['src/api/**']
    description: Tenant ownership checks for API handlers
    gate: escalate               # the gate escalates a broken untagged rule to a person
escalate:
  paths: ['src/api/auth.ts', 'migrations/**']
  reason: a person reviews auth and schema changes
```

Shepherd still reviews `src/api/auth.ts` but hands any fix there to the author.

### 4. Make the gate enforce it

In `.shepherd/gate.yml`, add `rules_from` at the top level, and add `auth` inside the existing `deny:` map, next to `gate_policy`:

```yaml
rules_from: { shepherd: {} }     # every lens becomes a gate rule pack

deny:
  auth:                          # new: your category
    description: auth changes go to a person
    match:
      paths: ['^src/api/auth\.ts$']   # regular expressions, matched against each changed path
  gate_policy:                   # already there: keep it as it is
    # ...
```

Keep `gate_policy` as it is: it stops the gate approving changes to its own policy, and the gate refuses a file without it. Add `auth` to the `deny:` map that is there; a second `deny:` key makes the file invalid.

The gate now refuses a PR that breaks `owner-check`, escalates one that breaks `tenant-from-session`, and never approves a change to the auth module.

### 5. Check it

Each file has its own check. `shepherd config validate` checks `.shepherd/config.yml` and your lenses; `shepherd gate config` checks `.shepherd/gate.yml`. Both exit 1 on a mistake, so CI can run them.

```bash
shepherd config validate                     # .shepherd/config.yml and the lenses it names
shepherd gate config --policy-dir .shepherd  # .shepherd/gate.yml as you edited it, and every gate setting
shepherd lens list                           # each lens, its files, and any problem with its rules
shepherd config explain --working-tree       # every Shepherd setting and the file it came from
shepherd preview --working-tree              # the reviewers, models and writes for your current change
```

`config explain` shows `lenses.tenancy` and `escalate.paths` with `.shepherd/config.yml` as their source. `preview` lists `tenancy` among the reviewers when your change touches `src/api/`.

To see the lens find something before you merge it, run `/swarm --preview` in your coding agent on a branch that changes a handler. It reports what each lens found and posts nothing.

### 6. Merge it

Commit `.shepherd/` and merge it to the default branch. The gate's own rules protect `.shepherd/gate.yml`, so a person approves this PR. From the next PR on, the lens reviews every change under `src/api/`, and the gate holds the rules you wrote.

## Go further

- [Build and share review lenses](/shepherd/configuration/lenses/): starter templates, rule tags, trimming a pack's rules.
- [Compose team policy and recipes](/shepherd/configuration/team-policy/): packs, layering and custom recipes.
- [Compose reviews for your stack](/shepherd/configuration/stacks/): bundled lenses for React, Node, Go and more.
- [Choose models](/shepherd/configuration/models/): tiers, a cost ladder, and a model per lens.
- [Configuration reference](/shepherd/reference/configuration/): every key.
