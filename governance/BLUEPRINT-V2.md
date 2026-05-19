# hatch3r 2.0.0 Blueprint Generator

> Last updated: 2026-05-19 | Source-of-truth: this file | Operationalized by: .claude/skills/h4tcher-blueprint-v2/SKILL.md

This prompt drives a maintainer through 12 parallel inventory scans, ~60 sparring themes with adversarial counter-proposals, and ADR-per-fork decision capture, then commissions 13 layer-doc writers that emit a clean-slate v2.0.0 specification at `governance/BLUEPRINT-V2.md` plus `governance/blueprint-v2/L01..L12-*.md` and per-decision ADRs. It does NOT rebuild hatch3r, does NOT edit v1 governance files, does NOT commit. Authority: write under `governance/blueprint-v2/` only; the v1 governance corpus stays read-only until v2 actually ships.

---

## §0 — Model-Independence Contract (by reference)

The Model-Independence Contract defined in `governance/EVOLVE.md` §0 applies unmodified to this prompt, to every sub-agent spawned, and to every artifact written under `governance/blueprint-v2/`. Do not restate it here — the EVOLVE.md §0 definition is authoritative. The contract bans these pattern classes in prompt body, SA output, ADRs, layer docs, and chat replies:

| Pattern class | Source enumeration |
|---------------|--------------------|
| Capability-tier words | See `governance/EVOLVE.md` §0 forbidden-pattern table row 1 |
| Capability-size words | See EVOLVE.md §0 row 2 (XL / large / small in capability sense; structural "small file" remains acceptable) |
| Generation words | See EVOLVE.md §0 row 3 (next-gen / latest / newest as capability claims) |
| Vendor / brand identity | See EVOLVE.md §0 row 4 (any AI lab name as self-identifier; product names tied to model identity) |
| Model-ID patterns | See EVOLVE.md §0 row 5 (version suffix digits, dotted version tags, dated model strings) |
| Context-window numerics | See EVOLVE.md §0 row 6 (numeric capability-window figures used as bragging rights) |
| Sub-word-unit terms | See EVOLVE.md §0 row 7 (budget-by-sub-word-unit references, BPE references, encoder-aware claims) |

Capability-abstract verbs replace forbidden phrasings: "the executing agent", "the orchestrator", "the layer sub-agent", "expanded capability bandwidth", "stronger long-context synthesis".

**File-path exception.** Backticked filenames inside `src/adapters/` that happen to derive from vendor identifiers are factual repo references, not self-identification.

**Platform-scope exception.** Factual references to the 15 v1 adapter targets named in `src/adapters/index.ts` are factual adapter-target references, not self-identification.

**Extension-by-analogy.** If a new term entering common usage maps to any banned class by analogy, treat it as banned and record the decision in `governance/blueprint-v2/workspace/preflight.json::by_analogy_decisions`.

---

## §0.5 — P8 Ambiguity Gate (B1, by reference)

Before any layer SA dispatches and before every sparring theme in §4, the orchestrator applies `agents/shared/user-question-protocol.md`. Triggers: ambiguous scope · multiple valid interpretations with materially different cost-scope-risk · irreversible action · missing acceptance criteria.

On any trigger, raise one question per turn via the platform-native question tool. Supply 2-4 numbered options with one-line trade-offs and a declared default-if-no-response. Bundle related sub-questions into one multiple-choice prompt; do not fire multi-question barrages. Single-shot defaults are recorded in `workspace/preflight.json` to suppress re-asking on the same theme.

This rule binds the preflight mode picker (full / resume / targeted-layer:L01..L12), the §3 synthesis confirmation gate, every §4 sparring theme, and the §5 ADR-commit gate. Read-only inventory in §1 and §2 SA dispatch are exempt — clarification is required only when downstream action would consume the answer.

---

## §1 — Inventory Phase

### §1.1 What the 12 layer SAs scan

Each layer SA reads the file set bound to its layer (the v1 evidence base), records line counts and `> Last updated:` headers, captures pillar references from the first 30 lines of each file, and writes one finding-per-block to `workspace/L{N}-findings.md` with the 7-field rigor-schema header. Inventory scan never edits files. SA chat reply is one line: `L{N}: {count} findings -> workspace/L{N}-findings.md`.

### §1.2 Out-of-scope set (uniform across all 12 layers)

- `governance/hatch3r-prd.md` (gitignored, operational)
- `governance/COMPETITIVE-ANALYSIS.md` (gitignored, market context)
- State files: `audit/finding-registry.json`, `audit/baseline.json`, `audit/execution-insights.json`
- The canonical content corpus is read for shape and count signals only — no individual artifact deep-dive in §1 (deep dives happen in §4 sparring on demand)

### §1.3 Per-domain source targets

Each layer SA does web research alongside the v1 file scan. Sources follow `governance/audit/templates/rigor-contract.md` §Per-Domain Source Targets. Recency and trust profile per layer:

| Domain group | Primary sources | Recency window | Trust-tier preference |
|--------------|-----------------|----------------|-----------------------|
| L01 / L11 (identity, governance heart) | Agentic-coding framework primary docs, published research on agent governance | 12 months · 36 months for peer-reviewed | official-docs > peer-reviewed |
| L02 / L09 (pillars, runtime) | OWASP ASI current revision, resilience-pattern references, eval frameworks for agentic apps | 12 months | official-docs > peer-reviewed > independent-analysis |
| L03 / L05 / L08 (adapters, tools, packs) | Platform changelogs ≤6 months, registry trust models (npm provenance, Sigstore docs), MCP server registry | 6-12 months | official-docs > vendor-note |
| L04 / L07 (project axes, lifecycle) | Onboarding surveys, worktree-isolation case studies, session-continuity research | 12 months | independent-analysis > blog-post |
| L06 (content classes) | Instruction-stacking research, skill-registry architectures | 12 months · 36 months for peer-reviewed | peer-reviewed > vendor-note |
| L10 (docs surface) | Docs-as-code references, doc-generation trigger patterns | 12 months | independent-analysis > blog-post |
| L12 (migration) | Major-version migration case studies (codemod, dual-run, compat shims) | 24 months | independent-analysis > peer-reviewed |

**Rejection rule (uniform across layers):** paywalled-without-public-summary sources are rejected. 404 / withdrawn sources trigger a re-research pass before the finding is admitted. Stale sources (outside the recency window) downgrade confidence one band per `rigor-contract.md`.

**Per-claim source minimum (uniform):** ≥ 2 independent sources per empirical claim (different author + organisation + funder per `rigor-contract.md` §Web Research Mandate). Code-behaviour claims may substitute file_path:line_number references when the claim is verifiable in repo. A claim that fails the source minimum is rejected at §3 admission — re-research is the SA's job, not the orchestrator's.

**Bias check per SA (uniform):** each layer SA names the bias risks active in its layer (confirmation, availability, anchoring) and flags any finding that inherits framing from a v1 governance file. A finding that cannot pass the bias check is downgraded one severity band before §3 admission.

### §1.5 Research-quality gate (admits findings into §3)

Before the orchestrator reads `workspace/L{N}-findings.md`, each file is admitted only if:

1. **Per-finding rigor schema present** — the 7 fields enumerated in `rigor-contract.md` §Required Finding Output Schema. Missing field → finding is rejected, not the whole file.
2. **Source count per empirical claim ≥ 2** — counted from the `sources:` list in the finding's rigor header.
3. **Trust-tier sanity** — at least one source row is `official-docs` or `peer-reviewed` for empirical claims about external practice; `blog-post` alone is insufficient for any empirical claim.
4. **Recency within window** — at least one cited source within the per-layer recency window listed in §1.3. Out-of-window sources downgrade confidence one band.
5. **Pillar tag present** — at least one Pn tag from the v1 pillar set (P1..P8) or from the v2 candidate set if §4.2 has fixed the new pillar set.

Rejected findings are written to `workspace/L{N}-rejected.md` with the rejection reason. The SA is re-dispatched only if ≥ 30% of its findings are rejected; otherwise the rejected findings simply do not feed §3.

### §1.4 v1 baseline inventory (frozen for cross-layer drift detection)

The 12 layer SAs reference this baseline when claiming "v2 ≤ X" lean targets. Counts derive from `governance/inventory.json` (regenerated by `npm run inventory`):

