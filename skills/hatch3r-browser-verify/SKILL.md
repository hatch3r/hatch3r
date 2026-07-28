---
id: hatch3r-browser-verify
name: hatch3r-browser-verify
type: skill
description: Opt-in browser verification skill — spec-run-first Playwright verification (assertions execute in the runner, agent reads only failures), axe-core a11y audits, toHaveScreenshot() regression diffs, E2E test scaffolds, and snapshot-mode exploratory driving. Default ON for UI-affecting agent invocations; disable globally via hatch3r config browser=off.
tags: [browser, playwright, accessibility, visual-regression, floor:content-quality]
pillars:
  governance: [P2, P7]
  content-quality: [CQ1, CQ2, CQ7]
quality_charter: agents/shared/quality-charter.md
efficiency_patterns: agents/shared/efficiency-patterns.md
efficiency_tier: standard
cache_friendly: true
parallel_tool_default: true
opt_in: true
default_on_for: [hatch3r-ui, hatch3r-ux]
disable_via: hatch3r config browser=off
---

# Skill: hatch3r-browser-verify

> Last updated: 2026-07-28

## Quick Start

Invoke this skill whenever a UI-affecting change reaches a verification gate. The operating model is **spec-run-first**: write assertions once as durable Playwright specs, run them headless, and read only failures — never eyeball per-route screenshots. This converts verification cost from O(routes × screenshots) to O(failures), and specs re-run per review iteration at near-zero token cost.

Two tiers plus four capabilities:

- **Tier 1 (default):** scripted spec execution — functional assertions (Step 2), axe-core a11y gate (Step 3), `toHaveScreenshot()` regression diffs (Step 4), E2E scaffolds (Step 5).
- **Tier 2 (exception):** token-efficient step driving via `playwright-cli` or Playwright MCP snapshot mode, only when no spec exists yet or a failure is not understood (see "Tier 2 — Exploratory Driving").

```
Task Progress:
- [ ] Step 0: Detect ambiguity (P8 B1)
- [ ] Step 1: Install Playwright + axe-core (if not present)
- [ ] Step 2: Spec-run verification of UI changes (Tier 1 default)
- [ ] Step 3: Accessibility audit via axe-core + Playwright
- [ ] Step 4: Regression screenshot diffs (diff counts, not image review)
- [ ] Step 5: E2E test authoring scaffold
```

## Step 0 — Detect Ambiguity (P8 B1)

Before any browser action, scan the invocation for unresolved questions per `agents/shared/user-question-protocol.md`. Triggers: which build artifact to verify against (dev server vs `npm run build` output vs deployed preview URL), which routes are in scope, headed vs headless, whether to install browser binaries when missing, and which baseline branch supplies the screenshot reference set. Ask one multiple-choice question per turn; declare the default-if-no-response.

## Fan-out Discipline (P8 B2)

Fan-out scales with task size; token cost never justifies serializing independent work (`rules/hatch3r-fan-out-discipline.md` P8 B2; `agents/shared/efficiency-patterns.md`). Emit `sub_agents_spawned: { count, rationale, task_structure }` in your output.

## Invoked by

This skill is the verification HARNESS for the browser sub-vector of CQ1 — it declares HOW spec-run, a11y, regression, and E2E checks run against a built artifact. The DISPATCHERS that decide WHEN to run it:

- `agents/hatch3r-ui.md` / `agents/hatch3r-ux.md` — CQ1/CQ2 specialist gates (frontmatter `default_on_for: [hatch3r-ui, hatch3r-ux]`). The agent contributes the review trigger; this skill contributes the procedure.
- `agents/hatch3r-implementer.md` §5b — UI-affecting implementation verification before the structured result; the implementer's browser-verification token comes from this skill's Output contract.
- `agents/hatch3r-fixer.md` — re-verify after a UI fix inside the review loop: re-run the SAME spec (Tier 1 re-run), no re-driving.
- `skills/hatch3r-qa-path/SKILL.md` Step 3.5 — per-row proving of UI rows in the human-QA table; a row is proven only by this skill's `VERIFIED-SPEC` / `VERIFIED-INTERACTIVE` token plus `proof_trace`.
- `agents/hatch3r-reviewer.md` — the ui-ux review surface grounds its browser claims in this skill's captured runner output rather than re-driving the browser.

Kept standalone (not merged into `hatch3r-ui-ux-verify`): Playwright is also a general workflow tool, not exclusively a CQ1 gate. No duplication: the dispatcher decides WHEN, this skill defines HOW. Invocation contract and result tokens: `rules/hatch3r-browser-verification.md` → Invocation Contract.

