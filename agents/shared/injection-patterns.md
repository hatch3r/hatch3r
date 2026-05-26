---
id: shared-injection-patterns
type: reference
description: Canonical prompt-injection screening patterns — single source of truth for pipeline input sanitization, learnings validation, and user-facing injection screening guidance.
efficiency_patterns: agents/shared/efficiency-patterns.md
cache_friendly: true
---

## Injection Patterns Catalog

This file is the canonical human-readable catalog of prompt-injection patterns used across hatch3r. Three consumers must stay aligned with this catalog:

1. `src/pipeline/promptGuard.ts` — pipeline phase input/output sanitization (`INJECTION_PATTERNS` constant). OWASP ASI01.
2. `src/content/learningsValidation.ts` — stored-learnings content validation (`LEARNINGS_INJECTION_PATTERNS` constant). OWASP ASI06.
3. `commands/hatch3r-learn.md` — user-facing injection screening prose at Step 3 "Injection pattern screening". OWASP ASI06.

The code constants remain the executable source of truth (typed `RegExp` with TypeScript validation). This file is the governance contract — when threat patterns evolve, update this catalog first, then update the code and prose in lockstep. A test in `src/__tests__/pipeline/injectionPatternsSync.test.ts` asserts that every ID in Section A and Section B below appears as a `// pattern-id: <id>` comment in the corresponding code constant, preventing silent drift.

### Section A — Pipeline Injection Patterns (promptGuard.ts)

Scope: content flowing between pipeline phases (researcher → implementer → reviewer → fixer). More aggressive than learnings validation because these patterns target inter-agent hijack (ASI01, ASI07).

| Pattern ID | Description | Regex (code canonical form) | ASI control |
|-----------|-------------|-----------------------------|-------------|
| P-PIPE-01 | Role injection (system/assistant/user colon at line start) | `(?:^|\n)\s*(?:system|assistant|user)\s*:\s*$` (im) | ASI01 |
| P-PIPE-02 | Chat template injection tokens | `\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>` (i) | ASI01 |
| P-PIPE-03 | Template literal injection (ERB/Handlebars) | `<%[-=]?\s|%>|\{\{.*\}\}` | ASI01 |
| P-PIPE-04 | HTML comment role escalation | `<!--\s*(?:SYSTEM|ADMIN|ROOT)\s*-->` (i) | ASI01 |
| P-PIPE-05 | Null byte or ANSI escape sequence injection | `\x00|\x1b\[` | ASI01 |
| P-PIPE-06 | Tool/function call injection attempt (MCP) | `(?:tool_call|function_call)\s*\(` (i) | ASI07 |
| P-PIPE-07 | Tool delimiter injection token (MCP) | `<\|(?:tool|function|plugin)\|>` (i) | ASI07 |
| P-PIPE-08 | Unicode tag character smuggling (U+E0000–U+E007F invisible payload) | `[\uDB40][\uDC00-\uDC7F]` | ASI01 |
| P-PIPE-09 | Base64-encoded instruction override (canonical override phrases) | base64 of `ignore previous instructions`, `system prompt:`, `you are now`, `disregard previous instructions`, `ignore all previous instructions` | ASI01 |
| P-PIPE-10 | Homoglyph-masked instruction trigger (non-ASCII confusable near override keyword) | Cyrillic/Greek/Armenian/Cherokee/Georgian/Coptic/Deseret codepoint within 20 chars of `ignore`, `system`, `instructions`, `you are`, `disregard`, or `override` | ASI01 |
| P-PIPE-11 | Markdown/HTML image URL exfiltration attempt | `!\[[^\]]*\]\(\s*(?:https?:|data:|file:)` or `<img[^>]+src\s*=\s*["']\s*(?:https?:|data:)` (i) | ASI01 |
| P-PIPE-12 | Error/debug frame wrapping an instruction override | `(?:error|exception|warning|debug|stderr|traceback|panic)[\s:=\-]{1,4}[^\n]{0,80}(?:reveal|print|output|dump|show|leak|expose|display)\s+(?:the\|your)?\s*(?:system\s+prompt|prompt|instructions?|context|secrets?|tokens?|keys?)` (i) | ASI01 |