| Class | v1 count | Source |
|-------|----------|--------|
| Adapters | 15 | `src/adapters/` |
| Agents | 19 | `agents/hatch3r-*.md` |
| Skills | 63 (of which 30 cli-tool skills) | `skills/hatch3r-*/SKILL.md` |
| Rules | 42 (`.md` + 42 `.mdc` parity) | `rules/hatch3r-*.md` |
| Commands | 38 | `commands/hatch3r-*.md` |
| Hooks | 6 | `hooks/hatch3r-*.md` |
| Pipeline modules | 18 | `src/pipeline/*.ts` |
| CLI commands | 14 | `src/cli/commands/*.ts` |
| Total canonical artifacts | ~205 (115 content + 18 pipeline + 14 CLI + ~58 governance) | aggregate |

---

## §2 — 12-Layer SA Dispatch Table

Dispatch all 12 SAs in one orchestrator message. Each SA owns one layer, executes in parallel with the other 11, and respects the contract in §2.99. Parallel-safety holds: read-only on v1 files, disjoint writes (one findings file per layer), deterministic aggregation in §3.

| L | Layer | Files scanned in v1 | Web research focus | Output |
|---|-------|---------------------|--------------------|--------|
| L01 | Identity & Vision | `governance/VISION.md`, `README.md` tagline, `package.json::description` | Competitor positioning (agentic-coding frameworks), audience-survey patterns, quality-bar metrics | `workspace/L01-findings.md` |
| L02 | Pillar Set | `governance/CONSTITUTION.md` §2 P1-P8, §3 traceability matrix | 2026+ pillar-set examples from peer projects, pillar-overlap detection patterns, dual-directive structures | `workspace/L02-findings.md` |
| L03 | Adapter Pool | `src/adapters/*.ts` (15), `src/adapters/index.ts::adapterMap`, `ADAPTER_CAPABILITIES`, `TOOL_DISPLAY_NAMES` | Adapter consolidation patterns, native-MCP vs bridge tier, custom-adapter SDK shape | `workspace/L03-findings.md` |
| L04 | Project Shape Axes | `src/cli/commands/init.ts` (greenfield/brownfield, solo/team), `countProjectTypeExclusions`, init flow prompts | Onboarding axis richness (legacy / monorepo / domain), scaffold-vs-assist mode patterns | `workspace/L04-findings.md` |
| L05 | Tool Integration (MCP + CLI) | `src/cli/commands/mcp.ts`, `src/cli/commands/cliTools.ts`, `src/cliTools/`, D21 domain notes | MCP server registry state-of-art, CLI-vs-MCP latency benchmarks, auto-install policy references | `workspace/L05-findings.md` |
| L06 | Content Classes | `agents/`, `skills/`, `rules/`, `commands/`, `hooks/`, `governance/inventory.json::counts` | Content-system architectures (instruction stacking, skill registries), preset / pack / tag boundary | `workspace/L06-findings.md` |
| L07 | Lifecycle CLI | `src/cli/commands/` (14), worktree-setup, worktree-cleanup, handoff flow, learnings flow | Worktree-isolation case studies, session-continuity research, retrospective-surface patterns | `workspace/L07-findings.md` |
| L08 | Content Packs | `governance/pack-trust-model.md`, `src/cli/commands/add.ts`, `src/integrity/`, signing infra | Registry trust models (npm provenance, Sigstore), marketplace lessons-learned, capability declarations | `workspace/L08-findings.md` |
| L09 | Pipeline Runtime | `src/pipeline/*.ts` (18), `src/merge/`, `src/integrity/`, `src/pipeline/circuitBreaker.ts` | Resilience patterns (circuit-breaker variants), OTel for agentic apps, prompt-injection guard limits | `workspace/L09-findings.md` |
| L10 | Docs Surface | `README.md`, `CLAUDE.md`, `docs/`, `governance/`, `h4tcher-docusaurus-generator` skill | Docs-as-code patterns, auto-generation trigger references, per-adapter doc-output sets | `workspace/L10-findings.md` |
| L11 | Governance Heart | `governance/AUDIT*.md`, `governance/EVOLVE.md`, `governance/RE-ENVISION.md`, `audit/domains/D*.md`, `audit/templates/*.md` | Self-improving-systems research, eval frameworks for agent rules, dogfooding mechanisms | `workspace/L11-findings.md` |
| L12 | Migration Story | `CHANGELOG.md`, `hatch.json` schema, `src/cli/commands/update.ts`, deprecation history | Major-version migration patterns (codemod, dual-run, compat shims, side-by-side support) | `workspace/L12-findings.md` |

### §2.98 Parallel-safety guarantees (per `rules/hatch3r-agent-orchestration.md`)

The 12 SAs run in parallel because all three parallel-safety conditions hold:

1. **Read-only or disjoint writes.** All 12 SAs read v1 files (no writes to v1). Each writes exactly one file under `workspace/L{N}-findings.md` — disjoint write set, no shared file.
2. **Deterministic aggregation.** §3 synthesis reads files in a fixed L01..L12 order; finding IDs are derived from `L{N}-F{seq}` per layer (no cross-layer ID collisions).
3. **No shared mutable state.** Workspace state files (preflight.json, synthesis.md, sparring-log.md) are written by the orchestrator, never by SAs. SAs return their one-line chat summaries and nothing else.

Parallelism is mandatory under P8 B2 — invocation cost never justifies serializing the 12 layer SAs. The cost-dominance clause from `.claude/rules/fan-out-discipline.md` applies: cost governs how much context each SA receives (static-first prompt frame), not whether to spawn them.

### §2.99 Per-SA output contract (uniform, all 12 layers)

Each SA writes `workspace/L{N}-findings.md` with these requirements:

1. **Rigor-schema YAML header per finding** — the 7 fields from `governance/audit/templates/rigor-contract.md` §Required Finding Output Schema (confidence, confidence_basis, falsifiability, causal_chain ≥ 3 steps, bias_check, counter_argument, sources). One header per finding block, NOT a single header at the top of the file.
2. **One-line chat reply only** — `L{N}: {count} findings -> workspace/L{N}-findings.md`. No prose, no diffs, no quotes from v1 files in chat.
3. **Findings file cap: ≤ 200 lines.** SAs that exceed the cap compress to retain only top-severity findings; the rest move to a `deferred:` block at the end.
4. **Forbidden: pasting v1 file contents into chat.** SAs cite file_path:line_number; the orchestrator opens the file when needed.
5. **`sub_agents_spawned` rationale.** Each SA frontmatter declares its own fan-out if it splits research and inventory into parallel sub-tasks (typical pattern: 1 SA = 1 inventory scan + 2 web-research probes serialized). Recorded in the findings-file header metadata block.
6. **Inconclusive areas section.** Optional block listing examined territory where the SA could not determine a finding (used by §3 to mark genuine gaps vs declared coverage).
7. **Pillar tags per finding.** Each finding cites at least one pillar from `governance/CONSTITUTION.md` §2 P1-P8 (or the candidate v2 pillar set if §4.2 has fixed it). Findings with no pillar tag are rejected in §3.

---

## §3 — Synthesis

### §3.1 Read all 12 findings files

Orchestrator reads `workspace/L01-findings.md` through `workspace/L12-findings.md`, then writes `workspace/synthesis.md` containing: per-layer finding counts, a cross-layer index (finding ID · severity · layer source · file · one-line description), and the dedup-and-rank workings below. Individual SA files are released from orchestrator context after synthesis emits — only `synthesis.md` survives into §4.

### §3.2 Dedup rule (2-of-3 signal match per RE-ENVISION.md §3.2)

For each finding pair, compute a 2-of-3 match on: (file referenced) · (root concern stated in causal_chain step 1) · (recommendation phrase). A 2-of-3 match collapses the lower-severity finding into the higher one — record `dedup_target: <finding_id>` and exclude the collapsed entry from §4 sparring input. A 1-of-3 match surfaces as a "related" pointer but both findings remain admissible.

### §3.3 Lean-opportunity register

Findings tagged with size-reduction or duplication-elimination opportunities collect in `workspace/lean-opportunities.md` as a separate register. Each entry: source-layer · current-v1-state · proposed-v2-shape · estimated-line-or-artifact-delta · pillar-served. The register feeds §7's master-doc artifact-count target.

### §3.4 Must-rethink ranking

Findings are ranked into three tiers for §4 sparring throughput:

