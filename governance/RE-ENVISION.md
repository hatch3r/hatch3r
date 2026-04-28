# hatch3r — Re-Envision Prompt

> Last updated: 2026-04-19

## Purpose

Capture or refine the framework vision through a structured dialog with the framework owner. The output is a `VISION.md` document — the stable north-star that the PRD, audit, and all content derive from.

**Run this prompt when:**

- First-time vision capture (no VISION.md exists yet)
- After a strategic shift in direction or scope
- Periodically to validate that implementation still aligns with intent
- When audit findings reveal vision-level gaps (D17 competitive positioning, D18 PRD alignment)
- After a content-scope expansion (e.g., user-authored content scope added in cycle that introduced D20) — next refresh validates whether end-user adoption metrics warrant further vision adjustment

**This is a framework-owner prompt, not a user-facing command.** It lives alongside AUDIT.md and AUDIT-EXECUTE.md at the project root.

---

## 1. Pre-Dialog — Load Current State

Before starting the dialog, load and summarize the current state from available sources.

### Step 1.1: Read VISION.md

If `VISION.md` exists at the project root:
- Read the full document
- Present a **3-5 bullet summary** of the current vision themes (identity, audience, quality bar, principles, platform strategy)
- Note the `Last updated` date

If no VISION.md exists, state: "No existing VISION.md found. Starting fresh."

### Step 1.2: Read PRD

If `governance/hatch3r-prd.md` exists:
- Read **Section 2 (Vision)** — summarize in 2-3 bullets
- Read **Section 6 (Principles)** — list current principles
- Note any gaps or tensions between PRD vision and VISION.md (if both exist)

If no PRD found, state: "No PRD found. Downstream alignment will be skipped."

### Step 1.3: Read Latest Audit Findings

If `AUDIT-REPORT.md` exists at the project root:
- Read **D17 (Competition & Market Intelligence)** findings — summarize strategic positioning
- Read **D18 (PRD, Roadmap & Distribution)** findings — summarize alignment issues
- Flag any findings that suggest vision-level changes

If no audit report found, state: "No audit report found. Proceeding without audit context."

### Step 1.4: ASK — Fresh Start or Refine

Present the summary from Steps 1.1-1.3, then ask:

> Based on the current state above:
> **(a)** Start fresh — blank slate, rebuild the vision from scratch
> **(b)** Refine — use the current vision as baseline, adjust where needed
>
> Which approach?

Wait for response before proceeding.

---

## 2. Structured Dialog — 10 Themed Question Blocks

For each theme below:
1. Present the **current state** (from Pre-Dialog, or "Not yet defined" if starting fresh)
2. **ASK** the framework owner to confirm, refine, or redefine
3. Wait for response before moving to the next theme

Do NOT combine themes. One at a time.

---

### 2a. Identity & Purpose

**Current state:** *(summarize from VISION.md/PRD or "Not yet defined")*

> **What is hatch3r?**
> Describe it in one paragraph. What does it do? What does it NOT do? What makes it different?

---

### 2b. Target Audience

**Current state:** *(summarize current personas and audience scope)*

> **Who are the primary users?**
> Describe up to 4 personas. For each: who are they, what do they need, why do they pick hatch3r?
> Also: what types of projects, what maturity levels?

---

### 2c. Quality Bar

**Current state:** *(summarize current quality metric and known gaps)*

> **What is the #1 quality metric?**
> How do you measure whether hatch3r is working? What does "good" look like for small tasks? For large tasks? What are the known limitations you accept?

---

### 2d. Up-to-Date Information

**Current state:** *(summarize current approach to information freshness)*

> **How do agents stay current?**
> What sources should agents use? Is this a per-agent feature or a universal principle? What happens when an agent relies on stale information?

---

### 2e. Closed Loop & Audit Cadence

**Current state:** *(summarize current audit cycle and cadence)*

> **How does the improvement loop work?**
> What cadence? What are the stages? How do audit findings become content changes? How does the audit itself evolve? What requires your explicit consent?

---

### 2f. Content Maintenance Model

**Current state:** *(summarize current content types and maintenance approach)*

> **How are content artifacts maintained?**
> List the content types. What is the maintenance process? Who or what triggers changes? What is the quality standard?

---

### 2g. Platform Strategy

**Current state:** *(summarize current adapter count and parity approach)*

> **How many platforms are supported? What is the parity strategy?**
> Are all platforms equal? How are new platforms added? How are platform changes (new features, deprecations) handled?

---

### 2h. CLI Scope

**Current state:** *(summarize current CLI commands and boundaries)*

> **What is the CLI responsible for? What is NOT its job?**
> List the commands. Is the CLI a runtime or a generator? Where does the CLI end and the AI tool begin?

---

### 2i. Learning System Vision

**Current state:** *(summarize current learning approach)*

> **How does project knowledge compound over time?**
> Is learning automatic or manual? Project-level or framework-level? How do you prevent bloat? How do agents use past learnings?

---

### 2j. Principles

