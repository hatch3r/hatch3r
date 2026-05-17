import { type Handoff, type HandoffFrontmatter, type HandoffStatus } from "./schema.js";
import {
  computeHandoffIntegrity,
  REQUIRED_BODY_SECTIONS,
} from "./validation.js";

/**
 * Industry-consensus handoff payload shape — mirrors the multi-vendor
 * `messages + state + metadata` envelope used by upstream agent runtimes.
 * Bridged to the canonical {@link Handoff} via {@link toConsensusPayload}
 * and {@link fromConsensusPayload}.
 */
export interface ConsensusHandoffPayload {
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  state: {
    problem: string;
    decisions: string[];
    work_done: string[];
    work_remaining: string[];
    blockers: string[];
    next_steps: string[];
  };
  metadata: {
    source_agent: string;
    target_agent: string;
    confidence: number;
    completeness: number;
    git_ref: string;
    /** Equal to `handoff.frontmatter.updated`. */
    timestamp: string;
    summary?: string;
    requirements?: string[];
  };
}

/** Maximum number of messages carried through `toConsensusPayload`. */
export const MAX_CONSENSUS_MESSAGES = 10;

/** User-tier wrapper around the synthesized body. */
const USER_TIER_BEGIN = "--- BEGIN USER-TIER CONTENT: handoff ---";
const USER_TIER_END = "--- END USER-TIER CONTENT: handoff ---";

/** Extract the body slice under heading `## <name>` (inclusive of bullet lines). */
function extractSection(body: string, heading: string): string {
  // Build a regex per call (cheap, ≤8 sections per handoff).
  // JS has no `\Z` end-of-string anchor; use a lookahead with the multiline `^`
  // flag and rely on `$` matching end-of-input when no further heading appears.
  const headerEscaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^##\\s+${headerEscaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`,
    "m",
  );
  const match = re.exec(body);
  return match ? match[1].trim() : "";
}

/** Parse a section consisting of `- bullet` lines into a string array. */
function parseBullets(sectionText: string): string[] {
  if (!sectionText) return [];
  const lines = sectionText.split(/\r?\n/);
  const items: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*-\s+(.*\S)\s*$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

/** Format a string array as a Markdown bullet list. Empty array → "- (none)". */
function formatBullets(items: string[]): string {
  if (items.length === 0) return "- (none)";
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Project a canonical {@link Handoff} onto the consensus payload shape.
 *
 * - `state.problem` is the full text of the `## Problem` section (not split).
 * - Bullet sections (Decisions, Work Done, Work Remaining, Blockers, Next Steps)
 *   are parsed line-by-line; non-bullet lines are skipped.
 * - `messages[]` is parsed from an optional `## Compact Message Trail` section
 *   (lines of the form `- role: content`); truncated to {@link MAX_CONSENSUS_MESSAGES}.
 */
export function toConsensusPayload(handoff: Handoff): ConsensusHandoffPayload {
  const body = handoff.body;
  const fm = handoff.frontmatter;

  const messagesSection = extractSection(body, "Compact Message Trail");
  const messages: Array<{ role: string; content: string; timestamp?: string }> = [];
  if (messagesSection) {
    const lines = messagesSection.split(/\r?\n/);
    for (const raw of lines) {
      const m = raw.match(/^\s*-\s+([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
      if (m) messages.push({ role: m[1], content: m[2].trim() });
      if (messages.length >= MAX_CONSENSUS_MESSAGES) break;
    }
  }

  const metadata: ConsensusHandoffPayload["metadata"] = {
    source_agent: fm.source_agent,
    target_agent: fm.target_agent,
    confidence: fm.confidence,
    completeness: fm.completeness,
    git_ref: fm.git_ref,
    timestamp: fm.updated,
  };
  if (typeof fm.summary === "string") metadata.summary = fm.summary;
  if (Array.isArray(fm.requirements)) metadata.requirements = [...fm.requirements];

  return {
    messages,
    state: {
      problem: extractSection(body, "Problem"),
      decisions: parseBullets(extractSection(body, "Decisions")),
      work_done: parseBullets(extractSection(body, "Work Done")),
      work_remaining: parseBullets(extractSection(body, "Work Remaining")),
      blockers: parseBullets(extractSection(body, "Blockers")),
      next_steps: parseBullets(extractSection(body, "Next Steps")),
    },
    metadata,
  };
}

/**
 * Synthesize a canonical {@link Handoff} from a consensus payload.
 *
 * The body carries all 8 {@link REQUIRED_BODY_SECTIONS} headings, wrapped
 * between user-tier markers. `frontmatter.integrity` is recomputed from
 * the synthesized body — callers should pass the existing integrity via
 * `options.integrity` only as a placeholder; the result will reflect the
 * synthesized body's hash.
 */
export function fromConsensusPayload(
  payload: ConsensusHandoffPayload,
  options: {
    id: string;
    status: HandoffStatus;
    branch: string;
    /** Placeholder; the returned handoff carries the computed integrity. */
    integrity: string;
    now?: Date;
  },
): Handoff {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  // Sections — keep the canonical order from REQUIRED_BODY_SECTIONS.
  const sectionLookup: Record<string, string> = {
    Problem: payload.state.problem.trim(),
    Decisions: formatBullets(payload.state.decisions),
    "Work Done": formatBullets(payload.state.work_done),
    "Work Remaining": formatBullets(payload.state.work_remaining),
    Blockers: formatBullets(payload.state.blockers),
    "Next Steps": formatBullets(payload.state.next_steps),
    "Build & Test Status": "- (not specified)",
    "File Manifest": "- (not specified)",
  };

  const sectionBlocks = REQUIRED_BODY_SECTIONS.map((heading) => {
    const content = sectionLookup[heading] ?? "- (none)";
    return `## ${heading}\n\n${content}`;
  });

  // Optional message trail.
  if (payload.messages.length > 0) {
    const messageLines = payload.messages
      .slice(0, MAX_CONSENSUS_MESSAGES)
      .map((m) => `- ${m.role}: ${m.content}`)
      .join("\n");
    sectionBlocks.push(`## Compact Message Trail\n\n${messageLines}`);
  }

  const inner = sectionBlocks.join("\n\n");
  const body = `${USER_TIER_BEGIN}\n\n${inner}\n\n${USER_TIER_END}\n`;
  const computedIntegrity = computeHandoffIntegrity(body);

  const frontmatter: HandoffFrontmatter = {
    id: options.id,
    type: "handoff",
    created: nowIso,
    updated: payload.metadata.timestamp || nowIso,
    status: options.status,
    source_agent: payload.metadata.source_agent,
    target_agent: payload.metadata.target_agent,
    git_ref: payload.metadata.git_ref,
    branch: options.branch,
    confidence: payload.metadata.confidence,
    completeness: payload.metadata.completeness,
    integrity: computedIntegrity || options.integrity,
  };
  if (typeof payload.metadata.summary === "string") {
    frontmatter.summary = payload.metadata.summary;
  }
  if (Array.isArray(payload.metadata.requirements)) {
    frontmatter.requirements = [...payload.metadata.requirements];
  }

  return { frontmatter, body, filePath: "" };
}
