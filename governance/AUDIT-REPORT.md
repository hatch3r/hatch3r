# hatch3r — Full Framework Audit Report (Cycle 7)

## Tier 1: Executive Dashboard

```
Audit Date: 2026-04-19
Framework Version: 1.5.1
Git Commit: 4215a29
Branch: release/1.6.0
Previous Audit: 2026-04-19 (Cycle 6, pre-execution), commit c9766ef, score 34
Auditor: Claude Opus 4.7 (1M context)
Domains Covered: 19/19
Sub-Agents Deployed: 106 (delegated via 14 parallel domain orchestrators)
Commits Since Previous: 1 (4215a29 refactor: web research + scientific rigor core methodology)

Overall Score: 31/100 (Weighted, pre-execution)
Score Band: Not Ready
Severity Ceiling Applied: Yes — D5, D8 have unresolved Critical findings; both capped at 50/100 max (formula scores of 0 and 19 are lower; cap does not tighten)

Finding Totals (Pre-Dedup):
- Critical: 2
- High:     96
- Medium:   207
- Low:      81
- Info:     82
- TOTAL:    468

Finding Totals (Post-Dedup, ~23% collapse via D16 cross-domain pattern consolidation):
- Critical: 2
- High:     72
- Medium:   158
- Low:      66
- Info:     70
- TOTAL:    ~368

Top 3 Strengths:
1. Supply-chain security: OIDC trusted publishing + npm provenance + ignore-scripts + 100% SHA-pinned GitHub Actions + lockfile-lint are all operational (D4 89/100, D15 SA15.3).
2. Atomic write pattern in src/merge/safeWrite.ts (tmp+rename+fdatasync with Windows EBUSY retry) prevents partial-write corruption; 99.03/94.91/100/100 coverage on src/merge/, 85% global line coverage across 1993 passing tests (D1, D3).
3. Integrity manifest uses path-keyed SHA-256 verification — Cycle 6 "swap detection gap" Critical is RESOLVED (D2-SA2.7-1 strength); failureLog fully wired in sync/update; failure classification differentiates transient vs substantive (D8 strengths).

Top 3 Critical Issues:
1. [D8-SA8.4-1 CRITICAL / D15 Overarching] Implemented-but-unwired resilience: 5 of 7 resilience modules (circuitBreaker, adapterTimeout, phaseTimeout, pipelineTimeout, phaseOutputSchema) exist as TypeScript but are invoked only by tests; complianceVerification.ts reports PASS based on module existence, not runtime invocation. Cascades to D15 Cycle 6 Criticals being UNRESOLVED (review-loop iteration limit, MCP tool poisoning detection, trust delegation chain all depend on runtime enforcement).
2. [D5-SA5.8-C1 CRITICAL] Four severity vocabularies coexist (reviewer verdicts, reviewer levels, security-auditor severity, check tags, audit severity) with no canonical map. Persists from Cycle 5/6. governance/audit/templates/severity-mapping.md still absent. Blocks fixer bucketing, auditor-to-fixer pipe, reviewer loop termination calibration.
3. [Cross-domain D16-SA16.1-5] Silent failure class: 10+ call-sites across 5 layers (D1, D2, D5, D9, D19) catch-and-skip without emitting to warnings[], observability, or failure-log. D19-F19.4.1 manifests as SessionStart hook reporting "Registry not found" every session (primary in-session governance signal non-functional).

Competitive Positioning: Technically differentiated on managed blocks + integrity manifest + 19-domain governance (no top-5 competitor has either); distribution gap persists — 20 GitHub stars and 326 monthly npm downloads vs closest analogue Ruler at 2.6k stars (130× underperformance on distribution execution despite shipped npm v1.5.1 + public GitHub).
Distribution Recommendation: GO on Claude Code plugin marketplace submission in Wave 1 (days 1-7), 6 bounded preconditions totalling 4-5 eng days + 1 submission day; MIT retained; compound-system hardening (unwired + silent-failure patterns) runs as parallel track, not blocker.
```

### Holistic Assessment

