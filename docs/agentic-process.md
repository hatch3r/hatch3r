# Agentic Process

Visual guide to hatch3r's agentic workflow -- from initialization to board-driven development.

## Init Flow

How `npx hatch3r init` sets up a project:

```mermaid
flowchart LR
    A["npx hatch3r init"] --> B["Detect repo\n(git remote)"]
    B --> C["Select tools\n(Claude, Cursor, Copilot)"]
    C --> D["Select MCP servers\n(GitHub, Brave, ...)"]
    D --> E["Write manifest\nto .hatch3r/hatch.json"]
    E --> F["Run adapters\n(read bundled content)"]
    F --> G[".cursor/\n.github/\nCLAUDE.md\n.claude/"]
    F --> H[".env.mcp\n(secrets template)"]
```

## Canonical Content Model

One source of truth generates outputs for all tools:

```mermaid
flowchart TB
    subgraph canonical["bundled npm package (canonical source)"]
        agents["agents/\n30 agent definitions"]
        skills["skills/\n43 skill bundles"]
        rules["rules/\n55 rule files"]
        commands["commands/\n23 command workflows"]
        mcp["mcp/\nMCP server config"]
        hooks["hooks/\nEvent triggers"]
        manifest[".hatch3r/hatch.json\nProject manifest"]
    end

    subgraph adapters["Adapter Layer"]
        cursor_a["Cursor adapter"]
        copilot_a["Copilot adapter"]
        claude_a["Claude adapter"]
        opencode_a["OpenCode adapter"]
        windsurf_a["Windsurf adapter"]
        others_a["+ 8 more adapters"]
    end

    subgraph outputs["Generated Outputs"]
        cursor_o[".cursor/\nrules, agents, skills,\ncommands, mcp.json"]
        copilot_o[".github/\ninstructions, agents,\nprompts, mcp.json"]
        claude_o["CLAUDE.md\n.mcp.json\n.claude/"]
        opencode_o["opencode.json\n.opencode/"]
        windsurf_o[".windsurfrules\n.windsurf/"]
        others_o["AGENTS.md, GEMINI.md,\n.clinerules, ..."]
    end

    canonical --> adapters
    cursor_a --> cursor_o
    copilot_a --> copilot_o
    claude_a --> claude_o
    opencode_a --> opencode_o
    windsurf_a --> windsurf_o
    others_a --> others_o
```

## Board Workflow

The full board-driven development lifecycle:

```mermaid
flowchart TB
    init["hatch3r-board-init\nBootstrap GitHub Projects V2 board\n• Create/connect project\n• Configure status fields\n• Create label taxonomy\n• Write IDs to hatch.json"]

    spec["hatch3r-project-spec\nor hatch3r-codebase-map\nGenerate todo.md"]

    fill["hatch3r-board-fill\nPopulate the board\n• Parse todo.md\n• Classify items\n• Build dependency DAG\n• Create GitHub issues\n• Mark ready items"]

    groom["hatch3r-board-groom\nRefine the backlog\n• Surface stale items\n• Re-prioritize\n• Decompose oversized issues\n• Merge duplicates\n• Refresh dependencies"]

    pickup["hatch3r-board-pickup\nPick up next issue\n• Auto-select by priority\n• Collision detection\n• Create branch\n• Deep context analysis\n• Delegate to implementer\n• Create PR"]

    refresh["hatch3r-board-refresh\nUpdate dashboard\n• Compute health metrics\n• Update board overview\n• Recommend models"]

    init --> spec
    spec --> fill
    fill --> groom
    groom --> pickup
    pickup --> refresh
    refresh -.->|"ongoing"| groom

    style init fill:#e85d04,color:#fff
    style fill fill:#d45e1e,color:#fff
    style pickup fill:#c44d0a,color:#fff
```

## Agent Orchestration

How agents collaborate during `hatch3r-board-pickup` and the review pipeline:

```mermaid
flowchart TB
    subgraph pickup["hatch3r-board-pickup"]
        select["Select next issue\n(dependency + priority)"]
        branch["Create branch\n& mark in-progress"]
        context["Deep context analysis\n(complexity, requirements,\nsimilar implementations)"]
    end

    subgraph implement["Implementation"]
        researcher["hatch3r-researcher\nParallel analysis:\n• Codebase impact\n• Similar patterns\n• Requirements elicitation"]
        implementer["hatch3r-implementer\n• Convention lock\n• Code + tests\n• Single sub-issue scope"]
    end

    subgraph review["Review Loop (max 3 iterations)"]
        reviewer["hatch3r-reviewer\nCheck:\n• Correctness\n• Security\n• Performance\n• Accessibility"]
        decision{{"Critical or\nWarning\nfindings?"}}
        fixer["hatch3r-fixer\nTargeted fixes for\nreviewer findings"]
    end

    subgraph quality["Final Quality (parallel)"]
        tests["hatch3r-testability\nUnit, integration,\nE2E tests"]
        security["hatch3r-security\nOWASP, privacy,\nentitlements"]
    end

    pr["Create Pull Request\n• Label transitions\n• Projects V2 sync\n• Board status update"]

    select --> branch --> context
    context --> researcher
    researcher --> implementer
    implementer --> reviewer
    reviewer --> decision
    decision -->|"Yes"| fixer
    fixer --> reviewer
    decision -->|"No (clean)"| quality
    tests --> pr
    security --> pr

    style researcher fill:#f48c06,color:#000
    style implementer fill:#e85d04,color:#fff
    style reviewer fill:#dc2f02,color:#fff
    style fixer fill:#9d0208,color:#fff
    style tests fill:#006d77,color:#fff
    style security fill:#006d77,color:#fff
```

## Tooling Hierarchy

How agents prioritize information sources:

```mermaid
flowchart LR
    A["1. Project specs\ndocs/specs/"] --> B["2. Codebase search\ngrep, file reading"]
    B --> C["3. Library docs\nContext7 MCP"]
    C --> D["4. Web research\nBrave Search MCP"]

    style A fill:#e85d04,color:#fff
    style B fill:#f48c06,color:#000
    style C fill:#f9a825,color:#000
    style D fill:#ffd54f,color:#000
```
