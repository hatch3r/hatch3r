// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    "getting-started",
    "command-reference",
    "architecture",
    "configuration",
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/mcp-setup",
        "guides/model-selection",
        "guides/adapter-capability-matrix",
        "guides/agent-teams",
        "guides/agentic-process",
        "guides/troubleshooting",
      ],
    },
  ],
};

module.exports = sidebars;
