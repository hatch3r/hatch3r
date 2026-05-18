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
        'getting-started/cli-tools',
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
        'guides/agentic-process',
        'guides/agent-teams',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        {
          type: 'category',
          label: 'Architecture',
          items: [
            'reference/architecture/content-model',
            'reference/architecture/adapter-system',
            'reference/architecture/documentation-structure',
          ],
        },
        'reference/configuration',
        'reference/agents',
        'reference/skills',
        'reference/rules',
        'reference/hooks',
        {
          type: 'category',
          label: 'Commands',
          items: [
            'reference/commands/cli-commands',
            'reference/commands/agent-commands',
          ],
        },
        'reference/auxiliary-artifacts',
        'reference/adapter-capability-matrix',
      ],
    },
    'troubleshooting',
  ],
};

export default sidebars;
