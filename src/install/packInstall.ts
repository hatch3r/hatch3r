/**
 * CL-2 U12 (D5-SA5.3-09, Cycle 12): the `hatch3r add <pack>` install engine.
 *
 * Implements the v1 slice of the pack trust contract — two pure-filesystem
 * source tiers (`local-path`, `npm-package` resolved from the project's
 * already-installed `node_modules/`, never a network fetch or `npm install`
 * run by hatch3r) with every static trust gate executed BEFORE any byte is
 * written:
 *
 *   1. `pack-manifest.json` required-field validation (exit 64, names the field)
 *   2. signing-declaration gate — unsigned refuses (exit 73) unless the caller
 *      passes the explicit `--allow-untrusted` override, which is recorded in
 *      the install ledger
 *   3. SHA-256 integrity map verification when the manifest carries `files`
 *      (mismatch or unlisted content file → exit 73)
 *   4. lifecycle-script ban — static scan of pack `package.json` `scripts`
 *      against {@link BANNED_LIFECYCLE_SCRIPTS} (`LIFECYCLE_SCRIPT_BANNED`,
 *      exit 65 EX_DATAERR)
 *   5. deny-pattern body scan via the shared
 *      `src/adapters/customization.ts::scanForDeniedPatterns` export (strict
 *      tier) over every text content file
 *   6. capability enum (`ADAPTER_CAPABILITY_KEYS`), tool-footprint caps
 *      (`TOOL_FOOTPRINT_EXCEEDED`, exit 64) and declared-tools cross-check
 *      (`TOOL_NOT_DECLARED`, exit 64)
 *   7. path-traversal + symlink + non-text-payload guards on every content
 *      path (exit 64)
 *
 * Materialization is per-file atomic (`safeWriteFile` temp+rename) into
 * `.hatch3r/overrides/<class>/…`, with whole-batch rollback (created files
 * removed, overwritten files restored byte-for-byte) on mid-apply failure.
 * The install record lands as a per-pack ledger at
 * `.hatch3r/packs/<pack_id>.json` — `HatchManifest` gains no new field in
 * this slice (see .audit-workspace/content-specs/add-pack-wiring.spec.md §3).
 *
 * Named-code note: the trust model's three pack-specific error codes are
 * surfaced verbatim in the error MESSAGE while reusing the existing
 * `HatchErrorCode` members that carry the identical mandated exit numbers
 * (CONFIG_ERROR→65, VALIDATION_ERROR→64, INTEGRITY_ERROR→73); extending the
 * enum itself is queued for a `src/types.ts`-lock unit.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, rm, lstat } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { HATCH3R_DIR, HatchError, sanitizeId, type MergeResult } from "../types.js";
import { safeWriteFile } from "../merge/safeWrite.js";
import { scanForDeniedPatterns } from "../adapters/customization.js";
import { ADAPTER_CAPABILITY_KEYS } from "../adapters/index.js";
import { HATCH3R_VERSION } from "../version.js";

// ── Constants ──────────────────────────────────────────────────

/** The 15 npm lifecycle-script names banned in pack `package.json` files. */
export const BANNED_LIFECYCLE_SCRIPTS: readonly string[] = [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "preuninstall",
  "postuninstall",
  "prepublish",
  "prepublishOnly",
  "prerestart",
  "restart",
  "postrestart",
  "prestart",
  "pretest",
  "test",
  "posttest",
];

/** Content classes a pack may supply, mapped to `.hatch3r/overrides/<class>/`. */
export const PACK_CONTENT_CLASSES = [
  "agents",
  "skills",
  "rules",
  "commands",
  "hooks",
  "prompts",
  "checks",
] as const;
export type PackContentClass = (typeof PACK_CONTENT_CLASSES)[number];

const FOOTPRINT_KEY_BY_CLASS: Record<PackContentClass, string> = {
  agents: "max_agents",
  skills: "max_skills",
  rules: "max_rules",
  commands: "max_commands",
  hooks: "max_hooks",
  prompts: "max_prompts",
  checks: "max_checks",
};

/**
 * Text payloads only — anything else inside a content class dir refuses
 * install (trust model §3.3: no binary payloads outside text content).
 */
