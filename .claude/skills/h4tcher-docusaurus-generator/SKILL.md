---
name: h4tcher-docusaurus-generator
description: Maintainer skill — generate or refresh the hatch3r project documentation site (Docusaurus 3.x) from this repo's canonical corpus (agents/, skills/, rules/, commands/, hooks/, docs/, plus counts from the public governance/inventory.json). Use when a hatch3r maintainer asks to build, regenerate, or update the framework's own docs site. Analyzes the hatch3r repo structure, regenerates markdown into website/docs/, and previews the site.
effort: medium
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

> Last updated: 2026-07-06

# Docusaurus Generator (hatch3r maintainer skill)

This skill refreshes the **hatch3r project's own** documentation site, which already exists at `website/` (Docusaurus 3.x), by re-deriving its pages from this repository's canonical corpus. It is a framework-dev maintainer tool (hence the `h4tcher-` prefix per CLAUDE.md), not a generic per-project docs generator and not a lifecycle add/refactor/remove preset. It sources content from `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, and `docs/`; the only governance source is the public `governance/inventory.json` (counts).

The site lives in `website/` and deploys to `docs.hatch3r.com` via `.github/workflows/deploy-docs.yml` on push to `main` (paths filter: `website/**`). There is no `docs-site/` directory — operate on `website/` directly. Do NOT run `npx create-docusaurus`: the project is already scaffolded; creating a second project is a P4 (Lean Coverage) violation.

## Workflow Overview

1. **Analyze** the hatch3r repo corpus to identify what each page must reflect
2. **Map** corpus sources to the existing `website/docs/**` page set and `website/sidebars.ts`
3. **Regenerate** the affected pages in place under `website/docs/`
4. **Build & Preview** via the website's own npm scripts

## Step 1: Analyze the hatch3r corpus

Scan this repo to identify what each page must reflect:

- **CLI surface**: the commands under `src/cli/commands/` (mirror the `npx hatch3r <cmd>` help) → `website/docs/reference/commands/cli-commands.md`
- **Canonical content**: `agents/`, `skills/`, `rules/`, `commands/`, `hooks/` — the artifacts hatch3r ships → the matching `website/docs/reference/{agents,skills,rules,hooks}.md` pages and `reference/commands/agent-commands.md`
- **Governance**: summarize public-facing governance behavior only, in your own prose, on architecture and guide pages. The sole citable governance source is the public `governance/inventory.json` (counts). NEVER emit private governance file paths, § numbers, or Decision numbers into public pages — the private governance corpus may exist locally via the overlay, but it is not a citable source for the public site
- **Existing docs**: the `docs/` directory and `README.md` (do not duplicate; link or lift)
- **Source-of-truth counts**: `governance/inventory.json` `counts` — page tallies (agents, skills, rules, commands, hooks) must match it

```bash
# Key sources to examine in the hatch3r repo
ls src/cli/commands/*.ts
ls agents/ skills/ rules/ commands/ hooks/
ls docs/
jq '.name, .description' package.json
jq '.counts' governance/inventory.json
```

## Step 2: Map corpus to the existing site

The site's page set and navigation are already defined. Read both before editing so regeneration lands in the right files instead of creating new ones:

```bash
# Existing page tree and navigation — read before regenerating
find website/docs -name '*.md' | sort
cat website/sidebars.ts          # docsSidebar: category -> doc-id ordering
cat website/docusaurus.config.ts # routeBasePath 'docs', navbar/footer links, mermaid theme
```

Current top-level groups in `website/sidebars.ts` (`docsSidebar`): `about`, **Getting Started**, **Guides**, **Reference** (with **Architecture** and **Commands** sub-categories), `troubleshooting`. Every doc id listed in `sidebars.ts` MUST resolve to a file under `website/docs/` — `onBrokenLinks: 'throw'` and the sidebar-id check fail the build otherwise.

Mapping rule: a corpus change updates the **existing** page that already documents that surface. Add a new page only when a new artifact class or CLI command has no home; when you add one, add its doc id to the matching category in `website/sidebars.ts` in the same change.

## Step 3: Regenerate pages in place

Rewrite the affected files under `website/docs/**`. Keep each page's existing frontmatter shape:

```markdown
---
sidebar_position: 1
title: Page Title
description: Brief description for SEO
---

# Page Title

Content here...
```

Content guidelines:

- Write for hatch3r **users** (people running `npx hatch3r`), not framework contributors.
- Keep counts and artifact lists synchronized with `governance/inventory.json` `counts`.
- Link between related docs with relative doc paths (e.g. `[workflow](../guides/workflow)`), not absolute URLs, so the broken-link check covers them.
- Do not duplicate `README.md` or `docs/` prose — link to it or lift the canonical wording once.

## Step 4: Author conventions used by this site

The site enables Mermaid (`themes: ['@docusaurus/theme-mermaid']`, `markdown.mermaid: true`) and the classic theme's admonitions and tabs. Use them as they already appear in `website/docs/`:

- **Mermaid diagrams** (architecture/flow pages):
  ````markdown
  ```mermaid
  graph LR; A --> B
  ```
  ````
- **Admonitions** for tips and warnings:
  ```markdown
  :::tip
  Run `npx hatch3r status` to see drift before syncing.
  :::

  :::warning
  `hatch3r clean` removes generated adapter outputs.
  :::
  ```
- **Tabs** for platform-specific content (the three adapters — Claude Code / Cursor / Copilot):
  ```jsx
  import Tabs from '@theme/Tabs';
  import TabItem from '@theme/TabItem';

  <Tabs>
    <TabItem value="claude" label="Claude Code">...</TabItem>
    <TabItem value="cursor" label="Cursor">...</TabItem>
    <TabItem value="copilot" label="Copilot">...</TabItem>
  </Tabs>
  ```
- **Static assets** go in `website/static/img/` and are referenced as `/img/filename.png`.

Sidebar ordering is driven by `website/sidebars.ts` (explicit doc-id lists per category), not by `sidebar_position` alone — update the array when adding or reordering pages.

## Step 5: Build & Preview

Use the website's own npm scripts from within `website/`. The build must pass before the change is done — `onBrokenLinks: 'throw'` turns any dangling link into a build failure, which is the same gate `.github/workflows/deploy-docs.yml` and `h4tcher-release-prep` Step 8 enforce.

```bash
cd website

# Install dependencies (lockfile-exact, matching the deploy workflow)
npm ci

# Local dev server with live reload
npm run start

# Production build — fails on broken links; mirrors CI
NODE_OPTIONS=--max-old-space-size=4096 npm run build

# Serve the production build locally to spot-check
npm run serve
```

If `website/` has unstaged edits after regeneration, the maintainer commits them with `docs(website): <summary>` (release syncs use `docs(website): sync to v{version}` per `h4tcher-release-prep` Step 8). This skill stops before commit.
