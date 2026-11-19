---
title: "Maintain the documentation"
description: "Run the documentation site locally, change its theme, add a guide, and understand how pull requests build and deploy it to GitHub Pages."
---

This site is built with Astro Starlight from the Markdown files under `docs/src/content/docs/`. Those files are the source: edit pages there, and keep the root README as a short introduction that links to the guides. This page is for contributors changing the documentation.

## Run the site

Use the Node version in the repository's `.node-version` file (24) for site development and CI. The documentation dependencies are separate from the CLI dependencies.

**1. Install dependencies**

From the Shepherd repository root, install both sets:

```bash
bun install --frozen-lockfile
bun install --cwd docs --frozen-lockfile
```

**2. Start the dev server**

```bash
bun run docs:dev
```

Open the URL Astro prints.

**3. Preview the production build**

```bash
bun run docs:build
bun run docs:preview
```

Search works in the production preview.

### Check the site

The two scripts check different things:

- **`docs:check`**: checks page links, navigation coverage, and configuration examples.
- **`docs:build`**: runs those checks, builds the static site and search index, then checks local HTML links and anchors in the output.

## Theme

The site uses the [starlight-shadcn](https://github.com/jagreehal/starlight-shadcn) theme. Its colours are the shadcn tokens in `docs/src/styles/global.css`: paste a palette from any shadcn theme generator there. You set the top navigation links in the theme's `navLinks` option in `docs/astro.config.mjs`.

## Diagrams

Write a diagram as a ` ```mermaid ` fence. `docs/src/remark-mermaid.mjs` turns each fence into a `<pre class="mermaid">` block, and [mermaid-flow-player](https://github.com/jagreehal/mermaid-flow-player) turns that block into a player with play, step and zoom controls. `docs/src/scripts/flow-player.ts` loads both on each page, with Mermaid from the bundle.

Keep each diagram readable as a player:

- **Node ids**: use short, stable ids such as `A` or `SW`. The player steps through nodes by id.
- **Labels**: write plain text, with no `<br/>`. Mermaid wraps long labels on its own.
- **Direction**: use `flowchart TD`. A top-down diagram stays readable at the content width; a wide left-to-right one shrinks.

## Add a guide

To add a page, follow these steps.

**1. Create the page**

Give the page a `title` in YAML frontmatter, then add it to the sidebar in `docs/astro.config.mjs`. `docs:check` fails on a page missing from the navigation.

**2. Write it for the reader**

Show prerequisites, a command, the expected result and the next action. Label each command for the terminal or the coding agent. Use placeholders for credentials and organisation names.

**3. Link correctly**

Follow these rules for links:

- **Site links**: use `/shepherd/path/to/page/`. The remark plugin rewrites that prefix when `BASE` changes.
- **Source files**: link to their GitHub URL instead of an unpublished file path.

**4. Mark configuration examples**

For a complete configuration example, use a `yaml validate-config` fence. The checker validates it with the product schema, and Shepherd also checks recipe ordering. For a fragment that belongs inside another file, use a regular `yaml` fence.

## Build and deployment

The Docs workflow validates pull requests and builds a Pages artifact. Pushes to `main` and manual workflow runs deploy to GitHub Pages. In repository settings, choose **GitHub Actions** as the Pages source.

`actions/configure-pages` supplies `SITE` and `BASE` on deployment. The default base is `/shepherd`. To check a root deployment, run:

```bash
BASE=/ bun run docs:build
```

Keep docs dependencies in `docs/package.json` and commit `docs/bun.lock`. The CLI package doesn't need the site dependencies at runtime.

## Related resources

- [Develop Shepherd](/shepherd/contributing/development/): run the CLI's checks and tests
- [Starlight documentation](https://starlight.astro.build/): the framework this site is built on
- [starlight-shadcn](https://github.com/jagreehal/starlight-shadcn): the theme and its tokens