**Current state:** *(list current principles)*

> **What are the stable, aspirational principles?**
> These should NOT change week-to-week. They guide every decision. List them — aim for 8-15. For each, one sentence explaining why it matters.

---

## 3. Vision Assembly

After all 10 themes are complete:

### Step 3.1: Draft VISION.md

Compile all dialog responses into a complete VISION.md document:
- Include `> Last updated:` header with today's date
- Use the tagline "Crack the egg. Hatch better agents."
- Clean markdown with `---` section separators
- Direct, confident tone
- Aim for ~200-300 lines
- Do NOT include version numbers, release dates, or competitive analysis

### Step 3.2: ASK — Review Draft

Present the full document and ask:

> Here is the proposed VISION.md. Review the full document.
> - Are there any sections that need adjustment?
> - Anything missing?
> - Anything that should be removed or shortened?

Wait for response. Iterate until the owner approves.

### Step 3.3: ASK — Write Confirmation

If VISION.md already exists:

> VISION.md already exists (last updated: {date}).
> **(a)** Replace entirely with this new version
> **(b)** Abort — keep the existing version
>
> Which option?

If VISION.md does not exist:

> Ready to write VISION.md to the project root. Proceed? **(y/n)**

Wait for confirmation before writing.

---

## 4. Downstream Alignment Check

After VISION.md is written, check alignment with downstream documents.

### Step 4.1: Compare Against PRD

If `governance/hatch3r-prd.md` exists:
- Compare VISION.md against **Section 2 (Vision)** — flag divergences
- Compare VISION.md principles against **Section 6 (Principles)** — flag missing or conflicting principles
- Present a gap analysis with specific proposed changes

If no PRD exists, state: "No PRD found. Skipping PRD alignment check."

### Step 4.2: Compare Against AUDIT.md

If `AUDIT.md` exists:
- Compare VISION.md against **Framework Context** section — flag misalignment
- Check that the audit scope still reflects the vision (domains, content types, platform coverage)
- Present a gap analysis with specific proposed changes

If no AUDIT.md exists, state: "No AUDIT.md found. Skipping audit alignment check."

### Step 4.3: Present Gap Summary

Present all divergences in a single table:

| File | Section | Divergence | Proposed Change |
|------|---------|-----------|-----------------|
| ... | ... | ... | ... |

If no divergences found, state: "All downstream documents are aligned with the new vision."

---

## 5. Downstream Updates

For each proposed change from the gap analysis, ask for per-file confirmation before making changes.

### Step 5.1: PRD Updates

If PRD changes are proposed:

> **PRD changes proposed:**
> *(list specific changes)*
>
> Apply these changes to `governance/hatch3r-prd.md`? **(y/n)**

Only update PRD Section 2 (Vision) and Section 6 (Principles). Do not modify other PRD sections — those are the PRD's domain.

### Step 5.2: AUDIT.md Updates

If AUDIT.md changes are proposed:

> **AUDIT.md changes proposed:**
> *(list specific changes)*
>
> Apply these changes to `AUDIT.md`? **(y/n)**

Only update the Framework Context section. Do not modify audit domains, scoring, or execution model — those evolve through the audit self-evolution process.

### Step 5.3: Confirm All Changes

After all updates are applied (or skipped), present:

> **Changes applied:**
> - VISION.md: Written/Updated
> - hatch3r-prd.md: Updated/Skipped
> - AUDIT.md: Updated/Skipped

---

## 6. Summary

Present a final summary:

### What Was Done
- VISION.md: *(written new / replaced existing / no change)*
- PRD alignment: *(updated sections X, Y / no changes needed / skipped — no PRD)*
- AUDIT.md alignment: *(updated Framework Context / no changes needed / skipped — no AUDIT.md)*

### Next Steps
- Run the next weekly audit cycle to verify content aligns with the updated vision
- Review VISION.md with the team if applicable
- The PRD will naturally evolve from audit findings to reflect the new vision

---

## Guardrails

These rules are non-negotiable during the re-envision process:

1. **Never skip ASK checkpoints.** Every ASK in this prompt requires a response before proceeding. Do not assume, default, or batch approvals.

2. **Never overwrite without confirmation.** If VISION.md exists, always present the replace/abort choice. If downstream files need changes, always ask per-file.

3. **VISION.md = "why and what." PRD = "how and when."** Do not put operational details, timelines, version numbers, release dates, or competitive analysis into VISION.md. Those belong in the PRD.

4. **Principles must be stable and aspirational.** If something changes week-to-week, it is an operational detail, not a principle. Push it to the PRD.

5. **No downstream documents found is not an error.** If PRD or AUDIT.md do not exist, skip their alignment steps and warn the user. The vision stands on its own.

6. **One theme at a time.** Do not combine dialog themes or rush through multiple questions in a single prompt. Each theme deserves focused attention.

7. **Present, don't prescribe.** Show current state, ask for direction. Do not suggest what the vision "should" be — capture what the owner says it is.
