---
sidebar_position: 7
title: Agentic Process
---

# Agentic Process

Visual guide to hatch3r's agentic workflow -- from initialization to board-driven development.

## Init Flow

How `npx hatch3r init` sets up a project:

```mermaid
flowchart LR
    classDef default fill:#1a3a4a,stroke:#3aafa9,color:#e0e0e0
    classDef accent fill:#0f3460,stroke:#4ecdc4,color:#fff
    classDef output fill:#16213e,stroke:#3aafa9,color:#e0e0e0

    A["npx hatch3r init"]:::accent --> B["Detect repo\n(git remote)"]
    B --> B2["Project context\n(greenfield/brownfield,\nsolo/team)"]
    B2 --> B3["Content profile\n(minimal/standard/full/custom)"]
    B3 --> C["Select tools\n(Claude Code, Cursor, Copilot)"]
    C --> D["Select MCP servers\n(GitHub, Brave, ...)"]
    D --> E["Resolve selection\n(bundled content\n+ .hatch3r/overrides)"]
    E --> F["Run adapters"]:::accent
    F --> G[".cursor/\n.github/\nCLAUDE.md"]:::output
    F --> H[".env.mcp\n(secrets template)"]:::output
```

## Canonical Content Model

One source of truth generates outputs for all tools:

```mermaid
flowchart TB
    classDef default fill:#1a3a4a,stroke:#3aafa9,color:#e0e0e0
    classDef accent fill:#0f3460,stroke:#4ecdc4,color:#fff
    classDef output fill:#16213e,stroke:#3aafa9,color:#e0e0e0

    subgraph canonical["Bundled npm package (canonical source) + .hatch3r/ (your repo)"]
        agents["agents/\nAgent definitions"]
        skills["skills/\nSkill bundles"]
        rules["rules/\nRule files"]
        commands["commands/\nCommand workflows"]
        hooks["hooks/\nEvent triggers"]
        checks["checks/\nReview criteria"]
        manifest[".hatch3r/hatch.json\nManifest + selection;\noverrides/ + mcp/mcp.json"]
    end

    subgraph adapters["Adapter Layer (3)"]
        cursor_a["Cursor adapter"]:::accent
        copilot_a["Copilot adapter"]:::accent
        claude_a["Claude adapter"]:::accent
    end

    subgraph outputs["Generated Outputs"]
        cursor_o[".cursor/\nrules, agents, skills,\ncommands, mcp.json"]:::output
        copilot_o[".github/\ninstructions, agents,\nprompts, mcp.json"]:::output
        claude_o["CLAUDE.md\n.mcp.json\n.claude/"]:::output
    end

    canonical --> adapters
    cursor_a --> cursor_o
    copilot_a --> copilot_o
    claude_a --> claude_o
```

## Board Workflow

The full board-driven development lifecycle:

```mermaid
flowchart TB
    classDef default fill:#1a3a4a,stroke:#3aafa9,color:#e0e0e0
    classDef accent fill:#0f3460,stroke:#4ecdc4,color:#fff
    classDef highlight fill:#3aafa9,stroke:#4ecdc4,color:#0f0f1a

    init["hatch3r-board-init\nBootstrap GitHub Projects V2 board\n- Create/connect project\n- Configure status fields\n- Create label taxonomy\n- Write IDs to hatch.json"]:::highlight

    spec["hatch3r-project-spec\nor hatch3r-codebase-map\nGenerate todo.md"]

    fill["hatch3r-board-fill\nPopulate the board\n- Parse todo.md\n- Classify items\n- Build dependency DAG\n- Create GitHub issues\n- Mark ready items"]:::accent

    groom["hatch3r-board-groom\nRefine the backlog\n- Surface stale items\n- Re-prioritize\n- Decompose oversized issues\n- Merge duplicates\n- Refresh dependencies"]

    pickup["hatch3r-board-pickup\nPick up next issue\n- Auto-select by priority\n- Collision detection\n- Create branch\n- Deep context analysis\n- Delegate to implementer\n- Create PR"]:::accent

    refresh["hatch3r-board-refresh\nUpdate dashboard\n- Compute health metrics\n- Update board overview\n- Recommend models"]

    init --> spec
    spec --> fill
    fill --> groom
    groom --> pickup
    pickup --> refresh
    refresh -.->|"ongoing"| groom
```

## Agent Orchestration

How agents collaborate during `hatch3r-board-pickup` and the review pipeline:

```mermaid
flowchart TB
    classDef default fill:#1a3a4a,stroke:#3aafa9,color:#e0e0e0
    classDef research fill:#0f3460,stroke:#4ecdc4,color:#fff
    classDef implement fill:#3aafa9,stroke:#4ecdc4,color:#0f0f1a
    classDef review fill:#237a75,stroke:#3aafa9,color:#fff
    classDef quality fill:#16213e,stroke:#4ecdc4,color:#e0e0e0
    classDef result fill:#4ecdc4,stroke:#3aafa9,color:#0f0f1a

    subgraph pickup["hatch3r-board-pickup"]
        select["Select next issue\n(dependency + priority)"]
        branch["Create branch\n& mark in-progress"]
        context["Deep context analysis\n(complexity, requirements,\nsimilar implementations)"]
    end

    subgraph impl["Implementation"]
        researcher["hatch3r-researcher\nParallel analysis:\n- Codebase impact\n- Similar patterns\n- Requirements elicitation"]:::research
        implementer["hatch3r-implementer\n- Convention lock\n- Code + tests\n- Single sub-issue scope"]:::implement
    end

    subgraph rev["Review Loop (max 3 iterations)"]
        reviewer["hatch3r-reviewer\nCheck:\n- Correctness\n- Security\n- Performance\n- Accessibility"]:::review
        decision{{"Critical or\nWarning\nfindings?"}}
        fixer["hatch3r-fixer\nTargeted fixes for\nreviewer findings"]:::review
    end

    subgraph qual["Final Quality (parallel)"]
        tests["hatch3r-testability\nUnit, integration,\nE2E tests"]:::quality
        security["hatch3r-security\nOWASP, privacy,\nentitlements"]:::quality
    end

    pr["Create Pull Request\n- Label transitions\n- Projects V2 sync\n- Board status update"]:::result

    select --> branch --> context
    context --> researcher
    researcher --> implementer
    implementer --> reviewer
    reviewer --> decision
    decision -->|"Yes"| fixer
    fixer --> reviewer
    decision -->|"No (clean)"| qual
    tests --> pr
    security --> pr
```

## Tooling Hierarchy

How agents prioritize information sources:

```mermaid
flowchart LR
    classDef step1 fill:#3aafa9,stroke:#4ecdc4,color:#0f0f1a
    classDef step2 fill:#0f3460,stroke:#4ecdc4,color:#fff
    classDef step3 fill:#16213e,stroke:#3aafa9,color:#e0e0e0
    classDef step4 fill:#1a3a4a,stroke:#3aafa9,color:#e0e0e0

    A["1. Project specs\ndocs/specs/"]:::step1 --> B["2. Codebase search\ngrep, file reading"]:::step2
    B --> C["3. Library docs\nContext7 MCP"]:::step3
    C --> D["4. Web research\nBrave Search MCP"]:::step4
```

For a text-based description of these patterns, see [Sub-Agentic Architecture](sub-agentic-architecture).
