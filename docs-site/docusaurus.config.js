// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "hatch3r",
  tagline: "Crack the egg. Hatch better agents.",
  favicon: undefined,

  url: "https://hatch3r.dev",
  baseUrl: "/",

  organizationName: "hatch3r",
  projectName: "hatch3r",

  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: "./sidebars.js",
          editUrl: "https://github.com/hatch3r/hatch3r/tree/main/docs-site/",
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      }),
    ],
  ],

  markdown: {
    mermaid: true,
  },
  themes: ["@docusaurus/theme-mermaid"],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: "hatch3r",
        items: [
          {
            type: "docSidebar",
            sidebarId: "docsSidebar",
            position: "left",
            label: "Docs",
          },
          {
            href: "https://github.com/hatch3r/hatch3r",
            label: "GitHub",
            position: "right",
          },
          {
            href: "https://www.npmjs.com/package/hatch3r",
            label: "npm",
            position: "right",
          },
        ],
      },
      footer: {
        style: "dark",
        links: [
          {
            title: "Docs",
            items: [
              { label: "Getting Started", to: "/docs/getting-started" },
              { label: "Command Reference", to: "/docs/command-reference" },
              { label: "Architecture", to: "/docs/architecture" },
              { label: "Configuration", to: "/docs/configuration" },
            ],
          },
          {
            title: "Guides",
            items: [
              { label: "MCP Setup", to: "/docs/guides/mcp-setup" },
              { label: "Model Selection", to: "/docs/guides/model-selection" },
              { label: "Troubleshooting", to: "/docs/guides/troubleshooting" },
            ],
          },
          {
            title: "More",
            items: [
              { label: "GitHub", href: "https://github.com/hatch3r/hatch3r" },
              { label: "npm", href: "https://www.npmjs.com/package/hatch3r" },
            ],
          },
        ],
        copyright: `Copyright \u00A9 ${new Date().getFullYear()} hatch3r. MIT License.`,
      },
      prism: {
        theme: require("prism-react-renderer").themes.github,
        darkTheme: require("prism-react-renderer").themes.dracula,
        additionalLanguages: ["bash", "json", "toml", "yaml"],
      },
    }),
};

module.exports = config;