const ALLOWED_CONTENT_EXTENSIONS = new Set([".md", ".mdc", ".txt", ".yaml", ".yml", ".json"]);

/** Valid `signing.method` values (§5.1). */
const VALID_SIGNING_METHODS = new Set(["npm-provenance", "cosign-keyless"]);

const PACK_MANIFEST_FILENAME = "pack-manifest.json";

/** `pack_id` shape: plain or npm-scoped kebab identifier — no path metacharacters. */
const PACK_ID_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

// ── Types ──────────────────────────────────────────────────────

export interface PackSigning {
  method: string;
  identity?: string;
  transparency_log?: string;
}

export interface PackManifest {
  pack_id: string;
  version: string;
  hatch3r_min_version?: string;
  required_capabilities: string[];
  tool_footprint: Record<string, number>;
  declared_tools: string[];
  mcp_servers?: unknown[];
  signing?: PackSigning;
  review_queue?: Record<string, unknown>;
  /** Optional §2.2 integrity map: pack-relative path → SHA-256 hex digest. */
  files?: Record<string, string>;
}

export type PackSourceKind = "local-path" | "npm-package";

export interface ResolvedPackSource {
  kind: PackSourceKind;
  /** The user-supplied spec (path or package name). */
  reference: string;
  /** Absolute pack root directory. */
  rootDir: string;
}

export interface PackContentFile {
  contentClass: PackContentClass;
  /** Pack-relative posix-style path (e.g. `agents/foo.md`). */
  relPath: string;
  /** Absolute source path inside the pack. */
  absPath: string;
  /** Project-relative install target (e.g. `.hatch3r/overrides/agents/foo.md`). */
  targetRelPath: string;
}

export interface PackWriteSetEntry {
  /** Project-relative install target. */
  path: string;
  /** Whether the target already exists (ledger-owned upgrade) or is new. */
  action: "create" | "update";
}

export interface PackInstallPlan {
  manifest: PackManifest;
  source: ResolvedPackSource;
  files: PackContentFile[];
  writeSet: PackWriteSetEntry[];
  /** True when the unsigned-pack override was exercised (recorded in the ledger). */
  allowUntrusted: boolean;
  /** Gate outcomes for reporting (every gate listed here passed). */
  gates: Record<string, "pass" | "n/a">;
}

/** Per-pack install record persisted at `.hatch3r/packs/<pack_id>.json`. */
export interface PackInstallLedger {
  pack_id: string;
  version: string;
  source: { kind: PackSourceKind; reference: string };
  signing: PackSigning | null;
  allowUntrusted: boolean;
  installedAt: string;
  /** Project-relative paths this pack owns (upgrade/rollback surface). */
  files: string[];
  gates: Record<string, "pass" | "n/a">;
}

export interface PackApplyResult {
  results: MergeResult[];
  ledgerRelPath: string;
}

// ── Path guards ────────────────────────────────────────────────

/**
 * Refuse a pack-relative path that could escape its containment root:
 * absolute paths (posix or win32 drive/UNC forms), `..` segments, null
 * bytes, or backslash separators. Exit 64 with the offending path named.
 */
export function assertSafePackRelPath(relPath: string, context: string): void {
  const violation = (why: string): HatchError =>
    new HatchError(
      `Path-traversal guard refused ${context}: "${relPath}" (${why}). Pack content paths must be relative, forward-slash, and contained within the pack.`,
      undefined,
      "VALIDATION_ERROR",
      "Repackage the pack so every content path is a plain relative path inside the pack root.",
    );
  if (relPath.length === 0) throw violation("empty path");
  if (relPath.includes("\0")) throw violation("null byte");
  if (relPath.includes("\\")) throw violation("backslash separator");
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || relPath.startsWith("/")) {
    throw violation("absolute path");
  }
  const segments = relPath.split("/");
  if (segments.some((s) => s === "..")) throw violation("'..' segment");
  // Defense in depth: the normalized form must not rewrite into an escape.
  const normalized = normalize(relPath);
  if (normalized.startsWith("..") || isAbsolute(normalized)) throw violation("normalizes outside root");
}

