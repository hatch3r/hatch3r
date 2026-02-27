---
id: hatch3r-onboard
type: command
description: Generate an onboarding guide for a new developer joining the project. Covers setup, architecture, conventions, and key workflows.
---
# Onboarding Guide Generator

## Inputs

- **Role:** `frontend`, `backend`, `fullstack`, or `general` (default)
- **Output:** `markdown` (default) or `issue` (create GitHub issue with guide)

## Procedure

1. **Project overview:**
   - Read `package.json` (or equivalent) for project name, description, tech stack
   - Read `README.md` for existing setup instructions
   - Read `.agents/AGENTS.md` for agent architecture overview
   - Summarize: what the project does, who uses it, primary tech stack

2. **Development setup:**
   - Detect package manager and runtime (Node, Python, Go, etc.)
   - List prerequisites: runtime version, system dependencies, required tools
   - Generate exact setup commands: clone, install, configure environment, run
   - Include `.env.example` setup instructions if present
   - Verify the setup works by listing the build/test commands

3. **Architecture walkthrough:**
   - Map the directory structure with purpose of each top-level directory
   - Identify the main entry points (API server, CLI, web app)
   - Document the data flow for a typical request/operation
   - List key dependencies and their roles

4. **Conventions and standards:**
   - Read `.agents/rules/` for coding standards
   - Summarize branch naming, commit message, and PR conventions
   - Document the testing strategy (unit, integration, e2e) and how to run tests
   - List available scripts/commands from the project's task runner

5. **Key workflows:**
   - How to create a feature branch and open a PR
   - How to run the CI pipeline locally
   - How to deploy (if applicable)
   - Who to ask for help and where to find documentation

6. **Generate the guide** as a single markdown document organized by section.

## Output

- Onboarding guide markdown document
- Quick-reference cheat sheet (common commands, file locations, contacts)

## Related

- **Agent:** `hatch3r-docs-writer` — for maintaining documentation
- **Skill:** `hatch3r-feature` — standard feature development workflow