P-PIPE-08 through P-PIPE-12 added in Cycle 8 Wave 3 per finding `C8-D15-M1-deny-pattern-2026-variants`. Source citations live in the `INJECTION_PATTERNS` constant comment in `src/pipeline/promptGuard.ts` (OWASP LLM01:2025, AWS security blog on Unicode smuggling, Microsoft MSRC indirect prompt injection 2025-07, Promptfoo base64/homoglyph strategies, Simon Willison exfiltration-attacks corpus, Unit 42 AI Agent Prompt Injection 2025).

Adding a pipeline pattern: append a new `P-PIPE-NN` row here, add the RegExp entry to `INJECTION_PATTERNS` in `src/pipeline/promptGuard.ts` with a `// pattern-id: P-PIPE-NN` comment on the object line, and update test assertions. The synchronization test fails if either side drifts.

### Section B — Learnings Storage Patterns (learningsValidation.ts)

Scope: content written to `.hatch3r/learnings/` files. These patterns defend against ASI06 (memory & context poisoning) — poisoned learnings load into every future session via the learnings-loader.

| Pattern ID | Description | Regex (code canonical form) | ASI control |
|-----------|-------------|-----------------------------|-------------|
| P-LEARN-01 | Fake section headers mimicking system/agent instructions | `^#{1,2}\s*(system\s+prompt|instructions|you\s+are|role)\s*:` (im) | ASI06 |
| P-LEARN-02 | Embedded YAML frontmatter overriding agent config | `^---\s*\n[\s\S]*?(protected|scope|model)\s*:` (m) | ASI06 |
| P-LEARN-03 | Attempts to override other agents' context | `(?:override|replace|ignore)\s+(?:agent|rule|skill)\s+` (i) | ASI06 |
| P-LEARN-04 | Fake managed block markers (merge output injection) | `HATCH3R:(BEGIN|END)` | ASI06 |
| P-LEARN-05 | Injected tool invocations | `<(?:tool_use|function_call|antml:invoke)\b` (i) | ASI06 |

### Section C — User-Facing Screening Categories (hatch3r-learn.md)

Scope: user-facing prose categories presented at `commands/hatch3r-learn.md` Step 3 before any file is written. The command operator prompts the user to rephrase; there is no regex enforcement at this layer, so patterns are described qualitatively.

| Category ID | Description | Example triggers |
|-------------|-------------|------------------|
| C-UI-01 | Phrases impersonating system instructions | "You are now", "Ignore previous instructions", "Override", "System:", "New role:", "IMPORTANT: disregard" |
| C-UI-02 | Instructions targeting other agents | "When [agent-name] reads this", "The next agent should", "Execute the following" |
| C-UI-03 | Attempts to redefine tool access, security policies, or agent roles | Redefining allowed tool lists, reassigning permissions, rewriting agent scope |
| C-UI-04 | Encoded payloads | Base64-encoded blocks, unusual Unicode sequences, zero-width characters |

Category C-UI-04 (encoded payloads) is not covered by regex Section A or B — it requires the operator to recognize structural anomalies. Adding a new category here requires a corresponding update to `commands/hatch3r-learn.md:59-65` Step 3.

### Change Protocol

1. Edit this catalog first — add rows, renumber IDs additively (never renumber existing IDs).
2. Update the matching code constant (`INJECTION_PATTERNS` or `LEARNINGS_INJECTION_PATTERNS`) with the new RegExp and a `// pattern-id: <ID>` line comment.
3. Update `commands/hatch3r-learn.md:59-65` if the change affects user-facing screening categories.
4. Run `npm test -- injectionPatternsSync` to verify synchronization.
5. Run the full test suite (`npm test`), typecheck (`npx tsc --noEmit`), and lint (`npm run lint`).

### Related Governance

- OWASP Agentic Security Initiative (ASI) Top 10 — ASI01 (Goal Hijack), ASI06 (Memory Poisoning), ASI07 (Insecure Inter-Agent Communication).
- `rules/hatch3r-security-patterns.md` §ASI01 — defense-in-depth for agent goal hijack, references this catalog for pattern enumeration.
- `governance/audit/domains/D15-agentic-security.md` — audit domain covering ASI01-10 controls.
- `governance/audit/domains/D05-prompt-engineering.md` — audit domain covering prompt quality; this catalog supports SA5.5 de-duplication.
