---
id: shared-external-knowledge
type: reference
description: Shared external knowledge reference for all agents — tooling hierarchy, platform CLI, Context7 MCP, and web research guidance.
---
## External Knowledge

See [Tooling Hierarchy](../../rules/hatch3r-tooling-hierarchy.md) for the canonical reference (Platform MCP-first, documentation MCP, web research, browser verification, knowledge augmentation priority). Summary:

- Follow the tooling hierarchy (specs > codebase > Context7 MCP > web research).
- Use the project's configured platform CLI (check `platform` in `.agents/hatch.json`): GitHub (`gh`), Azure DevOps (`az devops` / `az boards` / `az repos`), GitLab (`glab`).
- Fall back to platform MCP only for operations not covered by the CLI (e.g., sub-issue management, project field mutations).

## Context7 MCP Protocol

Use `resolve-library-id` to find the library, then `query-docs` to retrieve current documentation. Apply this for any framework, library, or tool whose API surface may have changed since training data.

- Prefer Context7 over guessing API signatures, configuration options, or behavioral details from potentially outdated training data.
- Always verify: method names, parameter signatures, return types, and configuration keys before using them in code.
- If Context7 returns no results, fall back to web research (below).

## Web Research Protocol

Use web search when Context7 does not cover the topic, or for information that changes frequently:

- **Security:** Current CVE details (NVD), security advisories, supply chain attack patterns.
- **Standards:** Current best practice guidance, specification updates, compliance requirements.
- **Ecosystem:** Package maintenance status, alternative evaluations, community adoption signals.
- **Platform-specific advisories** by platform:
  - **GitHub:** GitHub Security Advisories, Dependabot alerts
  - **Azure DevOps:** Microsoft Defender for DevOps, WhiteSource/Mend
  - **GitLab:** GitLab Dependency Scanning, Advisory Database

## When NOT to Use External Knowledge

Skip external knowledge lookups when:

- The answer is available in project documentation or codebase (tiers 1-2 of the hierarchy). Re-reading a local spec is faster and more accurate than a web search.
- The question is about project-specific conventions (naming, file structure, state management). These are defined in local rules and learnings, not external sources.
- The information is not time-sensitive and the agent's training data is sufficient (basic language features, well-established patterns like REST, SQL, HTTP status codes).

Unnecessary external lookups waste tokens and introduce latency. Follow the hierarchy strictly: only escalate to the next tier when the current tier cannot answer the question.
