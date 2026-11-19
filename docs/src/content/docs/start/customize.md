---
title: "Customize Shepherd for your team"
description: "Tune what Shepherd flags with your house rules and lenses, keep fixes away from code a person owns, make the review refuse or escalate a broken rule, and check each change before you merge it."
---

You change what Shepherd reviews by committing instructions to your repository: `.shepherd/config.yml` and a checklist for each rule. Shepherd reads them from your default branch, so a change takes effect once you merge it, and a pull request can't change the rules Shepherd reviews it against.

:::note
Your existing `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `CONTRIBUTING.md` and `CODING_STANDARDS.md` already steer the review with no setup. Shepherd reads `REVIEW.md` the way Claude Code Review does, so one file steers both. See [What it reads](/shepherd/integrations/github-actions/#what-it-reads).
:::

## Where each change goes

Find what you want in the first column:

| I want to… | Edit |
| --- | --- |
| Have the review point out where a change breaks the conventions we already wrote down | Nothing. Shepherd reads `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `CONTRIBUTING.md` and `CODING_STANDARDS.md` from the default branch, at the root and in each directory above a changed file. A `REVIEW.md` breach gets a line comment that triage fixes, or on a stacked pull request a line in the review. A breach of the others gets a note. `@` includes and `.claude/skills/` or `.agents/skills/` skills work as they do in Claude Code Review |
| Add my team's review rules | `.shepherd/lenses/<name>/SKILL.md`, made by `shepherd lens new <name>` |
| Run those rules only on some directories | The lens's `applies_to` in `.shepherd/config.yml` |
| Choose what Shepherd may change: nothing, my working tree, or the pull request branch | `fixes.mode` in `.shepherd/config.yml` |
| Keep fixes out of code a person must own | `escalate.paths` in `.shepherd/config.yml` |
| Make the review refuse or escalate a broken rule | `gate:` on the lens in `.shepherd/config.yml` |
| Stop the review approving changes to some files | A `deny` category under `review:` in `.shepherd/config.yml` |
| Set the tests, linters and models | `checks` and `models` in `.shepherd/config.yml` |
| Share all of this across repositories | A pack, named under `extends` |

## Fixing and approval are two policies

`.shepherd/config.yml` holds two policies. The top of the file decides what Shepherd reviews and what the local skills may fix. The `review:` section decides what the review in CI may approve.

Each answers a different question:

- **`escalate.paths`**: stops Shepherd fixing `src/api/auth.ts`, but the review can still approve a person's change to it.
- **A `deny` category**: stops the review approving any change to it, whoever wrote it.

For your most sensitive code, you'll want both.

## Example: require tenant ownership checks

Your API serves many customers from one database, and each handler that loads a record must check the record belongs to the caller's tenant. This walkthrough turns that rule into a reviewer, keeps fixes away from the auth module, and makes the review send a missing check to a person.

**1. Create the lens**

```bash
shepherd lens new tenancy --applies 'src/api/**' --description "Tenant ownership checks for API handlers"
```

The command writes `.shepherd/lenses/tenancy/SKILL.md` and registers the lens in `.shepherd/config.yml`. The lens runs on each pull request that changes a file under `src/api/`.

**2. Write the checklist**

Replace the template's placeholders with your rules. Give each rule an id: Shepherd posts its findings as `[tenancy/<id>]`.

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

The checklist uses two markers:

- **`[refuse]`**: marks a rule that names a security or data-loss defect. Shepherd grades it at full severity, and the review refuses a pull request that breaks it.
- **`## Fix`**: tells Shepherd how to fix a finding. Leave it out, and Shepherd uses its own rules.

**3. Keep people in charge of the auth module**

Add this to `.shepherd/config.yml`:

```yaml
lenses:
  tenancy:
    skill: .shepherd/lenses/tenancy
    applies_to: ['src/api/**']
    description: Tenant ownership checks for API handlers
    gate: escalate               # the review escalates a broken untagged rule to a person
escalate:
  paths: ['src/api/auth.ts', 'migrations/**']
  reason: a person reviews auth and schema changes
```

Shepherd still reviews `src/api/auth.ts`, but hands any fix there to the author.

**4. Make the review enforce it**

The review already reads your lenses as rule packs. To send auth changes to a person as well, add `auth` inside the existing `deny:` map under `review:` in `.shepherd/config.yml`, next to `gate_policy`:

```yaml
review:
  deny:
    auth:                          # new: your category
      description: auth changes go to a person
      match:
        paths: ['^src/api/auth\.ts$']   # regular expressions, matched against each changed path
    gate_policy:                   # already there: keep it as it is
      # ...
```

Keep `gate_policy` as it is. It stops the review approving changes to its own policy, and the review refuses a policy without it. Add `auth` to the `deny:` map that's already there: a second `deny:` key makes the file invalid.

A person decides changes to Shepherd's own setup. Shepherd reads the policy from the default branch, so a pull request can't loosen its own review, and it escalates any edit to `.shepherd/config.yml` under `gate_policy`: once a person who can push approves it, the check turns green. `shepherd init` suggests CODEOWNERS entries for `/.shepherd/` and `/.github/`, and `shepherd doctor` checks they're in place.

The review now refuses a pull request that breaks `owner-check`, escalates one that breaks `tenant-from-session`, and never approves a change to the auth module.

**5. Check it**

Each part has its own check. `shepherd config validate` checks `.shepherd/config.yml` and your lenses, and `shepherd gate config` checks the `review:` section. Both exit 1 on a mistake, so CI can run them.

```bash
shepherd config validate                     # .shepherd/config.yml and the lenses it names
shepherd gate config --policy-dir .shepherd  # review: as you edited it, and every review setting
shepherd lens list                           # each lens, its files, and any problem with its rules
shepherd config explain --working-tree       # every Shepherd setting and the file it came from
shepherd preview --working-tree              # the reviewers, models and writes for your current change
```

`config explain` shows `lenses.tenancy` and `escalate.paths` with `.shepherd/config.yml` as their source. `preview` lists `tenancy` among the reviewers if your change touches `src/api/`.

To see the lens find something before you merge it, run `/swarm --preview` in your coding agent on a branch that changes a handler. It reports what each lens found and posts nothing.

**6. Merge it**

Commit `.shepherd/` and merge it into the default branch. Shepherd escalates an edit to `.shepherd/config.yml`, so a person approves this pull request. From the next pull request on, the lens reviews each change under `src/api/`, and the review holds the rules you wrote.

## Related resources

- [Build and share review lenses](/shepherd/configuration/lenses/): starter templates, rule tags, and trimming a pack's rules
- [Compose team policy and recipes](/shepherd/configuration/team-policy/): packs, layering and custom recipes
- [Compose reviews for your stack](/shepherd/configuration/stacks/): bundled lenses for React, Node, Go and more
- [Choose models](/shepherd/configuration/models/): tiers, a cost ladder, and a model per lens
- [Configuration reference](/shepherd/reference/configuration/): each key in `.shepherd/config.yml`