/** Resolved-containment check: `rel` joined to `rootDir` must stay inside it. */
function assertContained(rootDir: string, relPath: string, context: string): string {
  const resolved = resolve(rootDir, relPath);
  const root = resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new HatchError(
      `Path-traversal guard refused ${context}: "${relPath}" resolves outside ${root}.`,
      undefined,
      "VALIDATION_ERROR",
      "Repackage the pack so every content path stays inside the pack root.",
    );
  }
  return resolved;
}

// ── Source resolution ──────────────────────────────────────────

function looksLikePathSpec(spec: string): boolean {
  return (
    spec.startsWith(".") ||
    spec.startsWith("/") ||
    spec.startsWith("~") ||
    /^[a-zA-Z]:[\\/]/.test(spec) ||
    spec.includes("\\")
  );
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
    // A missing path is the expected negative case for this speculative
    // probe (source resolution tries local-path before node_modules).
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
}

/**
 * Resolve a pack spec to a directory. Path-looking specs (leading `.`/`/`/
 * `~`/drive letter) resolve as local directories; bare names (incl.
 * `@scope/name`) resolve from the project's `node_modules/` — the package
 * must already be installed by the USER'S package manager, hatch3r never
 * fetches (spec §1: zero network, zero lifecycle-script execution surface).
 */
export async function resolvePackSource(projectRoot: string, spec: string): Promise<ResolvedPackSource> {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new HatchError(
      "Empty pack spec.",
      undefined,
      "VALIDATION_ERROR",
      "Pass a local pack directory (./my-pack) or an installed npm package name.",
    );
  }
  if (looksLikePathSpec(trimmed)) {
    const rootDir = resolve(projectRoot, trimmed);
    if (!(await isDirectory(rootDir))) {
      throw new HatchError(
        `Local pack path not found or not a directory: ${rootDir}`,
        undefined,
        "VALIDATION_ERROR",
        "Check the path; a local pack is a directory containing pack-manifest.json.",
      );
    }
    return { kind: "local-path", reference: trimmed, rootDir };
  }
  // npm-package tier: bare (optionally scoped) package name.
  if (!PACK_ID_PATTERN.test(trimmed)) {
    throw new HatchError(
      `Invalid pack spec: ${JSON.stringify(trimmed)}. Expected a local directory path or an npm package name (optionally @scope/name).`,
      undefined,
      "VALIDATION_ERROR",
      "Use ./relative/path for local packs, or the exact installed package name for npm packs.",
    );
  }
  const rootDir = join(projectRoot, "node_modules", ...trimmed.split("/"));
  if (!(await isDirectory(rootDir))) {
    throw new HatchError(
      `Pack package "${trimmed}" is not installed under node_modules/. hatch3r never runs npm install itself.`,
      undefined,
      "VALIDATION_ERROR",
      `Install it first with your package manager (with ignore-scripts enabled), then re-run: hatch3r add ${trimmed}`,
    );
  }
  return { kind: "npm-package", reference: trimmed, rootDir };
}

// ── Manifest validation (§5.1) ─────────────────────────────────

function manifestFieldError(field: string, why: string): HatchError {
  return new HatchError(
    `pack-manifest.json field "${field}" ${why}.`,
    undefined,
    "VALIDATION_ERROR",
    `Fix the "${field}" field in the pack's pack-manifest.json and re-run the install.`,
  );
}

/** Minimal numeric floor extraction for `hatch3r_min_version` (`^x.y.z`, `>=x.y.z`, `x.y.z`). */
function parseMinVersion(expr: string): [number, number, number] | null {
  const m = expr.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function versionAtLeast(actual: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > min[i]) return true;
    if (actual[i] < min[i]) return false;
  }
  return true;
}

/**
 * Validate the raw parsed manifest against the §5.1 required-field schema.
 * Missing or malformed fields refuse install with exit 64 naming the field.
 */