## Sub-agent Isolation

Run this skill inside a spawned verification sub-agent (the specialist-agent dispatch or a Task-tool spawn) — not in the orchestrator turn. Accessibility snapshots, console logs, and runner output stay in the verification sub-agent's context window; the orchestrator receives ONLY the structured Output contract below (gate status, result token, failure excerpts, artifact paths). Returning raw browser output — snapshots, screenshots, full reporter dumps — to the orchestrator forfeits the isolation and repays the token cost this design removes.

## Step 1: Install Playwright (if not present)

Detection first — skip install if `@playwright/test` is already in `devDependencies` of `package.json`:

```
jq -r '.devDependencies["@playwright/test"], .devDependencies["@axe-core/playwright"]' package.json
```

If either returns `null`, ask the user before installing (binaries are large; user machine state changes). On confirmation, pin to the tested-against versions (see Configuration "Tested-against versions" row) so verification outcomes and the bundled Chromium CVE surface stay reproducible across machines:

```
npm install -D @playwright/test@~1.60.0 @axe-core/playwright@~4.11.3
npx playwright install chromium
```

The `~` pin floats patch releases within the tested minor line but blocks an uncontrolled minor bump that would swap the bundled Chromium build (and its CVE exposure) out from under the verification gate. Bump the pin deliberately when upstream Playwright ships a Chromium roll that closes a tracked advisory — see "Known Issues — Browser CVE Awareness".

Use Chromium-only by default — adds ~280MB. Add `firefox` and `webkit` only when the project's browser-support matrix demands them. Record the installed Playwright version AND the bundled Chromium revision (`npx playwright --version` plus `cat node_modules/playwright-core/browsers.json | jq '.browsers[] | select(.name=="chromium")'`) in the verification output for traceability. See "Known Issues — Browser CVE Awareness" below before targeting untrusted or third-party content; the bundled Chromium is intentionally not a security boundary per upstream maintainer guidance.

For Tier 2 driving on hosts with skills support, additionally: `npx playwright-cli install --skills` (auto-discovered on Claude Code and GitHub Copilot; ~68-token skill description vs ~3.6k-token MCP schema per Better Stack's controlled measurement — see References).

## Step 2: Spec-run verification of UI changes (Tier 1 — default)

Run against the built artifact (not the dev server) so the verification matches the release surface. Production builds catch tree-shaking regressions, CSS purge mistakes, and asset-pipeline drift that dev servers hide.

```
npm run build
npm run preview &     # or `npx serve dist` for static builds
PREVIEW_PID=$!
```

Verification is a spec run, not a screenshot review. Write (or reuse) a spec asserting the changed behavior with web-first locators; express visual checks as `toHaveScreenshot()` assertions (Step 4) so pixel comparison happens inside the runner:

```typescript
// tests/visual/<feature>.spec.ts
import { test, expect } from '@playwright/test';

test('settings page shows the new export control', async ({ page }) => {
  await page.goto('http://localhost:4173/settings');
  // web-first readiness — networkidle is discouraged by Playwright; wait on the
  // `main` landmark the a11y gate already requires (swap for a route-specific locator)
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export data' })).toBeEnabled();
  await expect(page).toHaveScreenshot('settings-export.png');   // viewport-scoped, not fullPage
});
```

Run headless and read the minimum:

```
npx playwright test tests/visual --reporter=line
```

- **On pass:** read the one-line summary (`N passed`) — nothing else enters context.
- **On fail:** read only the failure excerpt (error + locator + diff count). Open a diff image ONLY when `diffs_above_threshold > 0`, only the failing image, viewport-scoped — never `fullPage` captures for reading.
- **Record-keeping:** baseline and diff images live on disk under `tests/__screenshots__/`; the Output contract carries their paths so reviewers open them. The agent does not read passing images. Per-route capture loops "for the record" are removed from this skill — the committed `toHaveScreenshot()` baselines ARE the visual record.

After the run: `kill $PREVIEW_PID`.

## Step 3: Accessibility audit via axe-core + Playwright

Gate: 0 serious + 0 critical violations per route per `rules/hatch3r-accessibility-standards.md`. Moderate violations are recorded but do not fail the gate — they feed the next CQ1 audit cycle.

```typescript
// tests/a11y/audit.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = ['/', '/dashboard', '/settings', '/onboarding'];

for (const route of routes) {
  test(`a11y ${route}`, async ({ page }) => {
    await page.goto(`http://localhost:4173${route}`);
    // web-first readiness — networkidle is discouraged by Playwright; wait on the
    // `main` landmark the a11y gate already requires (swap for a route-specific locator)
    await expect(page.getByRole('main')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
```

Run: `npx playwright test tests/a11y --reporter=json > .audit-workspace/a11y-results.json`.

Per-cycle reminder: axe-core automated checks cover roughly 57% of WCAG issues by volume (Deque Systems). The remaining ~43% require a keyboard trace (`hatch3r-ui` Step) plus one human screen-reader pass per release per `agents/shared/quality-charter.md` §UI/UX quality verification gate.

## Step 4: Regression screenshot diffs

Use `toHaveScreenshot()` for pixel-diff comparison against a baseline. First run produces baselines under `tests/__screenshots__/`; subsequent runs compare. The agent reads the diff COUNT from runner output — it opens a diff image only for failing assertions, viewport-scoped.

```typescript
// tests/visual/regression.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard regression', async ({ page }) => {
  await page.goto('http://localhost:4173/dashboard');
  // web-first readiness — networkidle is discouraged by Playwright
  await expect(page.getByRole('main')).toBeVisible();

  await expect(page).toHaveScreenshot('dashboard.png', {
    maxDiffPixelRatio: 0.01,    // 1% pixel tolerance for sub-pixel font rendering
    threshold: 0.2,             // YIQ color delta tolerance
    mask: [
      page.locator('[data-testid="timestamp"]'),
      page.locator('[data-testid="user-avatar"]'),
    ],                          // mask non-deterministic regions
    animations: 'disabled',     // disable CSS animations during capture
  });
});
```

Update baselines deliberately after intentional UI changes:

```
npx playwright test tests/visual --update-snapshots
git add tests/__screenshots__/
```

Commit the baseline diff in the same PR as the UI change so reviewers can verify the visual delta is intentional.

## Step 5: E2E test authoring scaffold

When a new feature ships, emit a starter spec at `tests/e2e/<feature>.spec.ts`. The scaffold covers happy path + one error path + one keyboard-only path — the minimum surface to gate the CQ2 error-recovery + first-run-success metrics.

```typescript
// tests/e2e/<feature>.spec.ts
import { test, expect } from '@playwright/test';

