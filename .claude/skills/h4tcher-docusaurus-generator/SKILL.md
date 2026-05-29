---
name: h4tcher-docusaurus-generator
description: Maintainer skill — generate or refresh the hatch3r project documentation site (Docusaurus 3.x) from this repo's canonical corpus (governance/, agents/, skills/, rules/, commands/, hooks/, docs/). Use when a hatch3r maintainer asks to build, regenerate, or update the framework's own docs site. Analyzes the hatch3r repo structure, generates markdown, configures Docusaurus, and previews the site.
effort: medium
allowed-tools: Read Grep Glob Bash(*) Write Edit
---

> Last updated: 2026-05-29

# Docusaurus Generator (hatch3r maintainer skill)

This skill generates or refreshes the **hatch3r project's own** documentation site using Docusaurus 3.x by analyzing this repository's canonical corpus. It is a framework-dev maintainer tool (hence the `h4tcher-` prefix per CLAUDE.md), not a generic per-project docs generator: it sources content from `governance/`, `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, and `docs/`.

## Workflow Overview

1. **Analyze** the hatch3r repo corpus to understand what to document
2. **Initialize** a new Docusaurus 3.x project (or use the existing `website/` site)
3. **Generate** documentation content from the corpus analysis
4. **Configure** Docusaurus settings and theme
5. **Build & Preview** the documentation site

## Step 1: Analyze the hatch3r corpus

Before generating docs, scan this repo to identify what to document:

- **CLI surface**: the commands under `src/cli/commands/` (mirror the `npx hatch3r <cmd>` help)
- **Canonical content**: `agents/`, `skills/`, `rules/`, `commands/`, `hooks/` — the artifacts hatch3r ships
- **Governance**: `governance/VISION.md`, `CONSTITUTION.md`, and the audit-domain set under `governance/audit/domains/`
- **Existing docs**: the `docs/` directory and `README.md` (do not duplicate; link or lift)

```bash
# Key sources to examine in the hatch3r repo
ls src/cli/commands/*.ts
ls agents/ skills/ rules/ commands/ hooks/
ls governance/ docs/
cat package.json | jq '.name, .description'
```

## Step 2: Initialize Docusaurus

Create a new Docusaurus 3.x project in `docs-site/` directory:

```bash
npx -y create-docusaurus@latest docs-site classic --typescript
```

Or if docs already exist, skip to configuration.

## Step 3: Generate Documentation Content

### Documentation Structure

Organize docs following this structure:

```
docs-site/docs/
├── intro.md                    # Getting started
├── installation.md             # Installation guide
├── features/
│   ├── feature-1.md
│   └── feature-2.md
├── guides/
│   ├── quick-start.md
│   └── advanced-usage.md
├── configuration/
│   └── settings.md
└── faq.md
```

### Frontmatter Template

Every doc should have proper frontmatter:

```markdown
---
sidebar_position: 1
title: Page Title
description: Brief description for SEO
---

# Page Title

Content here...
```

### Content Guidelines

- **Write for end users**, not developers
- Use simple, clear language
- Include screenshots for UI features
- Add code examples where relevant
- Link between related docs

## Step 4: Configure Docusaurus

### docusaurus.config.ts

Key configuration options:

```typescript
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';

const config: Config = {
  title: 'Project Name',
  tagline: 'Your tagline here',
  favicon: 'img/favicon.ico',
  url: 'https://your-docs-url.com',
  baseUrl: '/',
  
  // Localization
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'vi'],
  },
  
  themeConfig: {
    navbar: {
      title: 'Project Name',
      logo: {
        alt: 'Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()}`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

export default config;
```

### Theme Customization

Edit `src/css/custom.css` for branding:

```css
:root {
  --ifm-color-primary: #2e8555;
  --ifm-color-primary-dark: #29784c;
  --ifm-color-primary-darker: #277148;
  --ifm-color-primary-darkest: #205d3b;
  --ifm-color-primary-light: #33925d;
  --ifm-color-primary-lighter: #359962;
  --ifm-color-primary-lightest: #3cad6e;
  --ifm-code-font-size: 95%;
}

[data-theme='dark'] {
  --ifm-color-primary: #25c2a0;
}
```

## Step 5: Build & Preview

```bash
cd docs-site

# Install dependencies
npm install

# Start dev server
npm run start

# Build for production
npm run build

# Serve production build locally
npm run serve
```

## Common Plugins

### Search (Algolia or local)

For local search without Algolia:

```bash
npm install @easyops-cn/docusaurus-search-local
```

```typescript
// docusaurus.config.ts
themes: [
  [
    '@easyops-cn/docusaurus-search-local',
    {
      hashed: true,
      language: ['en', 'vi'],
    },
  ],
],
```

### Blog

Already included in classic template. Configure in `docusaurus.config.ts`:

```typescript
blog: {
  showReadingTime: true,
  blogSidebarCount: 'ALL',
},
```

### Versioning

```bash
npm run docusaurus docs:version 1.0.0
```

## Multi-language Support

### Enable i18n

1. Configure locales in `docusaurus.config.ts`
2. Create translated docs in `i18n/vi/docusaurus-plugin-content-docs/current/`
3. Add locale switcher to navbar

```typescript
navbar: {
  items: [
    {
      type: 'localeDropdown',
      position: 'right',
    },
  ],
},
```

### Translation workflow

```bash
# Generate translation files
npm run write-translations -- --locale vi

# Start dev server with locale
npm run start -- --locale vi
```

## Best Practices

1. **Keep intro short** - Users want to get started quickly
2. **Use admonitions** for tips, warnings:
   ```markdown
   :::tip
   Pro tip here
   :::
   
   :::warning
   Be careful about this
   :::
   ```
3. **Add images** to `static/img/` and reference as `/img/filename.png`
4. **Use tabs** for platform-specific content:
   ```jsx
   import Tabs from '@theme/Tabs';
   import TabItem from '@theme/TabItem';
   
   <Tabs>
     <TabItem value="npm" label="npm">npm install</TabItem>
     <TabItem value="yarn" label="Yarn">yarn add</TabItem>
   </Tabs>
   ```
5. **Auto-generate sidebar** from folder structure using `sidebars.ts`