export function validatePackManifest(raw: unknown): PackManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw manifestFieldError("(root)", "must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const packId = obj.pack_id;
  if (typeof packId !== "string" || !PACK_ID_PATTERN.test(packId)) {
    throw manifestFieldError("pack_id", "is required and must be a plain or @scope/ kebab identifier with no path characters");
  }
  const version = obj.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    throw manifestFieldError("version", "is required and must be a semver string");
  }
  if (obj.hatch3r_min_version !== undefined) {
    if (typeof obj.hatch3r_min_version !== "string") {
      throw manifestFieldError("hatch3r_min_version", "must be a semver expression string when present");
    }
    const min = parseMinVersion(obj.hatch3r_min_version);
    if (min === null) {
      throw manifestFieldError("hatch3r_min_version", `is malformed: ${JSON.stringify(obj.hatch3r_min_version)}`);
    }
    const actual = parseMinVersion(HATCH3R_VERSION);
    if (actual !== null && !versionAtLeast(actual, min)) {
      throw new HatchError(
        `Pack "${packId}" requires hatch3r >= ${min.join(".")} but this is ${HATCH3R_VERSION}.`,
        undefined,
        "VALIDATION_ERROR",
        "Update hatch3r (hatch3r update) or install an older pack version.",
      );
    }
  }
  const caps = obj.required_capabilities;
  if (!Array.isArray(caps) || caps.some((c) => typeof c !== "string")) {
    throw manifestFieldError("required_capabilities", "is required and must be an array of capability names");
  }
  const knownCaps = new Set<string>(ADAPTER_CAPABILITY_KEYS);
  const unknownCaps = (caps as string[]).filter((c) => !knownCaps.has(c));
  if (unknownCaps.length > 0) {
    throw manifestFieldError(
      "required_capabilities",
      `contains name(s) outside the closed capability enum: ${unknownCaps.join(", ")} (allowed: ${ADAPTER_CAPABILITY_KEYS.join(", ")})`,
    );
  }
  const footprint = obj.tool_footprint;
  if (typeof footprint !== "object" || footprint === null || Array.isArray(footprint)) {
    throw manifestFieldError("tool_footprint", "is required and must be an object of max_* integer caps");
  }
  for (const [k, v] of Object.entries(footprint as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw manifestFieldError("tool_footprint", `cap "${k}" must be a non-negative integer`);
    }
  }
  const declaredTools = obj.declared_tools;
  if (!Array.isArray(declaredTools) || declaredTools.some((t) => typeof t !== "string")) {
    throw manifestFieldError("declared_tools", "is required and must be an array of tool names");
  }
  if (obj.signing !== undefined) {
    const signing = obj.signing;
    if (typeof signing !== "object" || signing === null || Array.isArray(signing)) {
      throw manifestFieldError("signing", "must be an object with a method field when present");
    }
    const method = (signing as Record<string, unknown>).method;
    if (typeof method !== "string" || !VALID_SIGNING_METHODS.has(method)) {
      throw manifestFieldError("signing.method", 'must be "npm-provenance" or "cosign-keyless"');
    }
  }
  if (obj.files !== undefined) {
    const files = obj.files;
    if (typeof files !== "object" || files === null || Array.isArray(files)) {
      throw manifestFieldError("files", "must be an object mapping path to SHA-256 hex digest when present");
    }
    for (const [p, h] of Object.entries(files as Record<string, unknown>)) {
      if (typeof h !== "string" || !/^[0-9a-f]{64}$/i.test(h)) {
        throw manifestFieldError("files", `entry "${p}" must carry a 64-char SHA-256 hex digest`);
      }
      assertSafePackRelPath(p, `integrity-map key in pack-manifest.json`);
    }
  }
  return obj as unknown as PackManifest;
}

