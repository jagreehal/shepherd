---
name: nx-monorepo
description: Nx monorepo rules for a code review. Flags changes that break project boundaries or quietly switch off what keeps a monorepo honest. Covers deep imports past a project's public entry, circular project dependencies, shared contracts changed without their dependents, app code in shared libs, targets, inputs, outputs and cache settings that stop affected and caching from covering code, loosened tags and dependency constraints, path aliases that bypass boundaries, untagged projects, implicit dependency workarounds, environment and secrets in shared libs, and version drift between projects. Use as a review lens or as a stamp rule pack.
---

# nx-monorepo

A monorepo holds together because of its boundaries and its build graph.
Review whether this change keeps each project behind its public entry, keeps
the graph acyclic and accurate, and leaves the rules that enforce both intact.

## Review

- **public-entry**: Code imports another project only through its published entry (`@org/lib`, its `index.ts`). Flag: an import reaching into `libs/x/src/lib/...`, a relative path climbing into another project, a re-export of internals to get around the entry. Why: internals become a contract nobody agreed to, and refactors break distant apps.
- **no-cycles**: A new import keeps the project graph acyclic. Flag: lib A importing lib B when B already imports A, directly or through a third project; a cycle papered over with a lazy `import()`. Why: cycles break build order, caching and affected detection.
- **shared-contract**: A change to a shared lib's exported types, functions or behaviour updates every dependent in the same PR, or keeps the old shape. Flag: a renamed or removed export, a changed signature or return shape, with dependents untouched in the diff. Why: other apps break at their next build or, worse, at runtime.
- **lib-purity**: Shared libs hold code more than one app uses, with no app-specific logic. Flag: an app's route, feature flag, copy or business rule added to a shared or `util` lib; a shared lib importing from an app. Why: every app now carries and couples to one app's behaviour.
- **boundary-rules** [refuse]: Module boundary enforcement stays on and as strict as it was. Flag: `@nx/enforce-module-boundaries` disabled or downgraded, `depConstraints` widened (`onlyDependOnLibsWithTags: ['*']`), a project's tags changed to escape a constraint, an `eslint-disable` for the boundary rule. Why: the one check that keeps the architecture is gone, and nothing says so.
- **graph-accuracy**: Targets, `inputs`, `outputs`, `namedInputs` and cache settings in `project.json` or `nx.json` still cover every file that affects the result. Flag: inputs narrowed so a source, config or env change no longer invalidates the cache, outputs missing a build directory, `cache: false` or `parallel` changed with no reason, a target removed that CI's `nx affected` runs. Why: affected skips tests that should run, and caches serve stale builds.
- **alias-bypass**: `tsconfig` path aliases map to a project's public entry only. Flag: a new path mapping to a file deep inside another project, a wildcard alias (`@org/*`) to `libs/*/src/*`, an alias that duplicates a project under a second name. Why: aliases sidestep the boundary rule and the graph alike.
- **project-tags**: A new project declares its type and scope tags, and sits where its kind belongs. Flag: a new `project.json` with no `tags`, an app created under `libs/` or a lib under `apps/`. Why: untagged projects match no constraint, so boundaries do not apply to them.
- **implicit-dependencies**: Dependencies come from real imports. Flag: `implicitDependencies` added to force build order or to hide a missing import, `"*"` implicit dependencies, a target `dependsOn` reaching into an unrelated project. Why: the graph stops matching the code, and affected runs too much or too little.
- **lib-config**: Shared libs read configuration passed in by the app, never environment variables or secrets of their own. Flag: `process.env` read inside a shared lib, a hard-coded URL, key or tenant id in a lib, a `.env` added to a lib. Why: every app inherits one app's settings, and secrets spread across deployables.
- **version-drift**: Each dependency has one version across the workspace. Flag: a project `package.json` pinning a different version of a library the root already provides, a second copy of a framework or React, a new dependency added to a project instead of the root where the workspace keeps them. Why: duplicate copies break singletons and bloat bundles.

## Fix

- Prefer: exporting what a consumer needs from the lib's `index.ts`, moving shared code into a lib with the right tags, passing configuration in from the app, and the repository's Nx generators for new projects.
- Never touch: `nx.json` cache and task-runner settings, `depConstraints`, CI's affected commands, and generated files.
- Escalate: `boundary-rules`, `graph-accuracy` and `shared-contract` breaks, splitting or merging projects, and any new cross-project dependency the tags do not already allow.