- **Tier-Rethink-1 (must surface in §4):** any finding with confidence=high AND at least one cross-layer reference (a finding from another layer agrees on the same concern). At minimum one Tier-Rethink-1 finding per layer feeds §4.
- **Tier-Rethink-2 (surface as time allows):** confidence=high single-layer findings OR confidence=medium cross-layer findings.
- **Tier-Rethink-3 (deferred to ADR-only capture):** confidence=low findings, single-layer medium findings without cross-references. These never block sparring throughput; they receive a one-line ADR-D mention if the layer doc references the same scope.

### §3.4.5 Cross-layer agreement signal

For each finding admitted to §4 sparring, the orchestrator computes a cross-layer agreement signal: count of other-layer findings that share a 1-of-3 match (file referenced OR root concern stated OR recommendation phrase). Findings with cross-layer agreement signal ≥ 2 are surfaced with a `cross_signal: ≥2` tag in the triage table; these jump to Tier-Rethink-1 regardless of single-layer confidence. The signal is computed once per synthesis run; it is not recomputed during §4 sparring.

### §3.4.6 Lean-opportunity cross-walk

For each entry in `workspace/lean-opportunities.md`, the orchestrator cross-walks against `governance/inventory.json::counts` to compute the delta if the opportunity is accepted. The cross-walk emits:

- Per-class delta — added or removed artifact count per `inventory.json::counts` class (adapters / agents / skills / rules / commands / hooks / pipeline / cliCommands).
- Per-file delta — added or removed line count per file (estimated from the lean-opportunity entry's `proposed_v2_shape`).
- Aggregate delta — sum across all opportunities. Compared against the v1 baseline in §1.4.

The aggregate delta feeds §7.1 step 5 (Total Artifact-Count Target). If the aggregate delta would push v2 above v1's artifact count, the synthesis surface flags an "anti-lean drift" warning to the maintainer during §3.5.

### §3.5 Hard-stop ASK gate

After synthesis emits, orchestrator presents the triage table to the maintainer and asks ONE question:

> **Question:** Proceed to the §4 sparring dialog with the triage shown above?
>
> 1. Proceed — full triage (Tier-Rethink-1 + as many Tier-Rethink-2 themes as the maintainer has appetite for).
> 2. Drop specific findings — list IDs.
> 3. Re-run a specific layer SA — list layer ID + reason.
> 4. Switch to targeted-layer mode — list one of L01..L12.
>
> Default if no response: 1

Hard-stop. The orchestrator waits for explicit response before any §4 turn.

---

## §4 — Sparring Topic Matrix

Each layer has 5-6 numbered themes. Themes are walked ONE AT A TIME — the orchestrator never batches across themes. Each theme renders the template below, then the orchestrator pauses for the maintainer's response, captures the decision in `workspace/sparring-log.md`, and emits an ADR per §5 before moving to the next theme.

### §4.0 Theme template (3-4 lines, no exceptions)

```
### T{layer}.{n}. {Theme name}
**Layer:** L{N} | **Pillar refs:** {Pn[, Pn]} | **Findings file:** workspace/L{N}-findings.md
Seed question: <one sentence>
Apparent preference seed: <one phrase capturing what the maintainer might default to>
Alternative seed: <one phrase capturing what the orchestrator counter-proposes>
Research keywords: <3-5 terms for live web search at theme time>
Default if no response: <option-letter>
```

Inside each theme the orchestrator presents 2-4 lettered options A-D with one-line trade-offs, then waits.

### §4.1 L01 — Identity & Vision (5 themes)

**T1.1 Tagline.** Pillar P1, P4. Seed: Does the current one-sentence framing still cover the audience? Apparent preference seed: refresh "tool-agnostic agentic coding setups". Alternative seed: re-pitch around outcomes (one-shot success rate). Research keywords: positioning lines for agentic coding frameworks, jobs-to-be-done framing, value-prop tests. Default: B.

**T1.2 Audience cut.** Pillar P1. Seed: Solo maintainers, small teams, or extend to platform/enterprise? Apparent preference seed: keep solo+small-team focus. Alternative seed: introduce a platform-engineer persona. Research keywords: developer-tool audience segmentation, persona-cluster analysis, ICP refinement. Default: A.

**T1.3 Quality-bar metric.** Pillar P2, P1. Seed: One-shot success rate, ship-velocity proxy, or a composite? Apparent preference seed: keep one-shot success. Alternative seed: composite (one-shot + diff-size + reviewer-iterations). Research keywords: agentic-coding evaluation metrics, ship-velocity proxies, multi-axis quality scoring. Default: A.

**T1.4 Outside-in vs inside-out scope.** Pillar P4, P1. Seed: Drive from end-user outcome backwards, or from canonical-content forwards? Apparent preference seed: continue inside-out (current shape). Alternative seed: flip to outside-in to force lean cuts. Research keywords: framework scoping methodologies, outside-in design, lean-product-discovery. Default: B (because v2 is the lean-cut moment).

**T1.5 Lean vs broad scope.** Pillar P4. Seed: Cut surface area to ~50 artifacts, or hold the ~115-artifact line? Apparent preference seed: reduce to ~50 artifacts. Alternative seed: hold ~115 but enforce ~70% silence (only ~35 active per workflow). Research keywords: framework size vs adoption, surface-area-vs-power studies, instruction-overload research. Default: A.

### §4.2 L02 — Pillar Set (5 themes)

**T2.1 Pillar count.** Pillar P5. Seed: Keep 8, reduce to 5-6 by merging adjacents, or expand to 9-10 to surface implicit pillars? Apparent preference seed: reduce to 6. Alternative seed: hold 8 but rebalance directives. Research keywords: governance-pillar count tradeoffs, principle-set granularity, pillar-overlap symptoms. Default: A.

**T2.2 Pillar overlap (P7 vs P8, P4 vs P5).** Pillar P5. Seed: Merge P7+P8 (efficiency+fan-out) and/or P4+P5 (lean+governance-self-quality)? Apparent preference seed: leave overlaps. Alternative seed: merge each adjacent pair. Research keywords: pillar-overlap detection, dimension-reduction in design principles, redundancy in governance corpora. Default: B (merge).

**T2.3 P3 currency necessity.** Pillar P3. Seed: Keep P3 (adapter currency) as a top-level pillar, fold into P2 (scientific quality), or fold into P6 (security & trust)? Apparent preference seed: keep P3 top-level. Alternative seed: fold P3 into P2 as a measurable-quality requirement. Research keywords: currency-as-quality framing, recency-as-rigor metric, top-level pillar criteria. Default: A.

**T2.4 P6 trust scope.** Pillar P6. Seed: Keep P6 broad (security + trust delegation + prompt injection) or split into security pillar + trust pillar? Apparent preference seed: keep broad. Alternative seed: split. Research keywords: OWASP ASI scoping, trust-delegation pillar design, security vs trust separation. Default: A.

**T2.5 P8 dual-directive shape.** Pillar P8. Seed: Keep P8 with B1 (clarification) + B2 (fan-out), or split into two pillars? Apparent preference seed: keep dual. Alternative seed: split. Research keywords: pillar-with-sub-directives, single-purpose pillar design, dual-directive precedent. Default: A.

### §4.3 L03 — Adapter Pool (5 themes)

**T3.1 Adapter count target.** Pillar P3. Seed: Hold 15, cut to 8-10 first-class, or expand toward 20? Apparent preference seed: cut to 8 first-class. Alternative seed: hold 15 but introduce a tier system. Research keywords: platform-adapter coverage breadth vs depth, first-class-vs-bridge adapter patterns, adapter-currency cost-per-platform. Default: A.

**T3.2 First-class vs bridge tier.** Pillar P3. Seed: Two-tier (first-class + bridge), three-tier (canonical / supported / community), or single-tier with capability flags? Apparent preference seed: three-tier. Alternative seed: single-tier + capability flags. Research keywords: adapter-tier model design, community-contributed adapters, capability-flag granularity. Default: A.

**T3.3 Capability matrix granularity.** Pillar P3, P1. Seed: Coarse (per-feature: mcp / hooks / rules-format), medium (per-feature × per-adapter), or fine (per-API-call)? Apparent preference seed: medium. Alternative seed: coarse with override notes. Research keywords: capability-matrix dimensions, adapter feature taxonomies. Default: A.

**T3.4 Native-MCP adapters.** Pillar P3, P5. Seed: Privilege native-MCP adapters (skip bridge), require bridge as fallback, or treat MCP-native as a separate first-class line? Apparent preference seed: privilege native. Alternative seed: keep bridge. Research keywords: MCP-native vs bridge adapter performance, MCP server registry, native-protocol latency. Default: A.

**T3.5 Custom adapter SDK.** Pillar P3, P4. Seed: Ship a public adapter SDK (`createAdapter()` API), document the BaseAdapter contract only, or close the surface to canonical maintainers? Apparent preference seed: SDK. Alternative seed: contract-only. Research keywords: plugin-SDK ergonomics, adapter contributor onboarding. Default: A.

### §4.4 L04 — Project Shape Axes (5 themes)

**T4.1 Greenfield/brownfield binary or richer.** Pillar P1. Seed: Keep binary, add legacy axis, or model project-shape as a multi-dimensional tag set? Apparent preference seed: add legacy axis. Alternative seed: multi-dimensional tag set. Research keywords: onboarding survey patterns, project-shape taxonomy, greenfield-brownfield-legacy gradient. Default: A.

**T4.2 Solo/team binary or richer.** Pillar P1. Seed: Keep binary, add team-size band (solo / 2-5 / 6-25 / 25+), or drop the axis entirely? Apparent preference seed: add team-size band. Alternative seed: drop. Research keywords: team-size impact on tooling, project-onboarding survey design. Default: A.

**T4.3 Domain axis (web / ML / embedded).** Pillar P4. Seed: Introduce a domain axis (web / mobile / ML / data / embedded / infra), require none, or make it adapter-driven? Apparent preference seed: introduce optional axis. Alternative seed: skip — adapter-driven. Research keywords: domain-specific scaffolding, vertical-specific frameworks. Default: A.

**T4.4 Monorepo axis.** Pillar P1, P4. Seed: Surface monorepo-vs-polyrepo as a first-class axis, capture via post-init detection, or skip? Apparent preference seed: post-init detection. Alternative seed: first-class axis. Research keywords: monorepo-aware tooling, workspace detection patterns, polyrepo migration. Default: A.

**T4.5 Scaffold vs assist mode.** Pillar P1, P7. Seed: Stay assist-only (canonical content writes), add a scaffold mode (project-level code generation), or split into two CLI verbs? Apparent preference seed: stay assist-only. Alternative seed: add scaffold mode behind a flag. Research keywords: scaffold-vs-assist tool taxonomy, code-generation scope boundaries. Default: A.

### §4.5 L05 — Tool Integration (5 themes)

**T5.1 CLI-vs-MCP default preference.** Pillar P3, P7. Seed: CLI-first (recommend CLI tools by default), MCP-first (recommend MCP servers by default), or mode-by-task? Apparent preference seed: mode-by-task. Alternative seed: CLI-first. Research keywords: CLI-vs-MCP latency benchmarks, MCP server adoption, tool-integration trade-offs. Default: A.

**T5.2 Tool tier model.** Pillar P3. Seed: Two-tier (canonical / community), three-tier (canonical / supported / community), or no tiers? Apparent preference seed: two-tier. Alternative seed: no tiers. Research keywords: tool-registry tier design, canonical-vs-community curation. Default: A.

**T5.3 Auto-install policy.** Pillar P1, P6. Seed: Never auto-install, prompt-then-install, or detect-and-suggest? Apparent preference seed: detect-and-suggest. Alternative seed: prompt-then-install. Research keywords: auto-install policy security, developer-trust onboarding, install-permission UX. Default: A.

**T5.4 MCP server set.** Pillar P3, P6. Seed: Curate a recommended MCP server set (≤ 8), publish a registry, or stay agnostic? Apparent preference seed: curate. Alternative seed: registry. Research keywords: MCP server registry state-of-art, server-curation criteria. Default: A.

**T5.5 Tool currency cadence.** Pillar P3. Seed: Verify tool currency every audit cycle, per release, or on-demand? Apparent preference seed: per release. Alternative seed: every audit cycle. Research keywords: dependency-currency cadence patterns, tool-version-drift detection. Default: A.

### §4.6 L06 — Content Classes (6 themes)

**T6.1 Content class count.** Pillar P4. Seed: Keep 5 classes (agents/skills/rules/commands/hooks), consolidate to 3 (instructions / skills / hooks), or expand to 6+ (add presets, packs)? Apparent preference seed: consolidate to 3. Alternative seed: keep 5. Research keywords: content-class taxonomy, instruction-stacking architecture, skill-registry design. Default: A.

**T6.2 Agent roster target.** Pillar P4. Seed: Cut from 19 to ~10 agents, hold 19, or expand toward 25? Apparent preference seed: cut to ~10. Alternative seed: hold 19. Research keywords: agent-roster sizing, sub-agent specialization vs generalization. Default: A.

**T6.3 CLI-skill consolidation.** Pillar P4. Seed: Collapse the 30 CLI-tool skills into one umbrella skill, keep all 30 as discoverable, or split into ~6 groups? Apparent preference seed: collapse into ~6 groups. Alternative seed: keep all 30. Research keywords: skill-discoverability vs skill-count, umbrella-vs-individual skill design. Default: A.

**T6.4 Rule count target.** Pillar P4, P5. Seed: Cut from 42 to ~20 rules, hold 42, or split rules by execution scope (always-on vs scoped)? Apparent preference seed: cut to ~20. Alternative seed: split by scope. Research keywords: rule-set sizing for agentic frameworks, rule-overlap detection, scope-based rule splitting. Default: A.

**T6.5 Preset model.** Pillar P4. Seed: Keep 3 presets (minimal/standard/full), replace with capability-tag composition, or add a 4th preset (security-hardened)? Apparent preference seed: replace with tag composition. Alternative seed: keep 3 presets + add security tag. Research keywords: preset-vs-composition design, capability-tag flexibility. Default: A.

**T6.6 Pack-vs-tag boundary.** Pillar P4, P8. Seed: Where does a "pack" end and a "tag set" begin — pack=signed-bundle vs tag=composition-key? Apparent preference seed: pack=signed, tag=composition. Alternative seed: collapse the distinction. Research keywords: pack-vs-preset semantics, signed-bundle vs unsigned-tag patterns. Default: A.

### §4.7 L07 — Lifecycle CLI (5 themes)

**T7.1 Command count.** Pillar P4, P1. Seed: Cut from 14 to ~8 CLI commands, hold 14, or split into command groups? Apparent preference seed: cut to ~8. Alternative seed: hold 14. Research keywords: CLI-command-count UX studies, command-group taxonomy. Default: A.

**T7.2 Worktree first-class vs optional.** Pillar P7. Seed: Promote worktree to a first-class lifecycle stage, keep as optional setup/cleanup pair, or remove? Apparent preference seed: first-class. Alternative seed: keep optional. Research keywords: git-worktree workflows, parallel-agent isolation patterns. Default: A.

**T7.3 Handoff state machine.** Pillar P7. Seed: Explicit state machine (PREP / RESUME / COMPLETE), implicit (current shape), or remove handoff entirely? Apparent preference seed: explicit state machine. Alternative seed: keep implicit. Research keywords: session-continuity state machines, agent-handoff protocols. Default: A.

**T7.4 Learnings shared-vs-local.** Pillar P4, P8. Seed: Local-only (per-project), shared-by-default (cross-project), or hybrid (local + opt-in sync)? Apparent preference seed: hybrid. Alternative seed: local-only. Research keywords: learnings-store architecture, cross-project knowledge transfer. Default: A.

**T7.5 Retrospective surface.** Pillar P5, P8. Seed: Built-in retrospective command, hook on completed PR, or skip? Apparent preference seed: hook on completed PR. Alternative seed: built-in command. Research keywords: retrospective automation, PR-completion hooks, project-level retrospective patterns. Default: A.

### §4.8 L08 — Content Packs (5 themes)

**T8.1 Tier model.** Pillar P4, P6. Seed: Two-tier (canonical / marketplace), three-tier (canonical / verified / community), or no marketplace? Apparent preference seed: three-tier. Alternative seed: no marketplace. Research keywords: pack-registry tier patterns, marketplace-trust gradient. Default: A.

**T8.2 Registry mix.** Pillar P6, P4. Seed: Single registry, federated (per-org), or fully decentralized (URL-pull)? Apparent preference seed: single. Alternative seed: federated. Research keywords: registry-mix patterns, federated-trust models, decentralized package pull. Default: A.

**T8.3 Signing requirement.** Pillar P6. Seed: Sign all packs (Sigstore / npm-provenance), sign verified-tier only, or trust-by-inspection? Apparent preference seed: sign verified+. Alternative seed: sign all. Research keywords: Sigstore adoption, npm-provenance baselines, supply-chain signing tradeoffs. Default: A.

**T8.4 Capability declaration granularity.** Pillar P6, P8. Seed: Per-pack capability manifest (declared tool access, file scope), per-pack hash only, or no manifest? Apparent preference seed: per-pack manifest. Alternative seed: hash-only. Research keywords: capability-manifest design, sandboxed-pack execution. Default: A.

**T8.5 Review queue automation.** Pillar P5, P6. Seed: Human-only review queue, semi-automated triage (rigor-contract pre-check), or fully automated approval? Apparent preference seed: semi-automated. Alternative seed: human-only. Research keywords: marketplace-review automation, rigor-pre-check patterns. Default: A.

### §4.9 L09 — Pipeline Runtime (5 themes)

**T9.1 Pipeline module count.** Pillar P4, P5. Seed: Cut from 18 to ~10, hold 18, or split into runtime / safety / observability sub-trees? Apparent preference seed: cut to ~10. Alternative seed: split into sub-trees. Research keywords: pipeline-module count and complexity, sub-tree organization. Default: A.

**T9.2 Circuit breaker necessity.** Pillar P5, P6. Seed: Keep circuit breaker (transient vs substantive classification), simplify to retry-only, or remove? Apparent preference seed: keep. Alternative seed: simplify. Research keywords: circuit-breaker patterns for agentic apps, retry-vs-breaker tradeoffs. Default: A.

**T9.3 Prompt guard limits.** Pillar P6. Seed: Hold 500KB input / 1MB output, recalibrate against current agent flows, or replace with per-tool budgets? Apparent preference seed: recalibrate. Alternative seed: per-tool budgets. Research keywords: prompt-size budget calibration, per-tool input-output limits. Default: A.

**T9.4 Tool allowlist granularity.** Pillar P6, P8. Seed: Per-agent allowlist (current), per-task allowlist, or coarser tool-category groups? Apparent preference seed: per-agent (keep). Alternative seed: per-task. Research keywords: tool-allowlist granularity, capability-restriction UX. Default: A.

**T9.5 Observability surface.** Pillar P5, P7. Seed: Logs only, traces + metrics + logs (OTel-aligned), or skip built-in observability? Apparent preference seed: traces + metrics + logs. Alternative seed: logs only. Research keywords: OTel for agentic apps, trace-metric-log surface for orchestrators. Default: A.

### §4.10 L10 — Docs Surface (5 themes)

**T10.1 In-repo doc scope.** Pillar P1, P4. Seed: README + CLAUDE.md only, expand to per-adapter docs, or split into authoring-doc + user-doc? Apparent preference seed: README + per-adapter. Alternative seed: split authoring + user. Research keywords: in-repo-vs-site documentation split, per-adapter doc patterns. Default: A.

**T10.2 Docusaurus ship vs recommend.** Pillar P1, P4. Seed: Ship the Docusaurus site as canonical, ship as opt-in generator, or recommend only? Apparent preference seed: opt-in generator (current shape). Alternative seed: canonical site. Research keywords: docs-as-code site shipping, opt-in vs canonical doc-site patterns. Default: A.

**T10.3 Per-adapter doc generation.** Pillar P1, P3. Seed: Auto-generate per-adapter usage docs from frontmatter, hand-author per adapter, or hybrid (auto-skeleton + hand-author overrides)? Apparent preference seed: hybrid. Alternative seed: auto-generate. Research keywords: auto-doc-generation patterns, frontmatter-driven docs. Default: A.

**T10.4 ADR location.** Pillar P5. Seed: ADRs under `governance/blueprint-v2/decisions/` (v2-only), `docs/adr/` (cross-cutting), or no separate ADR tree (in-line in layer docs)? Apparent preference seed: separate ADR tree under blueprint-v2 for spec phase, `docs/adr/` for post-v2-ship decisions. Alternative seed: in-line. Research keywords: ADR location patterns, dual-tree ADRs. Default: A.

**T10.5 Doc-generation triggers.** Pillar P5, P1. Seed: Doc regen on every CLI release, on every audit-execute SHIP, or on-demand? Apparent preference seed: on every release. Alternative seed: on-demand. Research keywords: doc-regen triggers, release-tied doc generation. Default: A.

### §4.11 L11 — Governance Heart (6 themes)

**T11.1 Audit domain count.** Pillar P5. Seed: Cut from 21 to ~12 audit domains, hold 21, or expand toward 25? Apparent preference seed: cut to ~12. Alternative seed: hold 21. Research keywords: audit-domain count tradeoffs, domain-overlap detection, eval-domain granularity. Default: A.

**T11.2 SA count per domain.** Pillar P5, P7. Seed: Hold 121 SA target, cut to ~70, or model SAs as composable instead of per-domain? Apparent preference seed: cut to ~70. Alternative seed: composable. Research keywords: SA-fan-out cost-vs-coverage, composable SA patterns. Default: A.

**T11.3 Cycle cadence.** Pillar P5. Seed: Continue ad-hoc (current shape), introduce quarterly cycle, or release-tied cycle? Apparent preference seed: release-tied. Alternative seed: quarterly. Research keywords: audit-cycle cadence patterns, release-tied governance check. Default: A.

**T11.4 Closed-loop phase count.** Pillar P5. Seed: Hold 3 phases (CL-1 PRD evolution / CL-2 content gap / CL-3 audit self-evolution), cut to 2, or expand to 4? Apparent preference seed: hold 3. Alternative seed: cut to 2 (merge CL-2 into CL-1 or CL-3). Research keywords: closed-loop phase design, governance feedback-loop patterns. Default: A.

**T11.5 EVOLVE / RE-ENVISION / BLUEPRINT-V2 boundary.** Pillar P5. Seed: Keep three-way split (EVOLVE auto-proposals / RE-ENVISION interactive direct-edit / BLUEPRINT-V2 spec-only), merge EVOLVE into RE-ENVISION, or merge BLUEPRINT-V2 into RE-ENVISION? Apparent preference seed: keep three-way for v2. Alternative seed: merge EVOLVE into RE-ENVISION post-v2. Research keywords: governance-mode separation patterns, self-improving-system roles. Default: A.

**T11.6 Dogfooding mechanism.** Pillar P5. Seed: Require every governance change to pass its own quality gates, only structural changes, or skip dogfooding for spec-only artifacts? Apparent preference seed: every change. Alternative seed: structural only. Research keywords: self-applying governance, dogfooding mechanisms in framework design. Default: A.

### §4.12 L12 — Migration Story (5 themes)

**T12.1 Migration scope.** Pillar P1. Seed: Full migrate (every v1 user runs codemod), opt-in v2 alongside v1, or fresh-only (v2 is new-project-only)? Apparent preference seed: opt-in alongside. Alternative seed: full migrate. Research keywords: major-version migration scope patterns, opt-in-vs-forced migration tradeoffs. Default: A.

**T12.2 Deprecation timeline.** Pillar P1. Seed: v1 support 12 months post-v2-ship, 6 months, or 24 months? Apparent preference seed: 12 months. Alternative seed: 24 months. Research keywords: deprecation-window patterns, support-overlap calibration. Default: A.

**T12.3 Compat shims.** Pillar P1, P4. Seed: Ship compat shims for the 5 most-used v1 commands, ship shims for all 14 v1 commands, or no shims (codemod-only)? Apparent preference seed: top-5 shims. Alternative seed: codemod-only. Research keywords: compat-shim policy, codemod-vs-shim tradeoffs. Default: A.

**T12.4 Side-by-side support.** Pillar P1. Seed: Allow `hatch3r@1` and `hatch3r@2` in the same project, force one or the other, or block side-by-side? Apparent preference seed: allow side-by-side during deprecation window. Alternative seed: force one. Research keywords: side-by-side major-version support, package-manager-namespace tradeoffs. Default: A.

**T12.5 Comms plan.** Pillar P1, P5. Seed: Blog post + CHANGELOG entry, full migration guide site, or in-CLI `hatch3r upgrade` flow with embedded guide? Apparent preference seed: full guide site. Alternative seed: in-CLI flow. Research keywords: major-version comms plan, in-CLI migration guides. Default: A.

### §4.99 Cross-layer sweep (free-text capture)

After T12.5, the orchestrator asks one final question:

> **Question:** Any cross-layer concerns the 12 layers × 5-6 themes did not surface?
>
> 1. None — proceed to §6 layer doc finalization.
> 2. Yes — describe (free text). Orchestrator captures into `workspace/sparring-log.md::cross_layer_concerns:` and routes each as a §5 ADR candidate (skipping the theme template since these are post-matrix).
>
> Default if no response: 1

---

## §5 — Decision Capture (ADR format)

### §5.1 File format

Each accepted decision in §4 writes one ADR to `governance/blueprint-v2/decisions/D-NNN-<kebab-slug>.md`. ID auto-increments from `governance/blueprint-v2/decisions/INDEX.md` (the INDEX is the registry of issued IDs). Slug derives from the theme title (lowercase, kebab, ≤ 50 chars).

### §5.2 ADR frontmatter (YAML, mandatory)

```yaml
---
id: D-NNN
layer: L01..L12
theme: T{layer}.{n} or T-CrossLayer-{seq}
status: accepted | superseded | rejected
decided_on: YYYY-MM-DD
serves_pillars: [Pn, Pn]
---
```

### §5.3 ADR body sections (uniform, all ADRs)

1. **§Context** — current v1 state (cite file_path:line_number references; 3-6 lines).
2. **§Decision** — the single chosen option (verbatim from §4 lettered options, expanded to one paragraph).
3. **§Alternatives Considered** — at least one genuinely different alternative (not just a phrasing variant). For each: one-paragraph description + why-rejected.
4. **§Counter-Argument + Resolution** — one sceptic position the orchestrator surfaced during §4 sparring + how the chosen option addresses it. This is the §4 adversarial-counter mandate operationalized at ADR time.
5. **§Sources** — at least 2 sources per empirical claim, each row: `url · accessed YYYY-MM-DD · author/org · trust_tier (official-docs|peer-reviewed|vendor-note|independent-analysis|blog-post)`. Single-source claims allowed only if `trust_tier=official-docs` AND the claim is platform-specific.
6. **§Pillar Compliance Test (4 questions)** — answered inline:
   - (1) Which pillar(s) does this decision serve? (must be non-empty)
   - (2) What measurable improvement does it produce? (must be quantified)
   - (3) Does it increase v2 artifact count or governance size? If yes, justify net value > size cost.
   - (4) Does it degrade end-user runtime efficiency? If yes, document the offsetting gain.
7. **§Consequences** — three sub-bullets:
   - Positive — direct gains.
   - Negative — costs and risks accepted.
   - Neutral — observable changes that are neither gain nor cost.

### §5.4 INDEX.md format

The decisions INDEX is the source of truth for ADR IDs. Header lines: cycle metadata. Body: one row per ADR with id · layer · theme · status · decided_on · serves_pillars · file path. Auto-generated by the orchestrator after each §5 write; never hand-edited mid-run.

### §5.4.5 ADR supersedence and rejection workflow

ADRs are immutable once written — supersedence is recorded by writing a new ADR with `status: accepted` that names the prior ID, and updating the prior ADR's frontmatter `status: superseded` plus a one-line link to the successor. The orchestrator never deletes an ADR file; the audit trail is the value.

Rejected decisions (where the maintainer chose option 3 at §5.5) also write an ADR with `status: rejected` — the §Decision section is replaced with a `§Rejection Rationale` block citing the rejected option and the binding alternative. Rejected ADRs are emitted because future re-runs of `/h4tcher-blueprint-v2` need the negative space to avoid re-walking the same closed decision.

### §5.4.6 ADR worked example (illustration)

The orchestrator writes ADRs in this shape. The example below is illustrative — replace placeholders with the actual decision content.

```markdown
---
id: D-007
layer: L02
theme: T2.1
status: accepted
decided_on: 2026-05-20
serves_pillars: [P4, P5]
---

# D-007 — Pillar count reduces from 8 to 6

## Context
v1 carries 8 Binding Pillars (P1..P8) per `governance/CONSTITUTION.md:42-128`. Pillar overlap surfaced
in L02 finding F-L02-003 (P7 vs P8 directive overlap) and F-L02-005 (P4 vs P5 scope overlap).

## Decision
Merge P7 (efficiency) and P8 (clarification + fan-out discipline) into a single P7 (orchestration
discipline) carrying B1, B2, and the static-first prompt frame as sub-directives. Merge P4 (lean
coverage) and P5 (governance self-quality) into a single P4 (lean + self-quality) carrying lean
thresholds, anti-bloat principles, and the silent-failure contract.

## Alternatives Considered
1. **Keep 8 pillars** — rejected because overlap inflates the traceability matrix to 8×N rows
   when the underlying axis space is 6.
2. **Reduce to 5 by merging P3 into P2** — rejected because P3 (adapter currency) is a measurable
   axis (recency in months) that P2 (scientific quality) does not natively measure.

## Counter-Argument + Resolution
Sceptic position: merging P7+P8 hides B1's distinct user-facing nature (clarification is UX-visible)
under an efficiency umbrella. Resolution: B1 retains explicit sub-directive status with its own
trigger criteria (ambiguity gate) and is enforced separately by `.claude/rules/clarification-default.md`;
the merger consolidates governance dimensions, not enforcement gates.

## Sources
- url: https://example.org/pillar-overlap-research · accessed 2026-05-19 · author: Example Lab · trust_tier: peer-reviewed
- url: https://owasp.org/asi · accessed 2026-05-19 · author: OWASP · trust_tier: official-docs

## Pillar Compliance Test
1. Serves: P4 (lean), P5 (self-quality).
2. Measurable improvement: traceability matrix shrinks from 8×N to 6×N rows; pillar-overlap audit
   findings drop from 5 (cycle 9) to 0 expected.
3. Size impact: −15 lines in `CONSTITUTION.md` §2; −30 lines in §3 matrix. Net negative.
4. End-user runtime efficiency: no change (pillar count is governance-internal).

## Consequences
- Positive: shorter traceability matrix; clearer enforcement boundaries.
- Negative: rebuild agents reading prior governance must consult D-007 to map P7-v1 → P7-v2 + P8-v1 → P7-v2.
- Neutral: pillar IDs reflow (v1 P8 becomes v2 P7 sub-directive B1).
```

### §5.5 ADR-commit hard-stop

After drafting each ADR, the orchestrator asks one question:

> **Question:** Commit ADR `D-NNN-<slug>.md` as drafted?
>
> 1. Commit as drafted.
> 2. Revise — list which section + change.
> 3. Reject — record rejection rationale in `workspace/sparring-log.md`; do not write the ADR.
>
> Default if no response: 1

Hard-stop per ADR. The orchestrator waits before moving to the next theme.

---

## §6 — Layer Doc Template

After §4 sparring + §5 ADR capture completes for all layers, the orchestrator dispatches 12 parallel layer-doc-writer SAs (one per layer). Each writes one `governance/blueprint-v2/L{N}-<slug>.md` file.

### §6.1 Layer doc frontmatter (YAML, mandatory)

```yaml
---
layer_id: L01..L12
lean_target_lines: <integer; v2 file ≤ this>
serves_pillars: [Pn, Pn]
decision_refs: [D-NNN, D-NNN, ...]
artifact_count_target: <integer or range; v2 count target this layer owns>
---
```

### §6.2 Layer doc body sections

1. **§Identity** — one paragraph: what this layer IS in v2, what it OWNS, what it DOES NOT own (boundary against neighboring layers).
2. **§Decisions** — bullet list of `D-NNN` ADR IDs with one-line summary each. The body of each decision lives in the ADR; the layer doc only points.
3. **§Implementation Contract** — what a rebuild agent must produce to satisfy this layer:
   - File list (paths + per-file purpose)
   - Frontmatter shape required on each file (cite the canonical frontmatter spec from §6.4 or restate locally)
   - Behaviors a rebuild agent must implement (one paragraph per behavior, with measurable acceptance criteria)
4. **§Lean Target** — line count target, artifact count target, complexity ceiling (cyclomatic / nesting depth limits if relevant), and a one-line justification tying the target to a Pillar Compliance Test answer.
5. **§Open Questions** — deferred decisions (theme answered "skip" or "later" during §4). Each question gets a one-line description and a pointer to the next reconsider-by date.

### §6.3 Pillar Compliance Test footer (mandatory)

Each layer doc closes with the 4-question Pillar Compliance Test from §5.3 step 6, answered for the layer as a whole (not per-decision; per-decision answers live in ADRs).

### §6.3.5 Worked layer-doc skeleton (illustration)

The doc-writer SAs produce layer docs in this shape. The example below is illustrative — replace placeholders with the actual L02 (pillar-set) decisions.

```markdown
---
layer_id: L02
lean_target_lines: 180
serves_pillars: [P4, P5]
decision_refs: [D-007, D-011, D-014]
artifact_count_target: 6
---

# L02 — Pillar Set

## Identity
This layer owns the v2 pillar set: count, names, definitions, sub-directive shape. It owns
governance/CONSTITUTION.md §2 (v2 file path TBD per L11). It does NOT own the traceability matrix
(owned by L11) or per-rule enforcement (owned by the rule corpus, L06).

## Decisions
- D-007 — Pillar count reduces from 8 to 6 (merge P7+P8 and P4+P5).
- D-011 — P3 (adapter currency) retained as a top-level pillar.
- D-014 — P6 (security & trust) retained broad; no split into security pillar + trust pillar.

## Implementation Contract
The rebuild agent team produces these files for L02:
- `governance/v2/CONSTITUTION.md` §2 — the 6 pillars with frontmatter shape:
  - Each pillar block carries: pillar_id (P1..P6), name, one-paragraph definition, measurement metric,
    primary-owner file reference, sub-directives if any.
  - B1 (ambiguity gate) and B2 (fan-out discipline) live as sub-directives under the new P7
    (orchestration discipline) per D-007.
- Behaviors a rebuild agent must produce:
  - Every artifact in v2 cites at least one pillar (P1..P6) in its frontmatter.
  - The traceability matrix (L11 owns) carries one row per pillar × one column per governance file.
  - Anti-slop enforcement (L06 owns the rule file) cites P4 (lean + self-quality) verbatim.

## Lean Target
180 lines for the pillar section; 6 pillars × ~25 lines each + 30 lines of overhead. Complexity
ceiling: no nested sub-directives beyond two levels (B1, B2 are leaf-level under P7).

## Open Questions
- O-L02-001: should P6 (security & trust) gain a third sub-directive for supply-chain provenance,
  or does that fold into existing sub-directives? Reconsider by v2.1.

## Pillar Compliance Test
1. Serves P4 (lean), P5 (self-quality).
2. Pillar-overlap audit findings drop from 5 (cycle 9) to 0 expected.
3. Size: −60 lines net in CONSTITUTION §2.
4. End-user runtime: no change.
```

### §6.4 Cross-layer consistency contract

If a decision in this layer references another layer (e.g., L02 pillar set decision cited by L11 governance-heart layer), both layer docs reference the same ADR ID. Conflicting layer doc statements about the same ADR are a §8 quality-gate failure and block §7 master-doc assembly.

---

## §7 — Master Doc Template (the v2 OUTPUT, not THIS file)

After §6 emits all 12 layer docs, the orchestrator dispatches one master-assembler SA. That SA writes `governance/BLUEPRINT-V2.md` (the spec the rebuild team consumes — distinct from THIS prompt file, which is the spec generator). The master doc carries the items below.

### §7.1 Master doc structure

1. **§North Star** — one sentence. The mission v2 serves. Locked from L01 sparring outcome.
2. **§Pillar Set** — final pillar count (from §4.2 T2.1), pillar names, one-line definition each. If pillar count changed from v1, the diff (added / removed / merged) is called out in a side note.
3. **§Layer Index** — table:

```
| L | Layer | Lean target lines | ADR count | Pillar refs | File |
| L01 | Identity | <integer> | <integer> | <Pn,...> | L01-identity.md |
| ... | ... | ... | ... | ... | ... |
```

4. **§ADR INDEX cross-link** — pointer to `governance/blueprint-v2/decisions/INDEX.md` with summary counts (total ADRs · accepted · superseded · rejected).
5. **§Total Artifact-Count Target** — v2 total target (sum of per-layer artifact targets), compared against v1's ~115 content artifacts + 18 pipeline + 14 CLI baseline. Net delta (planned cut or growth) cited with the dominant lean-opportunity entries from `workspace/lean-opportunities.md`.
6. **§Lifecycle Phases** — the v2 lifecycle outline (init → develop → audit → release → migrate). One paragraph per phase, with the CLI commands and content classes that touch each phase.
7. **§Rebuild Kickoff Checklist** — Day-1 instructions for the rebuild agent team:
   - Read `governance/BLUEPRINT-V2.md` (master) + all L01..L12 layer docs in order.
   - Read all `D-NNN-*.md` ADRs flagged `status: accepted` in INDEX.md.
   - Establish the v2 directory shape per L06's implementation contract.
   - Implement the v2 CLI command set per L07's implementation contract.
   - Implement the v2 pipeline runtime per L09's implementation contract.
   - Implement the v2 adapter set per L03's implementation contract.
   - Implement the v2 content corpus per L06's implementation contract.
   - Implement the v2 governance heart per L11's implementation contract (the v2 versions of AUDIT, AUDIT-EXECUTE, EVOLVE, RE-ENVISION).
   - Run the v2 versions of validate / inventory / rule-parity gates per L11's implementation contract.
   - Cut a v2.0.0-rc release; run the v2 audit cycle against itself before shipping.
8. **§Open Items** — aggregated `§Open Questions` rows from all 12 layer docs. Each gets a planned-by date or a "defer to v2.1" tag.

### §7.2 Master doc frontmatter

```yaml
---
id: blueprint-v2-master
version: 2.0.0-spec
spec_date: YYYY-MM-DD
pillar_count: <integer from T2.1>
layer_count: 12
adr_count: <integer from INDEX.md>
total_artifact_target: <integer>
sources_at_master_assembly: see decisions/INDEX.md
---
```

---

## §8 — Quality Gates

The orchestrator runs these gates inline at SKILL.md Step 8 — after §6 layer doc emit, before §7 master doc emit. Any failure HALTS the run and surfaces the violation to the maintainer.

### §8.1 Rigor-schema lint

For every `D-NNN-*.md` ADR: confirm the 7 fields are present (confidence, confidence_basis, falsifiability, causal_chain ≥ 3 steps, bias_check, counter_argument, sources). Confirm `sources` has ≥ 2 rows OR a single `official-docs` row for platform-specific claims. Missing field → ADR rejected, the layer doc that references it is rolled back, the responsible layer SA re-runs.

### §8.2 Per-file lean threshold (`wc -l` vs declared target)

For every layer doc and the master doc: run `wc -l` against the `lean_target_lines` declared in frontmatter. Overage → rollback that doc, the responsible doc-writer SA compresses and re-emits. Underage is acceptable (no minimum).

### §8.3 Anti-slop wordlist scan

For every written file (ADR, layer doc, master doc): grep for the wordlist below. Each hit must have a measurable qualifier within 8 words of the hit; un-qualified hits are violations.

Wordlist source: `.claude/rules/anti-slop-enforcement.md` (canonical). The orchestrator loads the wordlist from that file at scan time; this prompt does not restate the literal phrases (restating them inside a grep-able prompt is a self-defeating gate, since this prompt would then fail its own check). The wordlist covers four families:

1. Superlatives without measurable target — generic excellence claims without a quantified benchmark, percentile target, or comparative baseline.
2. Coverage claims without scope — claims of being all-encompassing without a named axis count (e.g., "covers all 15 adapters" is acceptable; the wordless version is not).
3. Pattern names without instantiation — resilience or quality references without a named pattern (circuit-breaker with N-failure threshold and S-second cooldown is acceptable; the wordless version is not).
4. Filler verbs and disclaimers — verbs that imply rigor without method (assurance verbs, qualitative adverbs) and meta-sentences that announce instead of stating.

Hits without qualifier → file rolled back, doc-writer SA re-emits with replacements.

### §8.4 Pillar-coverage matrix

Build a matrix: rows = 12 layers + N ADRs; columns = P1..Pn (v2 pillar set from T2.1). Each row must mark ≥ 1 pillar column. Each pillar column must be marked by ≥ 1 row (no pillar can be a label without a real owner). Unmarked rows → layer/ADR rolled back. Pillar columns with no owners → flag to the maintainer for pillar-removal candidate or owner-assignment.

### §8.5 Cross-layer consistency check

For every ADR ID referenced by ≥ 2 layer docs: confirm the references agree (same status, same direction). Conflicting references → both layer docs rolled back, doc-writer SAs re-emit after orchestrator reconciles via §4.99 cross-layer entry.

### §8.6 Model-independence scan

Grep every written file for the forbidden patterns in §0 (the 7 pattern classes referenced from EVOLVE.md §0). Hits → file rolled back, doc-writer SA replaces with capability-abstract phrasing per EVOLVE.md §0's acceptable-replacement column.

### §8.6.5 Rollback procedures (per gate)

Each gate failure triggers a rollback, not a halt-then-continue. The rollback procedure differs per gate:

- **§8.1 rigor-schema lint failure** — the failing ADR is deleted from `governance/blueprint-v2/decisions/`, its INDEX.md row removed, the layer doc references to it removed. The layer SA that produced the source finding is re-dispatched with the rejection reason; on re-emit, the §5 ADR-commit hard-stop runs again.
- **§8.2 lean-threshold overage** — the failing layer doc is rolled back via `git checkout HEAD -- governance/blueprint-v2/L{N}-*.md`. The doc-writer SA receives the overage delta and a directive to compress; common compression patterns: collapse §Implementation Contract sub-bullets, reference shared frontmatter from a sibling layer, defer §Open Questions to a separate `Lxx-deferred.md` file. The §6 doc-writer SA re-runs once.
- **§8.3 anti-slop hits** — the orchestrator surfaces each hit with line number, the doc-writer SA replaces with measurable qualifier. Re-emission must clear the hit before the file is re-admitted; otherwise the SA spawns a fresh research probe to derive the measurable qualifier from primary sources.
- **§8.4 pillar-coverage gap** — unassigned pillar columns surface to the maintainer via the platform-native question tool: "Pillar Pn has no layer or ADR owner. Options: (a) drop Pn from the v2 pillar set, (b) assign Pn to L{X}, (c) draft a new ADR establishing Pn ownership." Default: (a).
- **§8.5 cross-layer conflict** — both conflicting layer docs roll back. Orchestrator opens the §4.99 cross-layer block, walks one sparring theme to reconcile the conflict, emits a reconciliation ADR (`status: accepted`, layer: `cross-layer`), then both layer docs re-emit referencing the new ADR.
- **§8.6 model-independence hit** — the file is rolled back, the doc-writer SA reads `governance/EVOLVE.md` §0 acceptable-replacement column, re-emits with capability-abstract phrasing.

### §8.7 Gate summary emission

After all gates pass: orchestrator writes `workspace/gates.json` with per-gate verdict, per-file verdict, and a single pass/fail rollup. Master doc emit proceeds only on rollup=pass.

---

## §9 — Output Expectations + Resume + Handoff

### §9.1 What "done" looks like

When the skill exits cleanly, the following artifacts exist:

- `governance/BLUEPRINT-V2.md` — master spec (this file is the prompt; the master is a different file with the same name written by the run). The master doc carries the §7 structure.
- `governance/blueprint-v2/L01-<slug>.md` through `L12-<slug>.md` — 12 layer docs.
- `governance/blueprint-v2/decisions/D-NNN-<slug>.md` — one ADR per accepted §4 decision.
- `governance/blueprint-v2/decisions/INDEX.md` — populated registry.
- `governance/blueprint-v2/workspace/preflight.json` — mode + start time + by-analogy decisions.
- `governance/blueprint-v2/workspace/L01-findings.md` through `L12-findings.md` — SA outputs (retained for traceability; not consumed by rebuild agents).
- `governance/blueprint-v2/workspace/synthesis.md` — §3 triage output.
- `governance/blueprint-v2/workspace/sparring-log.md` — chronological dialog transcript.
- `governance/blueprint-v2/workspace/gates.json` — §8 verdicts.
- `governance/blueprint-v2/workspace/lean-opportunities.md` — register from §3.3.

The orchestrator does NOT commit, push, or merge. The maintainer reviews `git diff --name-only` and commits when satisfied. Conventional Commits + DCO sign-off apply per `.claude/rules/commit-conventions.md`.

### §9.2 Resume protocol

On invocation with `mode=resume`:

1. Read `workspace/preflight.json` and `workspace/sparring-log.md`.
2. Recompute layer-completion-map: for each L01..L12, mark `complete` if its findings file, sparring entries for all 5-6 themes, and at least one ADR per accepted decision exist.
3. Jump to the next pending decision — either an unwalked §4 theme or a pending §5 ADR-commit gate.
4. Do not re-ask answered questions. The default-if-no-response history in `sparring-log.md` is treated as binding.
5. If the workspace is partial (some layers complete, some not), resume by re-dispatching ONLY the pending layer SAs; do not re-run completed layers.

### §9.3 Handoff to rebuild execution

The skill writes a `workspace/handoff.md` block at exit. The block contains:

- `next_action: rebuild-v2` — signals the rebuild orchestrator (separate skill, not implemented in this prompt) what to consume.
- `entry_point: governance/BLUEPRINT-V2.md` — master doc path.
- `adr_index: governance/blueprint-v2/decisions/INDEX.md` — full ADR registry.
- `pillar_set: <list>` — v2 pillar names + count.
- `total_artifact_target: <integer>` — v2 artifact-count target.
- `kickoff_checklist_ref: §7.1 item 7` — Day-1 checklist anchor.

The rebuild agent team's first action: open `governance/BLUEPRINT-V2.md`, read the master, read all 12 layer docs in L01..L12 order, then read the ADR INDEX. They do NOT re-derive decisions — every fork is captured in the ADR set.

### §9.3.5 Resume edge cases

The resume protocol handles three edge cases that arise from partial runs:

1. **Partial findings file** — if a layer SA wrote `workspace/L{N}-findings.md` but the file fails §1.5 admission, the resume re-dispatches that layer SA from scratch. The partial file is moved to `workspace/L{N}-findings.partial.md` for traceability.
2. **Sparring mid-theme** — if `workspace/sparring-log.md` shows a theme with the question asked but no maintainer response, the resume re-asks the same question (the platform-native question tool's default-if-no-response triggers if the maintainer is genuinely absent). The orchestrator never auto-picks a default mid-resume — only the platform tool's timeout authority applies.
3. **ADR draft not committed** — if a `D-NNN-*.md` ADR exists but INDEX.md has no row for it, the resume treats the ADR as a draft and re-asks §5.5 ADR-commit hard-stop. The maintainer either confirms commit (adds INDEX row) or rejects (removes the draft ADR file).

### §9.3.6 Failure modes (orchestrator surfaces, not auto-corrects)

These failure modes halt the run and surface to the maintainer rather than auto-correcting:

- All 12 layer SAs report 0 findings — likely a prompt or scoping bug; orchestrator halts and asks the maintainer to switch to `mode=targeted-layer:L01` to debug.
- §3 synthesis dedup collapses ≥ 50% of admitted findings — likely an over-aggressive 2-of-3 match threshold; orchestrator halts and asks the maintainer to relax to 3-of-3 or accept the collapse.
- §4 sparring stalls (no maintainer response across 3 themes) — orchestrator halts and writes `workspace/stalled.md` with the pending theme list; resume mode re-enters at the first stalled theme.
- §8 gate failures recur on the same file across 3 re-emit cycles — the doc-writer SA is replaced and re-dispatched with the prior emit attached as a negative example.

### §9.3.7 Run-isolation guarantees

The skill never mutates files outside `governance/blueprint-v2/`. The orchestrator's write set is bound to:

- `governance/BLUEPRINT-V2.md` (the master output, distinct from THIS prompt file).
- `governance/blueprint-v2/L{N}-*.md` (12 layer docs).
- `governance/blueprint-v2/decisions/D-NNN-*.md` (per-decision ADRs).
- `governance/blueprint-v2/decisions/INDEX.md` (ADR registry).
- `governance/blueprint-v2/workspace/*` (ephemeral state — preflight, findings, synthesis, sparring-log, gates, handoff, rejected entries).

Files outside that set are read-only inputs. `git diff --name-only` after a clean exit shows only files under the bound set; any other path in the diff is a self-detectable run-isolation violation that halts the next-turn orchestrator.

### §9.4 Metadata block (closing line of the prompt)

> Generated by `/h4tcher-blueprint-v2` from `governance/BLUEPRINT-V2.md`. The skill drives the dialog; this prompt drives the skill. The rebuild agent team consumes the outputs in `governance/blueprint-v2/`. RE-ENVISION, EVOLVE, AUDIT, and AUDIT-EXECUTE remain unmodified by this run — v1 governance is read-only until v2 ships.

---

> End of prompt. Executing agent: stop here. The workspace artifacts are written. The master doc is emitted. The maintainer reviews `git diff`. No downstream prompt invocation. No commits. No pushes. No merges.
