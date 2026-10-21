---
title: "Compose reviews for your stack"
---

Shepherd ships a starter lens for each common stack. Pick the ones your repository uses, trim the rules you don't want, and add your own on top. Stamp reads the same lenses as rule packs, so you declare them once.

## The catalogue

Each lens lives in `lenses/<name>/SKILL.md`, with a pack in `packs/<name>.yml` that sets its files and gate.

| Lens | Covers | `applies_to` |
| --- | --- | --- |
| `react` | State derived in effects, effects that race or skip cleanup, stale closures, unstable identities, injected HTML, secrets in client code | `**/*.tsx`, `**/*.jsx` |
| `nextjs` | Server/client boundary leaks, route handler auth, caching, `NEXT_PUBLIC_*` hygiene, bundle weight. Extends `react` | `**/app/**`, `**/pages/**`, `**/middleware.{ts,js}`, `**/next.config.*` |
| `node-api` | Middleware mount order, per-resource authorisation, unvalidated input, error leakage, hung requests, lost work (Express, Fastify, Hono, Koa, NestJS) | every `.ts`, `.js`, `.mts`, `.mjs` file; narrow it to your services |
| `nx-monorepo` | Deep imports past a project's entry, project cycles, shared contracts changed without dependents, loosened boundary rules, targets and cache inputs that stop covering code, untagged projects, env in shared libs, version drift | `**/project.json`, `nx.json`, `libs/**`, `packages/**`, `**/tsconfig*.json` |
| `go` | Context flow, goroutine lifetime, data races, wrapped errors, unclosed resources, HTTP timeouts, injection | `**/*.go` |
| `rust` | `unsafe` without a SAFETY argument, `unwrap` on fallible input, blocking in async, untrusted decoding, injection | `**/*.rs` |
| `java` | `@Transactional` pitfalls, N+1 and unbounded queries, endpoint authorisation, unsafe parsing, injection (Spring included) | `**/*.java` |
| `dotnet` | Sync-over-async, `async void`, cancellation tokens, endpoint authorisation, unsafe deserialisation, injection (ASP.NET Core) | `**/*.cs` |
| `python` | Injection, unsafe deserialisation, view authorisation, swallowed errors, blocking calls in async code (Django, FastAPI, Flask) | `**/*.py` |
| `observability` | Spans, trace context, structured logs, sensitive data in telemetry, alertable signals | source files in every language above |
| `owasp-asvs` | OWASP ASVS 5.0 requirements a diff can break: injection, SSRF, access control, sessions, tokens, crypto, password storage, file handling, error leakage. Each rule cites its ASVS ids and CWE | source files in every language above; `init --stacks` adds it to every detected stack |
| `owasp-llm` | OWASP LLM Top 10 2025, Agentic Top 10 2026 and MCP review: untrusted content in prompts, model output used as code or SQL, tool permissions, excessive agency, MCP auth | none: the router picks it; add `applies_to` for your AI directories |
| `pstack` | pstack's engineering principles: root-cause fixes, checks at the boundary, types and structures that carry the domain, one-caller layers, legacy APIs kept beside their replacement, non-idempotent steps, tests that cannot fail, unproven claims. Gate `note`. Read [Use Shepherd with pstack](/shepherd/integrations/pstack/) | source files in every language above; not detected, add it with `lens new pstack --from pstack` |

Rules tagged `[refuse]` name security or data-loss defects. The rest follow the pack's `gate`: `escalate` for every bundled pack except `pstack`, which is `note`.

## Add lenses for the stacks you use

`shepherd init --stacks` reads your tracked files (`package.json` dependencies, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `*.csproj`, `pyproject.toml`) and copies a lens for each stack it finds into `.shepherd/lenses/`. You own the copies and can edit them.

```bash
bunx @jagreehal/shepherd init --stacks
bunx @jagreehal/shepherd lens new go --from go --applies 'services/**/*.go'   # one at a time
```

To stay in step with shepherd's own rules, extend the packs instead of copying them. Pin each pack to a commit on `jagreehal/shepherd`'s default branch.

## Compose: organisation, then stacks, then the repository

Settings layer in the order you list them. An organisation pack sets house rules, stack packs add the framework rules, and the repository trims both. A pack can extend packs of its own (the `nextjs` pack extends `react`), up to four deep.

```yaml validate-config
# .shepherd/config.yml
extends:
  - github:acme/review-packs/org.yml@0123456789abcdef0123456789abcdef01234567
  - github:jagreehal/shepherd/packs/nextjs.yml@0123456789abcdef0123456789abcdef01234567   # brings react too
  - github:jagreehal/shepherd/packs/go.yml@0123456789abcdef0123456789abcdef01234567
lenses:
  react:
    disable: ['html-injection']            # trim a pack's lens by name; its skill comes from the pack
  go:
    applies_to: ['services/**/*.go']       # rescope it to the code you ship
  billing:
    skill: .shepherd/lenses/billing        # a lens of your own
    applies_to: ['services/billing/**']
    gate: refuse
```

A lens entry merges field by field, so `react: { disable: [...] }` keeps the pack's skill and files. `only` keeps the rules whose ids match its globs; `disable` drops them. `shepherd lens list` reports a glob that matches no rule.

The same layering works for any language. A Rust service extends `packs/rust.yml`, a .NET API `packs/dotnet.yml` with `observability`, a Django app `packs/python.yml`, a Java monolith `packs/java.yml` with `only: ['injection', 'endpoint-authz']` to start small.

## Convert any other skill

For a rule set the catalogue lacks, run `/lens-import` in your agent with an installed skill, a path, a pinned `github:` source or a style guide. It writes `.shepherd/lenses/<name>/SKILL.md` with one id per rule, severity tags, `## Fix` guidance and the source's licence, then checks it with `shepherd lens list`.

You can also pass a collection directory. The importer selects skills for the
target repository, accounts for excluded and uncertain rules, and splits large
sources into separately registered lenses. Each import includes local source
references and an `import-report.json` with provenance, licence evidence and
examples of code that should and should not trigger a finding. Performance and
style guidance stays advisory; source priority labels do not become refusals.

The bundled `lens-import/scripts/check-import.mjs` checks the report's output
mapping, instruction budgets and local links. Shepherd's normal lens and config
checks still run, and the importer checks semantic fidelity separately. An
action-only skill can produce no lens. Existing imports keep local rule edits
and configuration when updated.

## Stamp reads the same lenses

Add one block to `.stamp/policy.yml` and stamp treats every shepherd lens as a rule pack, from the same default branch. Each lens's `gate` becomes its `on_break`, and each rule's tag overrides that for the one rule.

```yaml
# .stamp/policy.yml
rules_from:
  shepherd: {}             # on_break defaults to escalate for lenses with no gate
```

A `rules:` entry with the same name wins over the inherited lens. Stamp sends a PR that edits `.shepherd/config.yml`, a local pack or an inherited lens file to a person, since those files decide how later PRs get judged.

## OWASP lenses

`owasp-asvs` and `owasp-llm` adapt the [OWASP Secure Agent Playbook](https://github.com/OWASP/secure-agent-playbook) (CC-BY-4.0) for diff review. They hold for every language, so they compose with any stack pack. For the playbook's whole-repository plays, run the [scheduled security audit](/shepherd/guides/security-audit/).