Cycle 7 lands at 31/100, nearly identical to Cycle 6's 34/100 pre-execution — signalling that the framework's structural gaps have not been executed-against between cycles, but methodology has deepened. The score is dominated by two systemic patterns that D16 cross-domain synthesis identified explicitly: **"implemented-but-unwired"** (runtime modules exist but CLI commands don't invoke them, cascading through D1/D7/D8/D10/D14/D15) and **"silent failure class"** (catch-and-skip without diagnostic channel across 10+ call-sites). Both are honest structural consequences of hatch3r being a *configuration generator*, not a runtime orchestrator — SECURITY.md now admits this at line 124, but the enforcement-model table (SECURITY.md:60-81) still labels modules as "Code / Active" when they run only in tests.

The codebase itself remains sound: 1993 tests passing, 82.98/70.85/89.72/84.98 v8 coverage, 0 npm audit vulnerabilities, OIDC trusted publishing and npm provenance operational, all 15 platform adapters functional with 100% test coverage, and previous Cycle 6 Critical "integrity swap detection gap" has been verified resolved. Distribution baseline has materially improved since Cycle 6: npm v1.5.1 is shipped (7 versions since 2026-02-28), the GitHub repo is public (20 stars), release pipeline with provenance is operational — the existential framing has narrowed from "ship anything" to "marketplace listing + community building."

Holistic divergence from formula score: the formula score of 31 reflects accumulated findings in the highest-weight tiers (D1/D2 each 0.077 weight, both floored at 0) rather than catastrophic failure. Resolving the D8 Critical and the D16 unwired + silent-failure patterns would cascade score recovery across D1, D7, D8, D10, D14, D15 — a single coordinated wave (4-6 engineering days per D18-SA18.3 preconditions) would return the band to Minor Issues/Ship Ready. The Cycle 7 score is methodologically valid but understates the distance to shippable.

### Domain Heatmap

| Domain | Score | C | H | M | L | I | Rigor Provenance |
|--------|-------|---|---|---|---|---|------------------|
| D1: Core Source Implementation | 0 (floor) | 0 | 6 | 16 | 8 | 2 | High median |
| D2: Adapter Infrastructure | 0 (floor) | 0 | 10 | 22 | 8 | 5 | High median |
| D3: Test Infrastructure | 41 | 0 | 3 | 9 | 2 | 6 | High median |
| D4: Build, CI/CD & Dependencies | 89 | 0 | 0 | 1 | 8 | 19 | High median |
| D5: Prompt Engineering Quality | 0 (floor + Crit cap 50) | 1 | 18 | 28 | 8 | 0 | High median |
| D6: Context Engineering | 45 | 0 | 2 | 11 | 2 | 0 | Medium-High |
| D7: Agent Orchestration | 30 | 0 | 3 | 12 | 4 | 0 | High median |
| D8: Error Recovery & Resilience | 19 (Crit cap 50) | 1 | 3 | 8 | 2 | 0 | High median |
| D9: Platform Adapters | 0 (floor) | 0 | 11 | 15 | 2 | 17 | High median |
| D10: User Experience & Documentation | 28 | 0 | 2 | 14 | 10 | 2 | Medium-High |
| D11: End-to-End Data Flow | 58 | 0 | 2 | 6 | 4 | 3 | High median |
| D12: CLI Diagnostics & Traceability | 55 | 0 | 0 | 13 | 6 | 0 | High median |
| D13: Human-AI Collaboration | 71 | 0 | 1 | 5 | 4 | 3 | High median |
| D14: Adaptability & Scalability | 58 | 0 | 2 | 6 | 4 | 2 | High median |
| D15: Agentic Security & Trust | 0 (floor) | 0 | 10 | 13 | 6 | 8 | High median |
| D16: Cross-Domain Synthesis | 38 | 0 | 5 | 4 | 0 | 0 | High median |
| D17: Competition & Market | 0 (floor) | 0 | 9 | 9 | 0 | 3 | High median |
| D18: PRD, Roadmap & Distribution | 4 | 0 | 7 | 8 | 2 | 4 | High median |
| D19: Agentic Development Self-Governance | 54 | 0 | 2 | 7 | 5 | 8 | High median |

Weighted score: Σ(domain_score × weight). Tier A weight 0.077 each, Tier B 0.0497 each, Tier C 0.0443 each, Tier D 0.039 each. Sum = **31.3/100**.

---

## Tier 2: Domain Summaries

### D1 — Core Source Implementation (Score: 0, floor)
**Counts:** 0C/6H/16M/8L/2I = 32 findings
**Top 3 Findings:**
- [H] `runInit` writes `.agents/hatch.json` at `src/cli/commands/init.ts:173` before adapter generation; on "All adapters failed" at line 215, manifest references tools with no output. Fix: defer writeManifest OR unlink on total failure.
- [H] `runUpdate` overloads npm-fetch + regenerate; `config`/`verify --fix` pay 30s network penalty unnecessarily (`src/cli/commands/update.ts:170-184`). Fix: split into `runPackageUpdate` + `runRegenerate`.
- [H] `atomicWriteFile` lacks file-locking primitive; concurrent processes (CI matrix) silently overwrite each other.
**Key Recommendation:** Split `runUpdate` and add manifest-rollback invariant to init/config/sync — unblocks 5 related findings.
**Strengths:** src/merge/ 99.03% coverage; safe atomic writes handle Windows EBUSY/EPERM retries; diff-hash verification on fixer handoff; well-typed `PipelineExecutionState`.

### D2 — Adapter Infrastructure (Score: 0, floor)
**Counts:** 0C/10H/22M/8L/5I = 45 findings
**Top 3 Findings:**
- [H] Silent frontmatter failures persist (`src/adapters/canonical.ts:99-130, 147-177`) — YAML errors, permission denied, UTF-8 decode all return null indistinguishably. Cycle 6 Critical re-recorded as High.
- [H] Homoglyph bypass in deny patterns covers Cyrillic/Greek/Armenian/Cherokee/Georgian + NFKC; Coptic/Deseret/Osage/Latin Extended Additional still bypass (`src/adapters/customization.ts:55-103`). Cycle 6 Critical narrowed, re-recorded as High.
- [H] Partial-sentence deny-pattern substitution leaves surrounding injection text intact (`customization.ts:217-230`). On ANY deny hit, drop the entire customization content.
**Key Recommendation:** Convert silent-null returns to `{file, error}` results with caller warnings; complete UAX #39 confusables; drop on deny-hit.
**Strengths:** Integrity manifest uses path-keyed JSON.stringify — Cycle 6 swap-detection gap RESOLVED (SA2.7-1); capability matrix introspection pattern ready for property-based tests; managed-block nesting detection present.

### D3 — Test Infrastructure (Score: 41)
**Counts:** 0C/3H/9M/2L/6I = 20 findings
**Top 3 Findings:**
- [H] `src/cli/commands/init.ts` branch coverage 32% vs 65% global threshold — P1-critical first-run command underhealing.
- [H] `config.test.ts` has 284 vi.mock + 43 vi.fn/spyOn (1942 LOC) — named anti-pattern per vitest 2026 guide; delivers no better coverage than init.test.ts's 29 real integration tests.
- [H] `src/archive/index.ts:256-280` (contiguous 24-line restore-on-failure block) uncovered; archive is the sync safety net.
**Key Recommendation:** Stage config.test.ts migration to fixture-harness pattern (mirror init.test.ts); add init workspace-detect + error-path tests; add archive rollback-on-corruption scenarios.
**Strengths:** src/merge/ 99.03%, customization 100%/92.85%, all 15 adapters have tests, pipeline aggregate 95.52/89.23/98.37, tmpdir+afterEach pattern standard — no flakiness indicators.

### D4 — Build, CI/CD & Dependencies (Score: 89)
**Counts:** 0C/0H/1M/8L/19I = 28 findings
**Top 3 Findings:**
- [M] No Socket.dev / malicious-dep scanner — npm audit catches only published CVEs; 2026 Axios + PackageGate attacks prove gap (30 min fix).
- [L] lockfile-lint missing `--validate-integrity --validate-package-names` flags (addresses PackageGate class; 5 min fix).
- [L] No CodeQL SAST workflow (30 min fix).
**Key Recommendation:** Add Socket.dev + tighten lockfile-lint + enable CodeQL — 3 hours total closes remaining supply-chain gaps.
**Strengths:** OIDC trusted publishing operational (release.yml L12-14, L35, L66 + environment gate L20); npm provenance configured; .npmrc ignore-scripts=true; 100% SHA-pinned GitHub Actions across 4 workflows (immune to tj-actions CVE-2025-30066 class).

### D5 — Prompt Engineering Quality (Score: 0, Critical cap 50; formula lower)
**Counts:** 1C/18H/28M/8L/0I = 55 findings
**Top 3 Findings:**
- [C] Four severity vocabularies with no canonical map; `governance/audit/templates/severity-mapping.md` still absent (3-cycle carry-over from C5).
- [H] `rules/hatch3r-observability-tracing-detail.mdc` is 97 lines shorter than `.md` — all code examples dropped on Cursor.
- [H] Zero XML-tag structuring (`<task>`, `<context>`, `<rules>`) across all 137 content artifacts — conflicts with Anthropic Claude 4.x 2026 guidance on long-input prompting.
**Key Recommendation:** Create severity-mapping.md; add .md↔.mdc parity CI gate; migrate 3 largest commands (codebase-map 1216, project-spec 1190, board-fill 683 lines) to SKILL.md + references/ pattern.
**Strengths:** Four-phase pipeline (research → implement → review → quality) with consistent handoff schemas; scope-aware rule frontmatter (`scope:` vs glob).

### D6 — Context Engineering (Score: 45)
**Counts:** 0C/2H/11M/2L/0I = 15 findings
**Top 3 Findings:**
- [H] Context budget warning fires post-write at `src/cli/commands/sync.ts:289` — files are already disk-committed before gate. Add pre-write gate and `--strict-budget` flag.
- [H] Quality charter imported by frontmatter AND re-embodied inline across 3+ agents — drift risk + token bloat. Pick one pattern (P4 favors reference-only).
- [M] Fixed 4 chars/token heuristic under-counts code by 10-20%; should be 3.75 for mixed content. Gemini 2.5 Pro budget is 2M not 200K.
**Key Recommendation:** Move budget check pre-write; normalize charter to reference-only; refresh per-tool budget table with citation + verification cadence.
**Strengths:** `PipelineContext` type is well-modeled; token-summary infrastructure ready for CLI consumer wiring.

### D7 — Agent Orchestration (Score: 30)
**Counts:** 0C/3H/12M/4L/0I = 19 findings
**Top 3 Findings:**
- [H] No `BLOCKED_PREMISE_CHALLENGE` AgentStatus — only reviewer can emit DESIGN_OBJECTION. Quality charter §3 asks premise-challenge but has no machine-actionable path.
- [H] Max-iteration calibration data (78/18/4% split cited at `reviewLoop.ts:18-27`) not captured reproducibly in artifact — violates Scientific Rigor Contract.
- [H] Oscillation detector is dead code in default config — needs ≥4 iterations, default max is 3. Detector never fires.
**Key Recommendation:** Add `BLOCKED_PREMISE_CHALLENGE` status + researcher/implementer protocol update; export iteration data from finding-registry.json; fix oscillation threshold.
**Strengths:** Four-phase pipeline with clear handoff points; `validatePhaseOutput` schemas well-typed (though TS-only).

### D8 — Error Recovery & Resilience (Score: 19, Crit cap 50)
**Counts:** 1C/3H/8M/2L/0I = 14 findings
**Top 3 Findings:**
- [C] 5/7 resilience patterns implemented-but-unwired (circuitBreaker, adapterTimeout, phaseTimeout, pipelineTimeout, phaseOutputSchema). Only failureLog is integrated. Retry-with-backoff missing entirely. `complianceVerification.ts` reports PASS based on module existence — misleading.
- [H] Circuit breaker (`src/pipeline/circuitBreaker.ts`) imported only by its test; sync/update external calls bypass the breaker — Cycle 6 finding #249 protection claim unfulfilled.
- [H] HatchError class usage inconsistent; some paths throw plain Error. Commander catches both but loses exitCode distinction.
**Key Recommendation:** Multi-PR Wave 1-2 integration ticket wiring each resilience module into its natural caller (sync, update, adapter.generate); update compliance check to verify invocation, not existence.
**Strengths:** `classifyFailure` at `circuitBreaker.ts:68-104` differentiates transient from substantive failures; failureLog fully integrated with JSONL rotation; phase timeout cooperative AbortController cancellation.

### D9 — Platform Adapters (Score: 0, floor)
**Counts:** 0C/11H/15M/2L/17I = 45 findings
**Top 3 Findings:**
- [H] Amazon Q hook event names wrong (`src/adapters/amazonq.ts:12-21`): emits `onPreCommit`/`onFileSave`/etc. but AWS 2026 schema expects `preToolUse`/`postToolUse`/`userPromptSubmit`/`stop`/`agentSpawn`. Hooks file is documentation-only, zero runtime effect.
- [H] Antigravity skills path wrong: adapter writes `.antigravity/skills/` but Google Codelabs documents `.agent/skills/` (singular). Antigravity does not discover hatch3r skills.
- [H] Governance self-contradiction: 16 adapters in code, 15 rows in docs matrix, 14 sub-agents in D09 file; "Intentional Omissions" claims windsurf/kiro hooks unsupported, contradicted by vendor docs AND hatch3r's own kiro.ts emission.
**Key Recommendation:** Fix Amazon Q hook event names + Antigravity skills path in Wave 1; reconcile capability matrix + D09 file + docs to 15-adapter truth; add Claude Code SkillHooks v2.1.x emission; add Cursor 3.0 `/worktree` `/best-of-n` bridge content.
**Strengths:** Amp, OpenCode, Zed, Aider verified fully current against April 2026 docs; claude adapter emits CLAUDE.md with proper managed block; all 15 adapters have 100% test coverage.

### D10 — User Experience & Documentation (Score: 28)
**Counts:** 0C/2H/14M/10L/2I = 28 findings
**Top 3 Findings:**
- [H] `src/cli/program.ts` (150 lines) is dead code diverging from shipped `src/cli/index.ts` — tsup builds only index.ts; program.ts declares `--fix`, `--max-fix-attempts`, `--docs` flags that never reach users.
- [H] `verify --fix` self-healing loop implemented (`src/cli/commands/verify.ts:92-193`) but flag not registered in `src/cli/index.ts:72-75` — feature unreachable. 5-min fix.
- [M] Content counts drift: `.cursor-plugin/plugin.json:4` claims 25 skills/22 rules; README + CLAUDE.md + docs claim 26/26; filesystem has 26/27.
**Key Recommendation:** Delete program.ts OR refactor index.ts to import its createProgram; register `--fix` on index.ts; add `validate --docs` to derive counts from filesystem.
**Strengths:** 11 CLI commands with `ora` spinners + `chalk` color + `boxen` framing; progressive disclosure via `--verbose`; 1993 tests pass ensuring first-run fidelity.

### D11 — End-to-End Data Flow (Score: 58)
**Counts:** 0C/2H/6M/4L/3I = 15 findings
**Top 3 Findings:**
- [H] Integrity-manifest asymmetry: `sync.ts:356` gates manifest write on adapter success; `update.ts:304-305` and `workspace/sync.ts:340-341` write unconditionally. Partial failures certify an incomplete file set.
- [H] `atomicWriteFile` tmp-file leak on mid-stream exceptions has no sweep/diagnostic; orphans accumulate.
- [M] Deny-pattern substitution doesn't re-scan — residue after replacement can form new matches.
**Key Recommendation:** Make manifest-write contingent on adapter success in all 3 call-sites; add tmp-file sweep on sync start; re-scan after deny-pattern substitution (or drop-on-hit per D2-SA2.3-2).
**Strengths:** Content index `byTypeAndId` available (even if underused); hash-based backup verification option present in safeWrite.

### D12 — CLI Diagnostics & Traceability (Score: 55)
**Counts:** 0C/0H/13M/6L/0I = 19 findings
**Top 3 Findings:**
- [M] `error()/warn()/info()` in `src/cli/shared/ui.ts` use `console.log` (stdout) instead of stderr — POSIX violation breaking CI scriptability. 30 min fix.
- [M] `hatch3r update` lacks `--dry-run` despite being destructive — D12 checklist literal violation.
- [M] No per-file adapter→canonical-source provenance — `AdapterOutput` has no `sourceFiles` field; outputs carry no source comments. Blocks 3 downstream sub-agent traceability checklists.
**Key Recommendation:** Fix stderr in ui.ts (Wave 1, 30 min); add `update --dry-run` (Wave 2); add `AdapterOutput.sourceFiles` provenance chain (Wave 3, 1 day amortised across SA12.2/12.3/12.4).
**Strengths:** Failure log with rotation wired; `sync --diff` present; integrity manifest includes generatedBy; verify --fix loop implemented (pending CLI registration); `--verbose` mode present.

### D13 — Human-AI Collaboration (Score: 71)
**Counts:** 0C/1H/5M/4L/3I = 13 findings
**Top 3 Findings:**
- [H] Confidence-expression propagation inconsistent: `hatch3r-workflow.md` propagates charter confidence directive in 6 explicit sub-agent-prompt locations; board-pickup, revision, quick-change have 0-2. ~15 min boilerplate standardization.
- [M] Phase 4a review gate ("0 Critical + 0 Warning") ignores reviewer confidence — a low-confidence APPROVE passes the same gate as high-confidence.
- [M] Learnings feedback loop manual-only — `hatch3r-learnings-loader` elaborately specified but never invoked by the 4 core commands.
**Key Recommendation:** Standardize confidence propagation across 4 orchestration commands; augment Phase 4a gate with confidence threshold.
**Strengths:** Agents emit structured confidence labels; quality charter frontmatter pervasive (16/16 agents).

### D14 — Cross-Project Adaptability (Score: 58)
**Counts:** 0C/2H/6M/4L/2I = 14 findings
**Top 3 Findings:**
- [H] Language-filter dead code path: `src/content/tags.ts` defines 6 language tags, `src/content/index.ts:373-466` implements filtering, `src/detect/repoAnalyzer.ts` detects 18 languages — but `src/cli/commands/init.ts` never passes `projectLanguages` at 5 `resolveSelection(...)` call sites (lines 469, 696, 734, 819, 965). Only 1 of 26 rules has a `lang:*` tag.
- [H] Zero import from 4 competitor formats D14 explicitly names (`.cursor/rules/`, `.github/copilot-instructions.md`, `.windsurfrules`, awesome-cursorrules). Tool configs detected for defaults but content never parsed — major brownfield friction.
- [M] Preset selection is step-function (minimal/standard/full); no graduated scaling by repo size or team size.
**Key Recommendation:** Wire `projectLanguages` through 5 init call-sites + tag rules (~2 hours); add Cursor importer in Wave 3 (~1 day); multi-cycle for remaining 3 formats.
**Strengths:** `repoAnalyzer.ts` detects 18 languages; detection infrastructure rich.

### D15 — Agentic Security & Trust (Score: 0, floor)
**Counts:** 0C/10H/13M/6L/8I = 37 findings
**Top 3 Findings:**
- [H] `verifyIntegrity()` never called from sync/update/add — tampered canonical files (compromised PR, malicious pack install) flow through undetected. Mechanical fix: preflight verify in sync/update/add.
- [H] MCP config accepts unpinned npm package versions (CVE-2025-6514 class, Shai-Hulud 2025, Axios 2026) — `mcp-utils.ts:147-158` warns on unscoped with `-y` but allows `npx -y @scoped/pkg` without `@version`. Add version-pin warning.
- [H] Review-loop iteration limit is prompt-only (Cycle 6 Critical, UNRESOLVED, re-raised as High). `createReviewLoop`/`recordReviewIteration` imported only from `__tests__/` + `complianceVerification.ts`.
**Key Recommendation:** Wave 1 mechanical fixes (preflight verifyIntegrity, MCP version-pin warn, review-loop plumbing); Wave 2 tool-poisoning mcp-scan integration; Wave 3 trust-delegation per-adapter `tools:` frontmatter emission.
**Strengths:** Multi-layered prompt injection defense (`src/pipeline/promptGuard.ts` 500KB in / 1MB out limits, boundary markers); `agentToolAllowlist.ts` deny-by-default across 8 categories (although unwired in CLI); classifyFailure distinguishes transient from substantive.

### D16 — Cross-Domain Synthesis (Score: 38)
**Counts:** 0C/5H/4M/0L/0I = 9 findings
**Top Patterns:**
- [H] **"Implemented-but-unwired"** (5 domains, 9+ components) — framework builds infrastructure that unit tests validate and compliance checks bless, but production code doesn't invoke. Recommendation: "Wiring Before Declaration" invariant + `scripts/verify-wired.ts` CI check.
- [H] **"Silent failure class"** (5 layers, 10+ sites) — catch-and-skip without diagnostic channel. Recommendation: "Silent Failure Contract" in CONSTITUTION.md + ESLint rule.
- [H] **"Count drift"** (4 surfaces, recurring cycle-over-cycle) — no derived canonical inventory; Cycle 6 one-time fix, Cycle 7 re-drift in rules(+1)/checks(+1). Recommendation: `scripts/inventory.ts` generates `governance/inventory.json`; CI check across all surfaces.
**Key Recommendation:** "Wiring Before Declaration" + "Silent Failure Contract" + derived-inventory mechanism — these 3 patterns unblock 20+ home-domain findings in D1/D5/D7/D8/D10/D14/D15/D19.
**Strengths:** Cycle 7 methodology deepened — 18 tier synthesis files read end-to-end vs Cycle 6's sampled approach; dedup gate rejected 12+ candidates as home-domain confirmations.

### D17 — Competition & Market Intelligence (Score: 0, floor)
**Counts:** 0C/9H/9M/0L/3I = 21 findings
**Top Findings:**
- [H] Distribution gap: 20 GitHub stars, 326 monthly npm downloads vs Ruler at 2.6k stars (closest functional analogue — single-source distribution pattern).
- [H] Claude Code plugin marketplace (`anthropics/claude-plugins-official/external_plugins`) is highest-leverage unfulfilled channel; hatch3r's canonical artifacts already match the plugin schema.
- [H] AGENTS.md primary-emission audit incomplete — opencode adapter should target sst/opencode (146k stars), not archived opencode-ai.
**Key Recommendation:** 60-day window sequence: Week 1 plugin marketplace submission (1 day) → Week 1-2 AGENTS.md fixes (2 days) → Week 2 README/CLI repositioning (0.5 day) → Week 2-3 Show HN + r/ClaudeAI (0.5 day) → Week 3-4 vs-Ruler table + ACP registry. Cumulative ~4.25 eng days + 1-2 distribution execution days.
**Strengths:** Managed blocks + SHA-256 integrity + 19-domain governance are defensible moats (no top-5 competitor has either); 15 adapters exceeds any competitor's breadth (next-best Ruler at ~5).

### D18 — PRD, Roadmap & Distribution (Score: 4)
**Counts:** 0C/7H/8M/2L/4I = 21 findings
**Top Findings:**
- [H] PRD §5 competitor stars materially stale vs D17 live — Superpowers PRD 130k / live 160k, Spec Kit 84k / 89.4k, OpenCode 114k / 146k. Cline (60.5k, top-5) absent from PRD.
- [H] PRD §22 conflates "implemented", "wired", "CLI-registered" — lists `verify --fix`, `validate --docs`, 5 resilience modules as "shipped" but D10/D8/D15 all confirm they don't reach production codepath.
- [H] Claude Code marketplace submission should be P0, decoupled from Agent Teams (PRD §22 M2 treats Agent Teams as 3-4-week marketplace prereq; D17 analysis shows submission is 1-day packaging exercise).
**Distribution Verdict:** GO on Claude Code plugin marketplace submission in Cycle 7 Wave 1 (days 1-7), with 6 preconditions totalling 4-5 eng days + 1 submission day; MIT retained; GitHub-public + npm-publish already shipped; compound-system hardening runs parallel.
**Strengths:** PRD is comprehensive (88KB, 24 sections); roadmap exists (todo.md); release pipeline operational (OIDC + provenance).

### D19 — Agentic Development Self-Governance (Score: 54)
**Counts:** 0C/2H/7M/5L/8I = 22 findings
**Top 3 Findings:**
- [H] SessionStart hook's python3 script broken at `.claude/settings.json:24` — treats `finding-registry.json` (list) as dict via `.get('findings', [])`, raises AttributeError; `2>/dev/null || echo 'Registry not found'` masks it. Every session falsely reports "Registry not found" — primary in-session governance signal non-functional.
- [H] CLAUDE.md:19 "16 agents" claim remains ambiguous — reality is 16 main + 20 modes + 2 shared = 38 files. Cycle 6 Critical partially resolved (surface count matches) but semantic ambiguity persists.
- [M] SessionStart `head -90 CONSTITUTION.md` truncates P6 Security pillar from session-start context injection.
**Key Recommendation:** Fix SessionStart hook (Wave 1, 15 min); replace CLAUDE.md:19 agents row with "16 main + 20 modes + 2 shared"; extend `head` count or restructure CONSTITUTION.md front-matter to include all 6 pillars.
**Strengths:** `.claude/rules/` covers all 6 pillars with explicit pillar mapping; `.claude/skills/` provides workflow automation (audit-cycle, audit-execute, release-prep, etc.); 6 binding pillars explicitly referenced in development instructions.

---

## Tier 3: Domain Detail

See `.audit-workspace/D{N}-synthesis.md` for the complete per-domain finding lists with verbatim Critical/High, Medium 1-line summaries, and Low/Info counts. Each synthesis file preserves file:line refs, YAML rigor schema headers, confidence ratings, and source citations per the Scientific Rigor Contract. The per-sub-agent finding files (`.audit-workspace/D{N}-SA{M}.findings.md`) contain the full-text findings for Wave 1-4 execution planning.

---

## Cross-Domain Analysis

| # | Finding | Domains | Primary | Severity | Recommendation |
|---|---------|---------|---------|----------|----------------|
| 1 | Implemented-but-unwired: resilience modules, flag surfaces, filter logic, importers exist in code but not invoked by production CLI. Compliance checks verify existence, not invocation. | D8, D7, D10, D14, D15, D16 | D8 | Critical (D8-SA8.4-1), systemic | Multi-PR Wave 1-2: wire each unwired module to its natural caller; update compliance checks to verify invocation; add `scripts/verify-wired.ts` CI gate. |
| 2 | Silent failure class: catch-and-skip across 10+ call-sites without emitting to warnings[], observability.ts, or failure-log. Causes SessionStart hook masking, broken adapter hooks (amazon-q), silent frontmatter drops. | D1, D2, D5, D9, D19, D16 | D16 | High | Add "Silent Failure Contract" to CONSTITUTION.md; ESLint rule flags catch blocks without diagnostic emission; per-site remediation (10+ sites) staged across Wave 2-3. |
| 3 | Count drift across 4 inventory surfaces (CLAUDE.md tables, README badges, plugin.json, D05/D09 domain files, website docs). No derived canonical inventory; hand-maintained surfaces drift within months of any manual fix. | D10, D19, D5, D9, D16 | D16 | High | `scripts/inventory.ts` derives `governance/inventory.json` from filesystem; CI `check-inventory.ts` fails on disagreement across all surfaces. |
| 4 | Severity vocabulary fragmentation: 5 concurrent vocabularies (reviewer verdicts, reviewer levels, security-auditor severity, check tags, audit severity) with no canonical map. 3-cycle carry-over. | D5, D7, D13, D16 | D5 | Critical (D5-SA5.8-C1) | Create `governance/audit/templates/severity-mapping.md` with 5-column canonical map + cross-references from each consumer; add AUDIT-EXECUTE.md regression gate check. |
| 5 | Confidence signal pipeline has 4 stages with 3 dropping signal: emission (agents OK), propagation (4 commands inconsistent), gate (Phase 4a ignores confidence), UX layer (aggregates without summary). | D13, D7, D5, D16 | D16 | Medium (spans High home-findings) | First-class `confidence` field in PipelineContext PhaseHandoff; gate augmentation for low-confidence PASS. |
| 6 | Feature-status taxonomy absent: "implemented" conflates with "wired", "CLI-registered", "documented", "tested". PRD §22 lists unshipped-but-implemented items as "shipped." | D10, D12, D8, D15, D16, D18 | D18 | High (F18.1-H2) | Adopt 4-tuple feature-status taxonomy (implemented / wired / CLI-registered / tested) in finding-registry + PRD + audit gates. |

---

## Competitive Positioning Matrix

| Capability | hatch3r | Superpowers (160k⭐) | Spec Kit (89.4k⭐) | OpenCode (146k⭐, different cat.) | Cline (60.5k⭐, VS Code) | Ruler (2.6k⭐, closest analogue) |
|-----------|---------|----------------------|---------------------|------------------------------------|--------------------------|---------------------------------|
| Adapter breadth (AI coding tools targeted) | **15** | 1 (Claude Code) | 5-ish via spec conversion | 1 (terminal runtime) | 1 (VS Code) | ~5 |
| MCP support per adapter | ✓ native | ✓ (Claude only) | ✗ | — | ✓ (Cline native) | ✗ |
| Managed blocks + SHA-256 integrity | ✓ **unique** | ✗ | ✗ | ✗ | ✗ | ✗ |
| 19-domain governance audit methodology | ✓ **unique** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Preset system (minimal/standard/full) | ✓ | ✗ (skills are atomic) | partial via templates | ✗ | ✗ | partial |
| Canonical source → many outputs | ✓ | ✗ | partial | — | ✗ | ✓ (rules only) |
| Plugin marketplace listing | ✗ P0 | ✓ (official Anthropic marketplace) | ✓ | ✓ | ✓ | ✗ |
| Stars / monthly npm downloads | 20 / 326 | 160k / high | 89.4k / high | 146k / high | 60.5k / high | 2.6k / low |

hatch3r's differentiation on managed blocks + governance audit is defensible; the gap is distribution execution.

---

## Enhanced Action Items

> The full table of 368 post-dedup findings (ordered Critical → High → Medium → Low, within severity by impact-to-effort ratio) is tracked in `governance/audit/finding-registry.json` (Cycle 7 entries to be added by AUDIT-EXECUTE.md Phase 0). This report surfaces Blockers + Should-Have. Medium and Low are in synthesis files.

### Blockers (Critical, must fix before any release)

| # | Domain | Action Item | Severity | Effort | Risk Score | Owner | Depends On | Status |
|---|--------|-------------|----------|--------|------------|-------|------------|--------|
| C1 | D8 + cross (D7, D15, D16) | Wire 5 resilience modules (circuitBreaker, adapterTimeout, phaseTimeout, pipelineTimeout, phaseOutputSchema) into CLI commands sync/update/verify; add retry-with-backoff module; update complianceVerification.ts to verify invocation not existence | Critical | L | 5×5×3=75 | Agent | — | Open |
| C2 | D5 + cross (D7, D13, D16) | Create `governance/audit/templates/severity-mapping.md` with 5-column canonical map (reviewer verdicts, reviewer levels, security-auditor severity, check tags, audit severity); cross-reference from each consumer; add AUDIT-EXECUTE.md regression gate | Critical | S | 4×5×4=80 | Agent | — | Open |

### Should-Have (High, fix in current cycle)

Selected top 20 High findings (full list in finding-registry.json Cycle 7 entries):

| # | Domain | Action Item | Severity | Effort | Owner | Status |
|---|--------|-------------|----------|--------|-------|--------|
| H1 | D9 | Fix Amazon Q hook event names (`amazonq.ts:12-21`) to match AWS 2026 schema (`preToolUse` etc.) | High | S | Agent | Open |
| H2 | D9 | Fix Antigravity skills path from `.antigravity/skills/` to `.agent/skills/` | High | S | Agent | Open |
| H3 | D10 + D12 | Register `verify --fix` flag on `src/cli/index.ts:72-75` (5 min fix unlocks existing code) | High | S | Agent | Open |
| H4 | D10 | Delete `src/cli/program.ts` dead code OR refactor `index.ts` to import `createProgram()` | High | M | Agent | Open |
| H5 | D15 | Add preflight `verifyIntegrity()` to sync/update/add commands | High | S | Agent | Open |
| H6 | D15 | MCP config version-pin warning on unpinned `npx -y @scoped/pkg` without `@version` | High | S | Agent | Open |
| H7 | D19 | Fix `.claude/settings.json:24` SessionStart python3 script (iterate list, use `execution_status` key, remove `2>/dev/null`) | High | S | Agent | Open |
| H8 | D1 | Defer writeManifest at `init.ts:173` until after adapter generation succeeds | High | S | Agent | Open |
| H9 | D1 | Split `runUpdate` into `runPackageUpdate` + `runRegenerate` (update.ts:170-184); fix config/verify callers | High | M | Agent | Open |
| H10 | D16 | Add `scripts/inventory.ts` deriving `governance/inventory.json`; CI check across CLAUDE.md/README/plugin.json/domain files | High | M | Agent | Open |
| H11 | D16 | Add "Silent Failure Contract" to CONSTITUTION.md + ESLint rule flagging catch-blocks lacking diagnostic emission | High | M | Agent | Open |
| H12 | D5 | Add .md ↔ .mdc parity CI check; fix `hatch3r-observability-tracing-detail.mdc` 97-line shortfall | High | M | Agent | Open |
| H13 | D11 | Make integrity-manifest write contingent on adapter success in `update.ts:304-305` and `workspace/sync.ts:340-341` | High | S | Agent | Open |
| H14 | D8 | Convert all plain `throw new Error` to `HatchError` with exitCode; add ESLint rule | High | S | Agent | Open |
| H15 | D14 | Wire `projectLanguages` through 5 `resolveSelection(...)` call-sites in `init.ts`; tag rules with `lang:*` | High | M | Agent | Open |
| H16 | D17 + D18 | Submit to `anthropics/claude-plugins-official/external_plugins` (1 day packaging + submission) | High | M | Agent | Open |
| H17 | D9 | Add Claude Code SkillHooks v2.1.x emission in claude adapter | High | M | Agent | Open |
| H18 | D2 | Convert silent-null returns in `canonical.ts:99-130, 147-177` to `{file, error}` + surface via warnings | High | M | Agent | Open |
| H19 | D2 | Complete UAX #39 confusables coverage (Coptic/Deseret/Osage/Latin Extended Additional) | High | M | Agent | Open |
| H20 | D3 | Increase `src/cli/commands/init.ts` branch coverage from 32% to 65%; add workspace-detect + error-path tests | High | M | Agent | Open |

**Estimated effort (Critical + top-20 High):** ~25-30 engineering days across 4 waves.
**Recommended sequence:** Wave 1 = C1 + C2 + H1/H2/H3/H7 (quick-win cluster). Wave 2 = H4/H5/H6/H8/H9/H10/H11/H13 (architectural). Wave 3 = H12/H14/H15/H16/H17 (distribution + consistency). Wave 4 = remaining Highs + selected Mediums per finding-registry triage.

### Deferred (Medium/Low)

158 Medium + 66 Low findings, scheduled for Wave 3-4 and cross-cycle rollover. See per-domain synthesis files and finding-registry.json for complete list.

---

## Distribution Verdict

**GO** on Claude Code plugin marketplace submission in Cycle 7 Wave 1 (days 1-7).

**6 preconditions** (4-5 engineering days + 1 submission day):
1. WebFetch + parse `anthropics/claude-plugins-official` schema (30 min).
2. Audit AGENTS.md primary emission across adapters that target AGENTS.md convention (2 days).
3. Fix `.cursor-plugin/plugin.json` content counts to match filesystem (derived inventory preferred, mechanical fix acceptable for submission) (15 min).
4. Add Claude Code SkillHooks v2.1.x emission in claude adapter (H17 above) (4 hours).
5. Register `verify --fix` on `src/cli/index.ts` (H3 above) (5 min).
6. Submission + listing verification (1 day).

**License:** MIT retained (no change).
**Timing:** Immediate — compound-system hardening (unwired + silent-failure patterns) runs as parallel track, not a distribution blocker. Marketplace submission does not depend on Critical/High remediation.
**Follow-on:** Cursor marketplace formalisation in Wave 2 (~2 days); Show HN + r/ClaudeAI + docs.hatch3r.com in Week 2-3 per D17 sequencing.

**Baseline correction vs Cycle 6 framing:**

| Dimension | Cycle 6 | Cycle 7 ground truth |
|-----------|---------|---------------------|
| GitHub visibility | "zero public" | PUBLIC, 20 stars (live 2026-04-19) |
| npm publish | "zero" | v1.5.1 shipped (7 versions since 2026-02-28, 326 monthly downloads) |
| Release pipeline | unclear | OIDC + provenance + audit gate operational |
| Primary distribution gap | "ship anything" | "marketplace listing + community building" |

---

## Delta Since Previous Audit (Cycle 6 → Cycle 7)

**Commits between audits:** 1 (4215a29 — refactor: web research + scientific rigor core methodology).
**Timeline:** Same-day re-audit (2026-04-19) after methodology refactor.

### Score Changes per Domain

| Domain | Cycle 6 | Cycle 7 | Delta | Driver |
|--------|---------|---------|-------|--------|
| D1 | 0 | 0 | 0 | Floor; similar findings re-surfaced with tighter rigor |
| D2 | 0 | 0 | 0 | Floor; Cycle 6 Critical (swap detection) RESOLVED, 2 others re-raised as High |
| D3 | 71 | 41 | -30 | Broader scope (config over-mocking surfaced; init coverage measured at 32%) |
| D4 | 86 | 89 | +3 | Net improvement; Cycle 6 Mediums resolved, only Low/Info remain |
| D5 | 0 | 0 | 0 | Floor; Criticals reduced 3→1 (C5 persists, C6/C7 demoted to High) |
| D6 | 28 | 45 | +17 | Improved; Cycle 6 Highs largely resolved |
| D7 | 56 | 30 | -26 | Deeper methodology surfaced oscillation-detector dead code, premise-challenge gap |
| D8 | 20 | 19 | -1 | Similar; 5 prior Highs consolidated into 1 Critical + 3 Highs |
| D9 | 66 | 0 | -66 | Per-adapter currency research enforced; Amazon Q + Antigravity defects surfaced |
| D10 | 14 | 28 | +14 | Improved; Medium count ↓21→14; 2 Highs newly identified (program.ts, verify --fix) |
| D11 | 0 | 58 | +58 | Triaged — Cycle 6 over-indexed at 25 Medium; Cycle 7 severity discipline |
| D12 | 58 | 55 | -3 | Similar; Cycle 6 Highs resolved, structural gaps (stderr, provenance) surfaced |
| D13 | 37 | 71 | +34 | Improved; prior Highs resolved |
| D14 | 58 | 58 | 0 | Stable |
| D15 | 0 | 0 | 0 | Floor; 3 Cycle 6 Criticals UNRESOLVED but re-raised as High |
| D16 | 78 | 38 | -40 | Deeper cross-domain synthesis surfaced 4 additional Highs |
| D17 | 0 | 0 | 0 | Floor; distribution gap narrowed (GitHub/npm now shipped) |
| D18 | — | 4 | new | Comprehensive PRD alignment + distribution verdict |
| D19 | 0 (cap) | 54 | +54 | Cycle 6 Critical partially resolved; count drift re-surfaced |

### New Findings
- D10-7.2.1/.2.2: program.ts dead code + verify --fix unregistered (new)
- D15 F15.4-01/F15.6-02: integrity skip on sync/update/add + MCP version-pin gap (new)
- D9 amazon-q hook event names wrong + antigravity skills path wrong (new per-adapter currency)
- D16 SA16.1-1 Implemented-but-unwired (new cross-domain pattern, 5 domains)
- D16 SA16.1-5 Silent Failure Class (new cross-domain pattern, 5 layers)
- D19 F19.4.1 SessionStart hook broken (new, reproducible)

### Resolved Findings
- D2 Cycle 6 C1 "swap detection gap" — VERIFIED RESOLVED (now strength)
- D6 most Cycle 6 Highs — improved
- D10 Medium count ↓21→14
- D11 over-indexing at 25 Medium — triaged to 6 Medium with severity discipline
- D13 multiple prior Highs

### Regressed Findings
- None structurally regressed. Cycle 7 count inflation reflects deeper methodology (live platform-docs research per adapter, cross-domain synthesis across 18 tier files end-to-end), not quality regression.

---

## Web Research Citations

Consolidated table of external sources cited across Cycle 7 findings. Per `governance/audit/templates/rigor-contract.md` Web Research Mandate.

| Source | URL | Accessed | Author / Org | Trust Tier | Topic / Domain |
|--------|-----|----------|--------------|------------|----------------|
| OWASP Top 10 for Agentic Applications 2026 | https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ | 2026-04-19 | OWASP | official-docs | D15 security |
| MCP Security Vulnerabilities — Practical DevSecOps | https://www.practical-devsecops.com/mcp-security-vulnerabilities/ | 2026-04-19 | Practical DevSecOps | independent-analysis | D15 MCP |
| MCP Security Timeline — Authzed | https://authzed.com/blog/timeline-mcp-breaches | 2026-04-19 | Authzed | vendor-note | D15 MCP |
| npm Supply Chain Attack — Palo Alto Networks | https://www.paloaltonetworks.com/blog/cloud-security/npm-supply-chain-attack/ | 2026-04-19 | Palo Alto Networks | vendor-note | D15, D4 |
| Axios npm Compromise — InfoQ 2026 | https://www.infoq.com/news/2026/04/axios-supply-chain/ | 2026-04-19 | InfoQ | independent-analysis | D4 |
| Anthropic Prompt Injection Defenses | https://www.anthropic.com/research/prompt-injection-defenses | 2026-04-19 | Anthropic | official-docs | D15 |
| MCP Tool Poisoning — Invariant Labs | https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks | 2026-04-19 | Invariant Labs | independent-analysis | D15 |
| Claude Code Hooks Reference | https://code.claude.com/docs/en/hooks | 2026-04-19 | Anthropic | official-docs | D19 |
| Vulnerable MCP Project Database | https://vulnerablemcp.info/ | 2026-04-19 | community | independent-analysis | D15 MCP |
| POSIX Standard Streams — Wikipedia | https://en.wikipedia.org/wiki/Standard_streams | 2026-04-19 | community | independent-analysis | D12 |
| stderr(3) Linux man page | https://linux.die.net/man/3/stderr | 2026-04-19 | Linux man | official-docs | D12 |
| GitHub CLI manual | https://cli.github.com/manual/gh_help_formatting | 2026-04-19 | GitHub | official-docs | D12 |
| Pino structured logging guide | https://www.dash0.com/guides/logging-in-node-js-with-pino | 2026-04-19 | Dash0 | vendor-note | D12 |
| vitest 2026 best practices | https://vitest.dev | 2026-04-19 | Vitest team | official-docs | D3 |
| Cursor 3.0 release notes | https://cursor.com/docs | 2026-04-19 | Cursor | official-docs | D9 cursor adapter |
| GitHub Copilot docs | https://docs.github.com/copilot | 2026-04-19 | GitHub | official-docs | D9 copilot adapter |
| AWS Q Developer docs | https://docs.aws.amazon.com/amazonq/ | 2026-04-19 | AWS | official-docs | D9 amazon-q adapter |
| Anthropic Skills Library | https://github.com/anthropics/skills | 2026-04-19 | Anthropic | official-docs | D5, D17 |
| Claude Code plugins marketplace | https://github.com/anthropics/claude-plugins-official | 2026-04-19 | Anthropic | official-docs | D17, D18 |
| Superpowers — obra/superpowers | https://github.com/obra/superpowers | 2026-04-19 | obra | independent-analysis | D17 competitor |
| Spec Kit — github/spec-kit | https://github.com/github/spec-kit | 2026-04-19 | GitHub | official-docs | D17 competitor |
| Cline — cline/cline | https://github.com/cline/cline | 2026-04-19 | cline | independent-analysis | D17 competitor |
| Ruler — intellectronica/ruler | https://github.com/intellectronica/ruler | 2026-04-19 | intellectronica | independent-analysis | D17 closest analogue |

---

## Closed-Loop Analysis

### Phase CL-1: PRD Evolution Candidates

| Candidate | Domain | Finding | PRD Section | Change Type | Priority |
|-----------|--------|---------|-------------|-------------|----------|
| Adopt feature-status taxonomy (implemented/wired/CLI-registered/tested) in §22 "Shipped" list | D18 + D16 | F18.1-H2, D16-SA16.1-4 | §22 | Replace | P0 |
| Replace §5 competitor table with pointer + D17 auto-refresh | D18 | F18.1-H1 | §5 | Replace | P1 |
| Rewrite §23 existential-risk row for shipped baseline (GitHub public, npm v1.5.1, OIDC) | D18 | F18.1-I3, F18.3-H2 | §23 | Rewrite | P1 |
| Prune §21 success metrics to "measured today" vs "deferred pending N users" | D18 | F18.1-M1 | §21 | Revise | P2 |
| Decouple Agent Teams from marketplace submission in §22 M2 | D18 | F18.2-H1 | §22 M2 | Restructure | P0 |
| Replace hard-coded content counts with derived-inventory pointer | D19, D10, D16 | F18.1-H3, F19.1.1/.2, D16-SA16.1-2 | §1, §22, §24 | Replace | P0 |
| Add "Wiring Before Declaration" architectural principle | D16 | D16-SA16.1-1 | New section | Add | P1 |
| Add "Silent Failure Contract" framework convention | D16 | D16-SA16.1-5 | New section | Add | P1 |
| Honestly partition trust-model controls: runtime-enforced vs delegated (SECURITY.md truth) | D15 | D15 Overarching | §20 or SECURITY.md | Revise | P1 |
| AAIF standard alignment positioning | D17 | 17.3-C | §5 or §22 | Add | P2 |

### Phase CL-2: Content Gap Artifacts

| Artifact | Type | Gap Description | Priority | Depends On |
|----------|------|-----------------|----------|------------|
| governance/audit/templates/severity-mapping.md | template | 5-column canonical map (reviewer verdicts, reviewer levels, security-auditor severity, check tags, audit severity); 3-cycle carry-over, 5 consumers blocked | **P1** | — |
| scripts/inventory.ts + governance/inventory.json | tool | Derive content/source counts from filesystem; feeds CLAUDE.md, README, plugin.json, D5/D9 domain files | **P1** | — |
| scripts/verify-wired.ts | CI check | Scans `src/cli/commands/` for every compliance-declared module; fails CI if module exists but not invoked | **P1** | D16-SA16.1-1 |
| 5 shared content extraction blocks → `agents/shared/` | content | Issue-type→skill mapping, tooling hierarchy, phase skip criteria, confidence expression, severity vocabulary currently duplicated across 4+ files each | **P2** | — |
| src/importers/cursor.ts (Cursor rules importer) | tool | D14 brownfield-adoption friction — 1-day effort for first competitor-format importer | **P2** | D14-SA14.4-001 |
| ESLint rule: flag catch-blocks without diagnostic emission | tool | Silent Failure Contract enforcement | **P2** | D16-SA16.1-5 |
| docs/wiring-invariant.md | docs | "Wiring Before Declaration" pattern documentation + examples | **P3** | — |

### Phase CL-3: Audit Self-Evolution Proposals (≤10)

| # | Proposal | Category | Current State | Proposed Change | Rationale | Risk |
|---|----------|----------|---------------|-----------------|-----------|------|
| 1 | Codify "read 18 tier synthesis files end-to-end" as D16 methodology | Process | D16 checklist says "synthesize across domains" (ambiguous) | Explicit mandate: read all 18 tier files; reject patterns with <3 domain citations | Cycle 7 D16 surfaced 4 additional Highs that Cycle 6 missed; deeper synthesis is load-bearing | Low — methodology addition, not scope change |
| 2 | Add D18 Phase 0 baseline: live-verify npm registry + GitHub API state | Process | Cycle 6 D18 used prior-cycle framing ("zero GitHub, zero npm") that was 7+ weeks stale | Mandate live verification before any distribution finding | Cycle 7 D18 found Cycle 6 framing materially stale — load-bearing for verdict | Low |
| 3 | Introduce feature-status taxonomy to finding-registry.json | Scoring methodology | finding-registry has execution_status but not implementation stage | Add 4-tuple: implemented / wired / CLI-registered / tested per finding | Would have caught D10-7.2.1/7.2.2, D8-SA8.4-1, D15 Overarching earlier | Medium — registry schema change |
| 4 | Severity discipline retrospective: D11 triaged 25 Medium → 6 Medium | Checklist refinements | D11 domain file has 4 sub-agents × broad checklists | Tighten D11 sub-agent scope; cap Medium findings at 8 per domain absent justification | Cycle 6 D11 over-indexed (Highs 4, Mediums 25); Cycle 7 triaged honestly | Low |
| 5 | Per-adapter currency research mandated, not optional | Checklist refinements | D9 file says "verify against latest docs" (P3 mandate) but Cycle 6 didn't enforce uniformly | Require URL + access date + trust tier citation for every adapter per cycle; staleness is a finding | Cycle 7 surfaced amazon-q + antigravity defects through rigorous currency check | Low |
| 6 | Cross-domain dedup: target 2-of-3 signal match | Process | Cycle 7 dedup gate rejected 12+ home-domain confirmations at D16 | Codify in AUDIT.md §Deduplication Protocol with examples | Current protocol allows inflation via home-domain redundancy | Low |
| 7 | Cycle 7 introduces 4th wave tier (beyond Cycle 6 3-wave) for systemic patterns | Process | AUDIT-EXECUTE.md has 4 waves but Wave 4 is loosely defined | Define Wave 4 as "cross-domain pattern" wave targeting D16 findings | 3 Cycle 7 D16 Highs cross 5+ domains; they deserve dedicated wave | Low |
| 8 | Allow domain orchestrators to bundle 2-3 related domains | Process | AUDIT.md spawns one sub-agent per sub-agent role (106 total) | Permit bundling D6-D8, D13-D14 as single domain-orchestrator invocations | Cycle 7 successfully bundled D6-D8 with quality-maintained output at lower orchestration cost | Low |
| 9 | Add "Inconclusive Areas" tracker in synthesis files | Process | Sub-agents may optionally add Inconclusive Areas (AUDIT.md line 251) | Upgrade to MUST for any domain with <3 Highs to flag depth concerns | Several Cycle 7 domains (D4, D12, D14) would benefit from explicit inconclusive tracking | Low |
| 10 | Pre-audit `verify --docs` validation gate | Process | Domain files can drift from code (D03 claims 47 test files, reality 88) | Run scripts/inventory.ts before audit start; auto-update or fail domain files | D3 domain file drift caught via Cycle 7 sub-agent observation | Medium — tool dependency |

---

## Audit History

| Date | Version | Overall Score | Auditor | Report Location |
|------|---------|---------------|---------|-----------------|
| 2026-04-10 | 1.5.0 | 97 (Cycle 5 post-exec) | Claude Opus 4.6 | (prior cycle) |
| 2026-04-19 | 1.5.1 | 34 (Cycle 6 pre-exec) | Claude Opus 4.7 | governance/AUDIT-REPORT.md (superseded) |
| 2026-04-19 | 1.5.1 | 31 (Cycle 7 pre-exec) | Claude Opus 4.7 (1M context) | governance/AUDIT-REPORT.md (this) |