/** Read + parse + validate the pack's `pack-manifest.json`. */
export async function readPackManifest(packRoot: string): Promise<PackManifest> {
  const manifestPath = join(packRoot, PACK_MANIFEST_FILENAME);
  let rawText: string;
  try {
    rawText = await readFile(manifestPath, "utf-8");
  } catch {
    throw new HatchError(
      `No ${PACK_MANIFEST_FILENAME} found at pack root: ${packRoot}`,
      undefined,
      "VALIDATION_ERROR",
      "A hatch3r pack must carry pack-manifest.json at its root (pack_id, version, required_capabilities, tool_footprint, declared_tools).",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new HatchError(
      `${PACK_MANIFEST_FILENAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      "VALIDATION_ERROR",
      "Fix the JSON syntax in pack-manifest.json.",
    );
  }
  return validatePackManifest(parsed);
}

// ── Trust gates ────────────────────────────────────────────────

/**
 * Signing-declaration gate: an absent signing block is a hard stop (exit 73)
 * unless the caller passed the explicit `--allow-untrusted` override.
 * v1 verifies the declaration + the SHA-256 integrity map; in-process
 * cryptographic verification (`npm audit signatures` / `cosign verify-blob`)
 * is the shipped pack-installer agent's write-time re-check and lands in the
 * CLI with pack distribution proper (spec §1 roadmap).
 */
export function verifySigningDeclaration(manifest: PackManifest, allowUntrusted: boolean): "pass" | "n/a" {
  if (manifest.signing !== undefined) return "pass";
  if (allowUntrusted) return "n/a";
  throw new HatchError(
    `Pack "${manifest.pack_id}" declares no signing method (npm-provenance or cosign-keyless). Unsigned packs are refused by default.`,
    undefined,
    "INTEGRITY_ERROR",
    "For a local pack you authored, re-run with --allow-untrusted (the override is recorded in the install ledger); otherwise obtain a signed pack.",
  );
}

/** Lifecycle-script ban (§4.1): static scan of pack `package.json` `scripts`. */
export async function checkLifecycleScripts(packRoot: string): Promise<"pass" | "n/a"> {
  const pkgPath = join(packRoot, "package.json");
  let rawText: string;
  try {
    rawText = await readFile(pkgPath, "utf-8");
    // A pack without package.json is the expected clean case: there is no
    // scripts field npm could ever execute, so the gate reports "n/a".
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return "n/a";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new HatchError(
      "Pack package.json is not valid JSON — refusing install (cannot verify the lifecycle-script ban).",
      undefined,
      "CONFIG_ERROR",
      "Fix the pack's package.json syntax so the lifecycle-script scan can run.",
    );
  }
  const scripts =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>).scripts
      : undefined;
  if (typeof scripts !== "object" || scripts === null) return "pass";
  const banned = Object.keys(scripts).filter((name) => BANNED_LIFECYCLE_SCRIPTS.includes(name));
  if (banned.length > 0) {
    throw new HatchError(
      `LIFECYCLE_SCRIPT_BANNED: pack package.json declares banned lifecycle script(s): ${banned.join(", ")}. Lifecycle scripts execute with your shell credentials on npm install.`,
      undefined,
      "CONFIG_ERROR",
      "Packs must ship without npm lifecycle scripts; ask the pack author to remove them.",
    );
  }
  return "pass";
}

// ── Content enumeration + guards ───────────────────────────────

async function walkContentDir(
  packRoot: string,
  contentClass: PackContentClass,
  relDir: string,
  out: PackContentFile[],
): Promise<void> {
  const absDir = join(packRoot, relDir);
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new HatchError(
        `Symlinked pack content refused: ${relPath}. Symlinks can escape the pack root.`,
        undefined,
        "VALIDATION_ERROR",
        "Repackage the pack with real files instead of symlinks.",
      );
    }
    if (entry.isDirectory()) {
      await walkContentDir(packRoot, contentClass, relPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    assertSafePackRelPath(relPath, "pack content path");
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
    if (!ALLOWED_CONTENT_EXTENSIONS.has(ext)) {
      throw new HatchError(
        `Non-text payload refused in pack content: ${relPath} (allowed extensions: ${[...ALLOWED_CONTENT_EXTENSIONS].join(", ")}).`,
        undefined,
        "VALIDATION_ERROR",
        "Packs carry text content only; remove binary or executable payloads.",
      );
    }
    const absPath = assertContained(packRoot, relPath, "pack content path");
    const targetRelPath = [HATCH3R_DIR, "overrides", ...relPath.split("/")].join("/");
    out.push({ contentClass, relPath, absPath, targetRelPath });
  }
}

/** Enumerate the pack's content files across the seven install classes. */
export async function enumeratePackContent(packRoot: string): Promise<PackContentFile[]> {
  const out: PackContentFile[] = [];
  for (const contentClass of PACK_CONTENT_CLASSES) {
    let dirStat;
    try {
      dirStat = await lstat(join(packRoot, contentClass));
    } catch {
      continue; // class dir absent
    }
    // A symlinked class dir is refused loudly, never silently skipped.
    if (dirStat.isSymbolicLink()) {
      throw new HatchError(
        `Symlinked pack content refused: ${contentClass}/. Symlinks can escape the pack root.`,
        undefined,
        "VALIDATION_ERROR",
        "Repackage the pack with real directories instead of symlinks.",
      );
    }
    if (!dirStat.isDirectory()) continue;
    await walkContentDir(packRoot, contentClass, contentClass, out);
  }
  if (out.length === 0) {
    throw new HatchError(
      `Pack contains no installable content (looked in: ${PACK_CONTENT_CLASSES.join(", ")}).`,
      undefined,
      "VALIDATION_ERROR",
      "A pack supplies at least one artifact under agents/, skills/, rules/, commands/, hooks/, prompts/, or checks/.",
    );
  }
  return out;
}

/**
 * §2.2 integrity map: when the manifest carries `files`, every listed digest
 * must match and every enumerated content file must be listed. Exit 73.
 */
export async function verifyIntegrityMap(
  packRoot: string,
  manifest: PackManifest,
  files: PackContentFile[],
): Promise<"pass" | "n/a"> {
  const map = manifest.files;
  if (map === undefined) return "n/a";
  for (const [relPath, expected] of Object.entries(map)) {
    const abs = assertContained(packRoot, relPath, "integrity-map path");
    let content: Buffer;
    try {
      content = await readFile(abs);
    } catch {
      throw new HatchError(
        `Integrity map lists "${relPath}" but the file is missing from the pack.`,
        undefined,
        "INTEGRITY_ERROR",
        "The pack is incomplete or tampered; re-obtain it from the author.",
      );
    }
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new HatchError(
        `SHA-256 mismatch for "${relPath}": manifest ${expected.slice(0, 12)}…, actual ${actual.slice(0, 12)}….`,
        undefined,
        "INTEGRITY_ERROR",
        "The pack content does not match its signed integrity map; refuse and re-obtain the pack.",
      );
    }
  }
  const listed = new Set(Object.keys(map));
  const unlisted = files.filter((f) => !listed.has(f.relPath)).map((f) => f.relPath);
  if (unlisted.length > 0) {
    throw new HatchError(
      `Pack content file(s) not listed in the integrity map: ${unlisted.join(", ")}.`,
      undefined,
      "INTEGRITY_ERROR",
      "Every installable file must appear in the manifest's files map; the pack may be tampered.",
    );
  }
  return "pass";
}

/**
 * §3.1 body scan: strict-tier deny-pattern scan over every content file
 * BEFORE any write. Any hit refuses install naming the pattern + file.
 */
export async function scanPackBodies(files: PackContentFile[]): Promise<"pass"> {
  const hits: string[] = [];
  for (const file of files) {
    const content = await readFile(file.absPath, "utf-8");
    const violations = scanForDeniedPatterns(content, "strict");
    if (violations.length > 0) {
      hits.push(`${file.relPath}: ${violations[0]}`);
    }
  }
  if (hits.length > 0) {
    throw new HatchError(
      `Deny-pattern body scan refused the pack:\n  ${hits.join("\n  ")}`,
      undefined,
      "VALIDATION_ERROR",
      "The pack body matches known injection/exfiltration patterns; do not install it.",
    );
  }
  return "pass";
}

/** §5.3 footprint caps: per-class file counts must not exceed `tool_footprint.max_*`. */
export function checkFootprint(manifest: PackManifest, files: PackContentFile[]): "pass" {
  const counts = new Map<PackContentClass, number>();
  for (const f of files) counts.set(f.contentClass, (counts.get(f.contentClass) ?? 0) + 1);
  const overflow: string[] = [];
  for (const [contentClass, count] of counts) {
    const cap = manifest.tool_footprint[FOOTPRINT_KEY_BY_CLASS[contentClass]] ?? 0;
    if (count > cap) overflow.push(`${contentClass}: ${count} > declared cap ${cap}`);
  }
  if (overflow.length > 0) {
    throw new HatchError(
      `TOOL_FOOTPRINT_EXCEEDED: pack content exceeds its declared tool_footprint (${overflow.join("; ")}).`,
      undefined,
      "VALIDATION_ERROR",
      "The pack writes more artifacts than its manifest declares; refuse it or obtain a corrected manifest.",
    );
  }
  return "pass";
}

/** Extract base tool names from an agent frontmatter `tools.allow` list (`Bash:x` → `Bash`). */
function baseToolNames(allow: unknown): string[] {
  if (!Array.isArray(allow)) return [];
  return allow
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.split(":")[0].trim())
    .filter((t) => t.length > 0);
}

/**
 * §5.4 declared-tools cross-check: the union of the pack agents'
 * `tools.allow` frontmatter must be a subset of `declared_tools`.
 */
export async function checkDeclaredTools(manifest: PackManifest, files: PackContentFile[]): Promise<"pass"> {
  const declared = new Set(manifest.declared_tools.map((t) => t.split(":")[0].trim()));
  const undeclared = new Set<string>();
  for (const file of files) {
    if (file.contentClass !== "agents" || !file.relPath.endsWith(".md")) continue;
    const content = await readFile(file.absPath, "utf-8");
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) continue;
    let fm: unknown;
    try {
      fm = parseYaml(fmMatch[1]);
    } catch {
      throw new HatchError(
        `Unparseable YAML frontmatter in pack agent ${file.relPath} — refusing install (cannot verify the declared-tools allowlist).`,
        undefined,
        "VALIDATION_ERROR",
        "Fix the agent frontmatter so the tools declaration can be cross-checked.",
      );
    }
    const tools =
      typeof fm === "object" && fm !== null ? (fm as Record<string, unknown>).tools : undefined;
    const allow =
      typeof tools === "object" && tools !== null ? (tools as Record<string, unknown>).allow : undefined;
    for (const name of baseToolNames(allow)) {
      if (!declared.has(name)) undeclared.add(name);
    }
  }
  if (undeclared.size > 0) {
    throw new HatchError(
      `TOOL_NOT_DECLARED: pack agent(s) request tool(s) missing from declared_tools: ${[...undeclared].join(", ")}.`,
      undefined,
      "VALIDATION_ERROR",
      "The manifest must declare every tool the pack's agents request; refuse the pack or obtain a corrected manifest.",
    );
  }
  return "pass";
}

// ── Ledger ─────────────────────────────────────────────────────

/** Project-relative ledger path for a validated pack id. */
export function packLedgerRelPath(packId: string): string {
  return `${HATCH3R_DIR}/packs/${sanitizeId(packId.replace("@", "").replace("/", "__"))}.json`;
}

async function readLedger(projectRoot: string, packId: string): Promise<PackInstallLedger | null> {
  try {
    const raw = await readFile(join(projectRoot, packLedgerRelPath(packId)), "utf-8");
    const parsed = JSON.parse(raw) as PackInstallLedger;
    return Array.isArray(parsed.files) ? parsed : null;
    // An absent or unparseable ledger is the expected first-install case;
    // `null` routes the plan onto the strict no-prior-ownership collision
    // policy, which is the fail-closed disposition.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return null;
  }
}

// ── Plan + apply ───────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
    // ENOENT is the expected negative case for this existence probe (the
    // collision check asks "is there anything at the target yet?").
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
}

/**
 * Installer-owned overwrite: `safeWriteFile` deliberately skips existing
 * files that are neither `hatch3r-*`-named nor written with `force` (they
 * could be user content), but every path reaching here is pack-owned by
 * construction — the plan refused any collision with a file this pack's
 * ledger does not own. Remove-then-recreate keeps the write itself atomic
 * (temp + rename inside safeWriteFile) without the `force` path's
 * user-content `.bak` backup + warning, which would mislabel a routine pack
 * upgrade as a forced clobber of user content.
 */
async function overwriteViaSafeWrite(targetAbs: string, content: string): Promise<MergeResult> {
  await rm(targetAbs, { force: true });
  return safeWriteFile(targetAbs, content);
}

/**
 * Run every trust gate and compute the write set — zero writes. This is the
 * whole of `--dry-run`; `applyPackInstall` is the only writing stage.
 */
export async function planPackInstall(
  projectRoot: string,
  spec: string,
  opts: { allowUntrusted?: boolean } = {},
): Promise<PackInstallPlan> {
  const allowUntrusted = opts.allowUntrusted === true;
  const source = await resolvePackSource(projectRoot, spec);
  const manifest = await readPackManifest(source.rootDir);

  const gates: Record<string, "pass" | "n/a"> = {};
  gates.signing = verifySigningDeclaration(manifest, allowUntrusted);
  gates.lifecycleScripts = await checkLifecycleScripts(source.rootDir);
  const files = await enumeratePackContent(source.rootDir);
  gates.integrityMap = await verifyIntegrityMap(source.rootDir, manifest, files);
  gates.bodyScan = await scanPackBodies(files);
  gates.footprint = checkFootprint(manifest, files);
  gates.declaredTools = await checkDeclaredTools(manifest, files);

  // Write-set + collision policy: a target owned by a prior install of THIS
  // pack (per its ledger) is an upgrade overwrite; any other existing file
  // refuses — no --force override exists on this command (D1-20).
  const ledger = await readLedger(projectRoot, manifest.pack_id);
  const owned = new Set(ledger?.files ?? []);
  const writeSet: PackWriteSetEntry[] = [];
  const collisions: string[] = [];
  for (const file of files) {
    const targetAbs = assertContained(
      join(projectRoot, HATCH3R_DIR, "overrides"),
      file.relPath,
      "install target",
    );
    const exists = await fileExists(targetAbs);
    if (exists && !owned.has(file.targetRelPath)) {
      collisions.push(file.targetRelPath);
      continue;
    }
    writeSet.push({ path: file.targetRelPath, action: exists ? "update" : "create" });
  }
  if (collisions.length > 0) {
    throw new HatchError(
      `Install collides with existing file(s) not owned by pack "${manifest.pack_id}": ${collisions.join(", ")}.`,
      undefined,
      "VALIDATION_ERROR",
      "Move or remove the conflicting override files, then re-run the install.",
    );
  }

  return { manifest, source, files, writeSet, allowUntrusted, gates };
}

/**
 * Materialize a passed plan: per-file atomic writes into
 * `.hatch3r/overrides/<class>/…`, whole-batch rollback on failure, then the
 * per-pack ledger write. Returns the merge results + ledger path.
 */
export async function applyPackInstall(projectRoot: string, plan: PackInstallPlan): Promise<PackApplyResult> {
  const written: Array<{ targetAbs: string; prior: string | null }> = [];
  const results: MergeResult[] = [];
  try {
    for (const file of plan.files) {
      const targetAbs = join(projectRoot, ...file.targetRelPath.split("/"));
      let prior: string | null = null;
      try {
        prior = await readFile(targetAbs, "utf-8");
      } catch {
        prior = null;
      }
      const content = await readFile(file.absPath, "utf-8");
      const result = await overwriteViaSafeWrite(targetAbs, content);
      written.push({ targetAbs, prior });
      results.push(result);
    }
  } catch (err) {
    // Rollback: restore overwritten bytes, remove created files (reverse order).
    for (const w of written.reverse()) {
      try {
        if (w.prior === null) {
          await rm(w.targetAbs, { force: true });
        } else {
          await overwriteViaSafeWrite(w.targetAbs, w.prior);
        }
      } catch (rollbackErr) {
        // Best-effort per path: surface the leftover-path diagnostic on
        // stderr (stdout may be a single JSON document) and keep the
        // original apply error primary.
        process.stderr.write(
          `hatch3r add: rollback could not restore ${w.targetAbs}: ${
            rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
          }\n`,
        );
      }
    }
    throw err;
  }

  const ledger: PackInstallLedger = {
    pack_id: plan.manifest.pack_id,
    version: plan.manifest.version,
    source: { kind: plan.source.kind, reference: plan.source.reference },
    signing: plan.manifest.signing ?? null,
    allowUntrusted: plan.allowUntrusted,
    installedAt: new Date().toISOString(),
    files: plan.writeSet.map((e) => e.path),
    gates: plan.gates,
  };
  const ledgerRelPath = packLedgerRelPath(plan.manifest.pack_id);
  await overwriteViaSafeWrite(
    join(projectRoot, ...ledgerRelPath.split("/")),
    JSON.stringify(ledger, null, 2) + "\n",
  );
  return { results, ledgerRelPath };
}