test.describe('<feature>', () => {
  test('happy path produces expected outcome', async ({ page }) => {
    await page.goto('/<feature-entry>');
    // arrange: seed required state
    // act: drive the user flow
    // assert: outcome visible to user + URL or DOM state matches spec
  });

  test('error recovery shows actionable next step', async ({ page }) => {
    await page.goto('/<feature-entry>');
    // force the error path (network failure, validation rejection)
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: /retry|try again/i })).toBeVisible();
  });

  test('keyboard-only completes the flow', async ({ page }) => {
    await page.goto('/<feature-entry>');
    await page.keyboard.press('Tab');           // first interactive element
    // ...drive through Tab + Enter only; assert outcome
  });
});
```

Cross-reference the scaffold in the PR description and link it to the feature ticket so the maintainer can flesh it out before merge.

## Tier 2 — Exploratory Driving (no spec yet)

Conditions (any one, else stay on Tier 1): no spec can express the check; the failure is not yet understood; plan-time discovery of an unfamiliar surface.

- **Hosts with skills support (Claude Code, GitHub Copilot):** drive via `playwright-cli` (`npx playwright-cli install --skills`, auto-discovered). The CLI writes accessibility snapshots to YAML files with element refs (e.g. `e15`), so page state stays on disk until selectively read.
- **Other hosts:** Playwright MCP (`@playwright/mcp`) in its default snapshot (accessibility-tree) mode. Never `--caps=vision`; never `browser_take_screenshot` for state-reading — an accessibility snapshot is structured text at a fraction of a screenshot's token cost.
- **Convert before closing:** turn what the driving revealed into a durable spec so the next verification is a Tier 1 re-run. Where the host supports Playwright Test Agents, `npx playwright init-agents --loop=claude|vscode|codex|opencode` scaffolds the planner → generator → healer loop that does exactly this conversion; the healer replays a failing spec, inspects the UI change, and patches locators/waits.
- **Screenshots (exception path):** only for inherently-visual properties (layout, theming, design-token fidelity) that neither a `toHaveScreenshot()` diff nor a computed-style/ARIA assertion can express. Viewport-scoped, one screenshot per decision.

## Per-adapter dispatch

| Host | Tier 1 (default) | Tier 2 driving | Notes |
|------|------------------|----------------|-------|
| Claude Code | spec run: `npx playwright test <spec> --reporter=line` | `playwright-cli` skills (`playwright-cli install --skills`, auto-discovered) | Chrome extension (`claude --chrome`) only for authenticated or manual-adjacent flows — always-on browser tools inflate context per the official docs |
| Cursor | spec run (same command) | built-in browser tool (pre-installed, zero setup) — read console/DOM state, avoid screenshots | no skills primitive; `playwright-cli` self-discloses via `--help` when installed |
| GitHub Copilot | spec run in the agent/CI environment | pre-configured Playwright MCP in snapshot mode | coding agent ships Playwright MCP enabled by default (localhost-only); its defaults are screenshot-forward — do not screenshot unless the check is visual |

## Configuration

| Setting | Default | Override |
|---------|---------|----------|
| Browser verification globally | enabled | `hatch3r config browser=off` (writes `.hatch3r/hatch.json` schemaVersion 3; re-enable with `browser=on`) |
| Default ON for agent | `hatch3r-ui`, `hatch3r-ux` (frontmatter `browser_capability: opt-in`) | per-invocation `--no-browser` |
| Browser binary scope | Chromium only | `npx playwright install firefox webkit` |
| Build artifact source | `npm run build` + `npm run preview` | `--target-url=<url>` for deployed preview |
| Screenshot baseline | branch `main` | `--baseline=<ref>` |
| Pixel-diff tolerance | `maxDiffPixelRatio: 0.01`, `threshold: 0.2` | per-test override in spec |
| Tier 2 driver | `playwright-cli` where the host supports skills; else `@playwright/mcp` snapshot mode | per the Per-adapter dispatch table |
| `minBrowserVersion` advisory | Chromium ≥145.0.7632.75 (CVE-2026-2441 fix floor; bundled with Playwright ≥1.59.0) | bump when upstream Chrome stable channel ships a new high-severity advisory; verify via `npx playwright --version` + `node_modules/playwright-core/browsers.json` |
| Tested-against versions | `@playwright/test@~1.60.0` (bundled Chromium 148.0.7778.96) + `@axe-core/playwright@~4.11.3` — cycle 10, verified 2026-05-27 | re-pin on the next D21 cycle when upstream releases a Playwright minor that rolls Chromium past a tracked advisory |
| Trust posture for `target_url` | first-party content only | use `channel: "chrome"` (or `channel: "chromium-tip-of-tree"`) when the verified UI loads third-party scripts/iframes — see "Known Issues — Browser CVE Awareness" |

## Output contract

Return structured result with proof_trace per state-dependent claim:

```yaml
skill: hatch3r-browser-verify
run_id: <uuid>
playwright_version: <semver>
target_url: <http://localhost:4173 | deployed-preview-url>
tier_used: 1 | 2
result_token: VERIFIED-SPEC | VERIFIED-INTERACTIVE | BLOCKED_MISSING_TOOL | N/A-NO-UI
sub_agents_spawned:
  count: <int>
  rationale: <one-sentence justification>
  task_structure: parallelizable | sequential | mixed
