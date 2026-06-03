/**
 * Canonical schema for mid-work handoff artifacts.
 *
 * Handoffs are plain Markdown files at `.hatch3r/handoffs/active/<id>.md`
 * (or `archived/<id>.md`) with YAML frontmatter conforming to
 * {@link HandoffFrontmatter} plus a body of section-headed text.
 *
 * Pillar: P4 (Lean Coverage) + P2 (Scientific Quality) — explicit status
 * machine, integrity field, and frontmatter-driven validation.
 */

/** Lifecycle states for a handoff artifact. */
export type HandoffStatus =
  | "open"
  | "in-progress"
  | "blocked"
  | "handed-off"
  | "resumed"
  | "completed"
  | "archived";

/** All valid {@link HandoffStatus} values in canonical order. */
export const HANDOFF_STATUSES: readonly HandoffStatus[] = [
  "open",
  "in-progress",
  "blocked",
  "handed-off",
  "resumed",
  "completed",
  "archived",
] as const;

/**
 * Allowed state transitions between {@link HandoffStatus} values.
 * `archived` is terminal (empty array). `completed` only transitions to `archived`.
 */
export const VALID_STATUS_TRANSITIONS: Record<HandoffStatus, readonly HandoffStatus[]> = {
  "open": ["in-progress", "blocked", "handed-off", "archived"],
  "in-progress": ["blocked", "handed-off", "completed", "archived"],
  "blocked": ["in-progress", "handed-off", "archived"],
  "handed-off": ["resumed", "archived"],
  "resumed": ["in-progress", "blocked", "completed", "archived"],
  "completed": ["archived"],
  "archived": [],
};

/** YAML frontmatter shape for a handoff file. */
export interface HandoffFrontmatter {
  /** Stable identifier matching HANDOFF_ID_PATTERN. */
  id: string;
  /** Artifact discriminator — always "handoff". */
  type: "handoff";
  /** Creation timestamp (ISO-8601). */
  created: string;
  /** Last-update timestamp (ISO-8601). */
  updated: string;
  /** Current lifecycle state. */
  status: HandoffStatus;
  /** Agent identifier that authored the handoff. */
  source_agent: string;
  /** Agent identifier expected to resume — "any" allowed but flagged. */
  target_agent: string;
  /** Git ref in `branch@sha7` form (e.g. "feature/x@a1b2c3d"). */
  git_ref: string;
  /** Branch name (separate from sha for filter convenience). */
  branch: string;
  /** Author-rated confidence in the handoff content, 0..1 inclusive. */
  confidence: number;
  /** Author-rated completeness of the documented state, 0..1 inclusive. */
  completeness: number;
  /** SHA-256 of the body content, formatted "sha256:<hex>". */
  integrity: string;
  /** Optional external work-item link (gh:/ado:/gl: forms). */
  work_item?: string;
  /** Optional expiry timestamp (ISO-8601 date). */
  expires_after?: string;
  /** Optional ≤200-char summary. */
  summary?: string;
  /** Optional list of resumption requirements. */
  requirements?: string[];
  /** Optional count of compaction events that produced this handoff. */
  compaction_count?: number;
  /** Optional hatch3r version that authored this handoff. */
  hatch3r_version?: string;
  /** Optional tag list. */
  tags?: string[];
  /** Optional id of a handoff that supersedes this one. */
  superseded_by?: string;
  /** Optional id of a parent handoff this one continues. */
  parent_handoff?: string;
}

/** A parsed handoff artifact with its source file path. */
export interface Handoff {
  frontmatter: HandoffFrontmatter;
  body: string;
  filePath: string;
}

/**
 * Returns true iff `to` is a permitted next state from `from`
 * per {@link VALID_STATUS_TRANSITIONS}.
 */
export function isValidStatusTransition(from: HandoffStatus, to: HandoffStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from].includes(to);
}

/** Type guard: returns true iff `value` is a {@link HandoffStatus}. */
export function isHandoffStatus(value: unknown): value is HandoffStatus {
  return typeof value === "string" && (HANDOFF_STATUSES as readonly string[]).includes(value);
}
