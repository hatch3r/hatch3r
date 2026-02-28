import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/introduction',
        'getting-started/quick-start',
        'getting-started/what-you-get',
        'getting-started/supported-tools',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/workflow',
        'guides/board-management',
        'guides/mcp-setup',
        'guides/model-selection',
        'guides/customization',
        'guides/sub-agentic-architecture',
        'guides/agent-teams',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/agents',
        'reference/skills',
        'reference/rules',
        {
          type: 'category',
          label: 'Commands',
          items: [
            'reference/commands/cli-commands',
            'reference/commands/agent-commands',
          ],
        },
        'reference/adapter-capability-matrix',
      ],
    },
    'troubleshooting',
  ],
};

export default sidebars;
