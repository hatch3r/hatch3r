import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

const stats = [
  {number: '15', label: 'Agents'},
  {number: '25', label: 'Skills'},
  {number: '43', label: 'Rules'},
  {number: '29', label: 'Commands'},
  {number: '13', label: 'Platforms'},
];

const tools = [
  'Cursor', 'GitHub Copilot', 'Claude Code', 'OpenCode', 'Windsurf',
  'Amp', 'Codex CLI', 'Gemini CLI', 'Cline / Roo Code', 'Aider',
  'Kiro', 'Goose', 'Zed',
];

const features: {title: string; description: string}[] = [
  {
    title: 'One Command Setup',
    description:
      'Run npx hatch3r init and get agents, skills, rules, commands, and MCP integrations generated for your coding tool of choice.',
  },
  {
    title: 'Tool-Agnostic',
    description:
      'Single canonical source in /.agents/ with adapters that generate native config for 13 platforms. Switch tools without rewriting your setup.',
  },
  {
    title: 'Board Management',
    description:
      'Full GitHub Projects V2 integration. Parse todo.md into issues, auto-pick work, delegate to sub-agents, and create PRs.',
  },
  {
    title: 'Sub-Agentic Delegation',
    description:
      'Implementer agent receives issues, delivers code and tests. Dependency-aware orchestration with collision detection.',
  },
  {
    title: 'Safe Merge System',
    description:
      'Managed blocks with HATCH3R:BEGIN/END markers. Your customizations outside the blocks survive every sync and update.',
  },
  {
    title: 'Extensible by Design',
    description:
      'Per-agent model selection, .customize.yaml overrides, composable recipes, and event-driven hooks for lifecycle automation.',
  },
];

function HomepageHeader(): ReactNode {
  return (
    <header className="hero hero--hatch3r">
      <div className="container">
        <Heading as="h1" className="hero__title">
          hatch3r
        </Heading>
        <p className="hero__subtitle">
          Battle-tested agentic coding setup framework. One command to hatch your
          agent stack for every major AI coding tool.
        </p>
        <code>npx hatch3r init</code>
        <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap'}}>
          <Link className="button button--primary button--lg" to="/docs/getting-started/introduction">
            Get Started
          </Link>
          <Link
            className="button button--secondary button--lg"
            href="https://github.com/hatch3r/hatch3r"
          >
            GitHub
          </Link>
        </div>
        <div className="stats-grid">
          {stats.map(({number, label}) => (
            <div className="stat-card" key={label}>
              <div className="stat-number">{number}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

function ToolsSection(): ReactNode {
  return (
    <section className="tools-section">
      <div className="container" style={{textAlign: 'center'}}>
        <Heading as="h2">Works With Your Tools</Heading>
        <p style={{opacity: 0.7, maxWidth: 500, margin: '0 auto'}}>
          Generate native configuration for every major AI coding tool from a
          single canonical source.
        </p>
        <div className="tools-grid">
          {tools.map((tool) => (
            <span className="tool-badge" key={tool}>
              {tool}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection(): ReactNode {
  return (
    <section className="features-section">
      <div className="container">
        <div style={{textAlign: 'center', marginBottom: '2rem'}}>
          <Heading as="h2">Why hatch3r?</Heading>
        </div>
        <div className="feature-grid">
          {features.map(({title, description}) => (
            <div className="feature-card" key={title}>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Hatch better agents"
      description="Battle-tested agentic coding setup framework. One command to hatch your agent stack -- agents, skills, rules, commands, and MCP for every major AI coding tool."
    >
      <HomepageHeader />
      <main>
        <ToolsSection />
        <FeaturesSection />
      </main>
    </Layout>
  );
}
