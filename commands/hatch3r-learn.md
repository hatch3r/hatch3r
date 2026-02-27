---
id: hatch3r-learn
type: command
description: Capture learnings from development sessions into reusable knowledge files for future consultation.
---
# Learning Capture -- Extract and Store Development Insights

Capture learnings from completed development sessions. Can be invoked manually after finishing work, automatically by board-pickup after PR merge, or with a specific issue number for targeted reflection.

---

## Workflow

Execute these steps in order. **Do not skip any step.** Ask the user at every checkpoint marked with ASK.

### Step 1: Gather Learning Context

1. Check what was recently completed:
   - If invoked with an issue number: read the issue, its PR, and changes via `gh issue view` and `gh pr list --search`.
   - If invoked standalone: **ASK** the user what they just completed.
   - If invoked from board-pickup: use the issue/PR context already available.
2. Scan recent git history for context (`git log --oneline -20` on the current branch).

**ASK:** "What did you just complete? {auto-detected context}. Confirm or provide additional details."

### Step 2: Extract Learnings

1. Identify learnings in these categories:
   - **Pattern Discovered**: A reusable approach that worked well.
   - **Pitfall Encountered**: Something that caused problems or wasted time.
   - **Decision Made**: An architectural or design decision with rationale.
   - **Tool/Library Insight**: Something learned about a tool or library.
   - **Process Improvement**: A workflow improvement suggestion.

2. For each learning, capture:
   - What happened (context).
   - What was learned.
   - When this applies in the future (trigger conditions).

**ASK:** "I identified these learnings: {list}. Add, remove, or adjust any? Confirm to save."

### Step 3: Write Learning Files

For each confirmed learning, create a file in `/.agents/learnings/`.

If `/.agents/learnings/` does not exist, create it.

**Filename:** `{YYYY-MM-DD}_{short-slug}.md`

**Content format:**

```markdown
---
id: {short-slug}
date: {YYYY-MM-DD}
source-issue: #{issue-number}  # or "manual" if standalone
category: pattern | pitfall | decision | tool-insight | process
tags: [{area-labels}, {tech-stack-tags}]
area: {module/subsystem affected}
---
## Context

{What was being done when this learning occurred}

## Learning

{The actual insight -- what was learned}

## Applies When

{Future trigger conditions -- when should this learning be consulted}

## Evidence

{Links to relevant code, PRs, issues, or files}
```

**Guardrails for learning files:**
- Never overwrite existing learning files.
- If a duplicate learning is detected (similar to an existing file), **ASK** whether to merge or create separate.
- Learnings must be specific and actionable, not generic advice.
- Always include the "Applies When" section -- learnings without trigger conditions are not useful.
- Tags should use the same vocabulary as the project's area labels.
- Keep learnings concise -- max ~20 lines per learning file body.

### Step 4: Summary

Present all saved learnings with file paths.

```
Learnings Captured:
  /.agents/learnings/{filename1}.md -- {category}: {one-line summary}
  /.agents/learnings/{filename2}.md -- {category}: {one-line summary}
```

Remind user that these will be auto-consulted during future board-pickup and board-fill runs.

---

## Learning Lifecycle

### Expiry & Deprecation
- Learnings have an optional `expires` field (ISO date). Expired learnings are flagged during `hatch3r status`.
- Learnings can be marked `deprecated: true` with a `superseded_by` reference to a newer learning.
- During `hatch3r sync`, expired/deprecated learnings are moved to an `archived/` subdirectory (not deleted).
- Quarterly review: agents prompt for learning review when > 50 active learnings exist.

### Confidence Levels
- `proven` — validated across multiple implementations
- `experimental` — worked once, needs more validation
- `hypothesis` — untested assumption, use with caution

### Lifecycle Frontmatter Fields

```markdown
---
id: {short-slug}
date: {YYYY-MM-DD}
source-issue: #{issue-number}
category: pattern | pitfall | decision | tool-insight | process
tags: [{area-labels}, {tech-stack-tags}]
area: {module/subsystem affected}
confidence: proven | experimental | hypothesis
expires: {YYYY-MM-DD}          # optional
deprecated: false               # set true to deprecate
superseded_by: {learning-id}    # reference when deprecated
---
```

### Archival

Archived learnings are moved to `/.agents/learnings/archived/` with their original filename. An archival notice is prepended:

```markdown
> **Archived on {date}**: {reason — expired | deprecated | superseded by {id}}
```

---

## Search & Discovery

### Tag System
- Learnings are tagged with categories: `performance`, `security`, `ux`, `architecture`, `testing`, `deployment`, `debugging`, `patterns`
- Tags are defined in the learning frontmatter: `tags: [performance, caching]`
- Agents search learnings by tag when starting relevant work (e.g., performance audit consults `performance`-tagged learnings)

### Search Interface
- `hatch3r learn search {query}` — full-text search across learning titles and content
- `hatch3r learn list --tag={tag}` — filter by tag
- `hatch3r learn list --status={active|deprecated|expired}` — filter by lifecycle status
- `hatch3r learn list --recent` — show learnings added in last 30 days

### Search Output Format

```
Learnings matching "{query}":
  [{confidence}] {title} ({date}, tags: {tags})
    /.agents/learnings/{filename}.md
    Applies when: {trigger summary}
```

### Agent Auto-Consultation

During `board-pickup` and `board-fill`, agents automatically consult learnings by:
1. Matching area labels from the issue to learning tags
2. Filtering to `active` status only (not expired/deprecated)
3. Sorting by confidence (`proven` first) then by date (newest first)
4. Presenting top 5 relevant learnings in the implementation context

---

## Learning Quality

### Required Fields
Every learning must include:
- `title` — concise summary (< 80 chars)
- `context` — when this learning applies
- `insight` — what was learned
- `evidence` — how it was validated (PR link, test result, metric)
- `tags` — at least one category tag

### Validation
- Learnings without `evidence` are automatically tagged `hypothesis`
- Learnings referenced in 3+ implementations are auto-promoted to `proven`
- Learnings contradicted by newer evidence are flagged for review

### Quality Checks During Step 3

When writing learning files, validate:
1. Title is under 80 characters
2. At least one tag is present and matches project vocabulary
3. "Applies When" section has specific trigger conditions (not vague)
4. Evidence is present — if not, set `confidence: hypothesis` and warn the user
5. Content does not duplicate an existing active learning (fuzzy match on title + tags)

---

## Error Handling

- `/.agents/learnings/` directory doesn't exist: create it silently.
- `/.agents/learnings/archived/` directory doesn't exist: create it when first archival occurs.
- Duplicate learning detected: warn and **ASK** whether to merge or create separate.
- No learnings identified: **ASK** user directly what they learned. If still nothing, skip silently.
- Learning exceeds quality thresholds: warn user with specific violations and suggest fixes.
- Search returns no results: suggest broader search terms or list all available tags.

## Guardrails

- **Never skip ASK checkpoints.**
- **Never overwrite existing learning files.**
- **Never delete learnings.** Use archival (move to `archived/`) instead of deletion.
- **Learnings must be specific and actionable.** Reject generic advice like "write better tests."
- **Always include trigger conditions** in the "Applies When" section.
- **Tags must match project vocabulary** -- use area labels from `/.agents/hatch.json`.
- **Max ~20 lines per learning** file body (excluding frontmatter).
- **Learnings without evidence must be `hypothesis`.** Do not allow `proven` or `experimental` without evidence.
- **Expired learnings are archived, not deleted.** Preserve institutional knowledge.
