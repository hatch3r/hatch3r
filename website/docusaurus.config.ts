import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'hatch3r',
  tagline: 'Crack the egg. Hatch better agents.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.hatch3r.com',
  baseUrl: '/',

  organizationName: 'hatch3r',
  projectName: 'hatch3r',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/hatch3r/hatch3r/tree/main/website/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/hatch3r-social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'hatch3r',
      logo: {
        alt: 'hatch3r',
        src: 'img/egg-logo.png',
        style: {imageRendering: 'pixelated'},
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://www.npmjs.com/package/hatch3r',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/hatch3r/hatch3r',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started/introduction'},
            {label: 'Guides', to: '/docs/guides/workflow'},
            {label: 'Architecture', to: '/docs/reference/architecture/content-model'},
            {label: 'Configuration', to: '/docs/reference/configuration'},
            {label: 'Reference', to: '/docs/reference/agents'},
          ],
        },
        {
          title: 'Resources',
          items: [
            {label: 'GitHub', href: 'https://github.com/hatch3r/hatch3r'},
            {label: 'npm', href: 'https://www.npmjs.com/package/hatch3r'},
            {label: 'Issues', href: 'https://github.com/hatch3r/hatch3r/issues'},
          ],
        },
      ],
      copyright: `Copyright \u00a9 ${new Date().getFullYear()} hatch3r contributors. MIT License.`,
    },
    mermaid: {
      theme: {light: 'base', dark: 'dark'},
      options: {
        themeVariables: {
          primaryColor: '#1a3a4a',
          primaryTextColor: '#e0e0e0',
          primaryBorderColor: '#3aafa9',
          lineColor: '#4ecdc4',
          secondaryColor: '#16213e',
          tertiaryColor: '#0f3460',
          edgeLabelBackground: 'transparent',
        },
      },
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'toml', 'markdown'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