capabilities_executed: [spec-run, a11y, regression, e2e-scaffold, exploratory]
results:
  spec_run:
    command: npx playwright test <spec> --reporter=line
    exit_code: <int>
    tests_passed: <int>
    tests_failed: <int>
    failure_excerpts: <inline, <=20 lines total, failing tests only>
  a11y:
    routes_audited: <int>
    serious_critical_violations: <int>
    proof_trace: .audit-workspace/a11y-results.json
    gate_status: PASS | FAIL
  regression:
    snapshots_compared: <int>
    diffs_above_threshold: <int>
    diff_images_opened: <int>     # must be <= diffs_above_threshold; 0 on a clean run
    diff_artifacts: tests/__screenshots__/**/diff.png
  e2e_scaffold:
    file_path: tests/e2e/<feature>.spec.ts
    test_count: 3
verification:
  build_artifact_used: <bool>     # true = npm run build output; false = dev server
  baseline_branch: <ref>
  binaries_installed_this_run: <bool>
```

Every state-dependent claim (violation count, diff count, artifact path) carries a `proof_trace` pointer to the artifact on disk so reviewers can re-open it. The `result_token` values are the non-launderable set from `rules/hatch3r-browser-verification.md` → Invocation Contract: a missing runner or driver is `BLOCKED_MISSING_TOOL` (name the tool + install command), never a silent skip.

## Known Issues — Browser CVE Awareness

The Chromium binary bundled with `npx playwright install chromium` rolls on Playwright's release cadence (roughly every 4–6 weeks), not Chrome's stable channel cadence (typically weekly for security patches). This means there is a window after each Chrome stable advisory during which `npx playwright install chromium` ships a Chromium build that lacks the latest fixes.

Upstream maintainer position (microsoft/playwright issue #39574, closed 2026-04-03 by maintainer): "We assume that the browsers downloaded with Playwright are used for first-party content and are not serving a security boundary. Once you target untrusted content, you should secure your system with a VM, even if Chrome you are using does not suffer from any CVEs."

What this means for verification runs:

- **First-party content (your own built artifact, no third-party iframes/scripts):** bundled Chromium is the supported path; verify the installed version against the Chromium roll line in the Playwright release notes for your installed Playwright version.
- **Third-party content (CMS embeds, analytics, marketing tags, deployed previews loading external assets):** switch to `channel: "chrome"` or `channel: "chromium-tip-of-tree"` in `playwright.config.ts`, OR run the verification under a VM/container with a hardened sandbox boundary. Bundled Chromium is explicitly NOT a security boundary for attacker-reachable surfaces.
- **Active-exploit watch:** historical reference — CVE-2026-2441 (CSS use-after-free, Chrome Threat Analysis Group flagged active exploitation; CISA KEV added 2026-02-17, due date 2026-03-10) was patched in Chromium 145.0.7632.75 per https://nvd.nist.gov/vuln/detail/CVE-2026-2441 (accessed 2026-05-27) and reached Playwright users in 1.59.0 (Chromium 141.0.7390.37 → rolled forward; later 1.60.0 ships 148.0.7778.96). The Playwright-release-to-Chrome-stable gap is the recurring exposure pattern this section guards against, not a single CVE.
- **Per-cycle hygiene:** before a release-gate verification run, check https://playwright.dev/docs/release-notes for the bundled Chromium revision in your installed Playwright version, then cross-reference https://chromereleases.googleblog.com/search/label/Stable%20updates for any post-bundle-cut advisories. If a Critical/High Chrome advisory landed after the Playwright bundle cut, either upgrade Playwright (when a roll is available) OR set `channel: "chrome"` for the run.

## When to disable

- **Headless CI environments without GPU** — fall back to axe-core CLI on serialized HTML (`@axe-core/cli`) when GPU-backed rendering is unavailable.
- **Initial bootstrap before any UI exists** — `npx hatch3r init` on an empty repo has no surface to verify; skill stays dormant until first UI commit.
- **Explicit user opt-out** — `hatch3r config browser=off` respected unconditionally.
- **`hatch3r-ui` or `hatch3r-ux` invoked on non-UI scope** — e.g., a commit touching only `src/api/`. The opt-in flag is honored only when the agent's actual scope includes UI files; report `N/A-NO-UI` in that case.

## Boundaries

- **Always** — run against the built artifact (`npm run build` output) for release-verification gates. Dev-server verification is acceptable for in-flight implementation feedback only.
- **Always** — return only the Output contract to the invoking orchestrator (Sub-agent Isolation above); raw snapshots and reporter dumps stay in the verification sub-agent.
- **Ask first** — before installing browser binaries on the user's machine (~280MB for Chromium). One multiple-choice prompt per `agents/shared/user-question-protocol.md`.
- **Never** — skip axe-core when UI verification is in scope. CQ1 gate requires 0 serious + 0 critical violations per route; skipping the audit is a self-declared gate failure.
- **Never** — read page state from a screenshot when an accessibility snapshot or a locator assertion can express the same check.
- **Never** — overwrite screenshot baselines without an explicit `--update-snapshots` run signed off by the maintainer. Drift in baselines silently passes regressions.

## Cross-references

- `rules/hatch3r-browser-verification.md` — WHEN + Invocation Contract (tiers, command shape, result tokens); this skill is the HOW
- `rules/hatch3r-accessibility-standards.md` — WCAG 2.2 AA conformance gate (0 serious + 0 critical)
- `agents/hatch3r-ui.md` — CQ1 specialist; this skill is its primary verification engine
- `agents/hatch3r-ux.md` — CQ2 specialist; consumes the E2E scaffold + a11y audit
- `skills/hatch3r-qa-path/SKILL.md` — Step 3.5 spawns this skill to prove UI rows before the human table is emitted
- `agents/shared/quality-charter.md` §UI/UX quality — the verification gate definition this skill implements
- `skills/hatch3r-ui-ux-verify` — sibling skill orchestrating the 9-gate release check; this skill provides gates 1, 3, 5

## References

- [microsoft/playwright-cli README](https://github.com/microsoft/playwright-cli) — `install --skills` auto-discovery, YAML snapshot files with element refs, CLI-for-coding-agents vs MCP-for-persistent-loops guidance. Accessed 2026-07-28. Trust tier: official-docs.
- [Playwright docs — Getting started (CLI)](https://playwright.dev/docs/getting-started-cli) — CLI recommended for coding agents balancing browser work against a large codebase. Accessed 2026-07-28. Trust tier: official-docs.
- [microsoft/playwright-mcp README](https://github.com/microsoft/playwright-mcp) — snapshot (accessibility-tree) mode as default, `--caps=vision` as explicit opt-in. Accessed 2026-07-28. Trust tier: official-docs.
- [Playwright docs — Test agents](https://playwright.dev/docs/test-agents) — planner/generator/healer, `init-agents` loop list (VS Code, Claude Code, Codex, OpenCode). Accessed 2026-07-28. Trust tier: official-docs.
- [Better Stack — Playwright CLI vs MCP for browser agents](https://betterstack.com/community/guides/ai/playwright-cli-vs-mcp-browser/) — controlled measurement: ~68-token skill description vs ~3.6k-token MCP schema per session. Accessed 2026-07-28. Trust tier: independent-analysis.
- [Claude Code docs — Chrome integration](https://code.claude.com/docs/en/chrome) — `--chrome` scope + warning that always-on browser tools inflate context. Accessed 2026-07-28. Trust tier: official-docs.
- [Cursor docs — Browser tool](https://cursor.com/docs/agent/browser) — built-in browser with file-based log storage and selective reading. Accessed 2026-07-28. Trust tier: official-docs.
- [GitHub changelog — Copilot coding agent browser](https://github.blog/changelog/2025-07-02-copilot-coding-agent-now-has-its-own-web-browser/) — Playwright MCP enabled by default, localhost-only, PR screenshot posting. Accessed 2026-07-28. Trust tier: official-docs.
- [Playwright Accessibility Testing](https://playwright.dev/docs/accessibility-testing) — official `@axe-core/playwright` integration guide. Accessed 2026-05-26. Trust tier: vendor-official.
- [Playwright Visual Comparisons](https://playwright.dev/docs/test-snapshots) — `toHaveScreenshot()` API, masks, threshold, `--update-snapshots`. Accessed 2026-05-26. Trust tier: vendor-official.
- [Playwright SnapshotAssertions API](https://playwright.dev/docs/api/class-snapshotassertions) — full option surface (`maxDiffPixels`, `maxDiffPixelRatio`, `threshold`, `animations`). Accessed 2026-05-26. Trust tier: vendor-official.
- [@axe-core/playwright on npm](https://www.npmjs.com/package/@axe-core/playwright) — package metadata, current version, weekly downloads. Accessed 2026-05-26. Trust tier: registry-official.
- [Deque DevTools for Web — Playwright integration](https://docs.deque.com/devtools-for-web/4/en/node-pl-write-tests/) — `withTags`, WCAG 2.2 tag mapping, violation severity model. Accessed 2026-05-26. Trust tier: vendor-maintainer (Deque is axe-core author).
- [microsoft/playwright issue #39574](https://github.com/microsoft/playwright/issues/39574) — upstream maintainer stance on bundled Chromium as non-security-boundary; recommends `channel: "chrome"` for untrusted-content verification. Closed 2026-04-03 (state COMPLETED). Accessed 2026-05-27. Trust tier: vendor-official.
- [CVE-2026-2441 (NVD)](https://nvd.nist.gov/vuln/detail/CVE-2026-2441) — Chromium CSS use-after-free, Chromium fix in 145.0.7632.75; CISA KEV addition 2026-02-17. Accessed 2026-05-27. Trust tier: official-feed.
- [Playwright `channel` option (BrowserType.launch)](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-channel) — `chrome`, `chromium-tip-of-tree`, `msedge` channel switches for untrusted-content verification. Accessed 2026-05-27. Trust tier: vendor-official.
- [Chrome Releases — Stable channel updates](https://chromereleases.googleblog.com/search/label/Stable%20updates) — Chrome stable channel advisory feed; cross-reference per-cycle against your installed Playwright's bundled Chromium revision. Accessed 2026-05-27. Trust tier: vendor-official.
