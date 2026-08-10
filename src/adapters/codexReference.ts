import { dirname, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { isPathWithin } from "../codex/pathContainment.js";
import { CodexProjectionError } from "./codexProjectionError.js";

export const CODEX_SUPPORT_ROOT = ".hatch3r/codex-support";

const CANONICAL_REFERENCE_SOURCE =
  "(?:(?:\\.\\.\\/)+|\\.\\/|\\.claude\\/)?(?:agents|rules|commands|checks|governance)\\/[A-Za-z0-9._/-]+\\.md";
const CANONICAL_REFERENCE_RE = new RegExp(
  `(?<![A-Za-z0-9._/-])(${CANONICAL_REFERENCE_SOURCE})`,
  "g",
);
const RELATIVE_SHARED_REFERENCE_RE =
  /(?<![A-Za-z0-9._/-])((?:(?:\.\.\/)+|\.\/)?shared\/[A-Za-z0-9._/-]+\.md)/g;
const STRUCTURED_REFERENCE_KEYS = new Set([
  "quality_charter",
  "efficiency_patterns",
  "user_question_protocol",
  "shared_context",
]);

export type CodexReferenceResolution =
  | { status: "resolved"; canonicalKey: string; target: string }
  | { status: "unsupported"; canonicalKey: string }
  | { status: "self"; canonicalKey: string; target: string };

export interface CodexReferenceResolver {
  targets: ReadonlyMap<string, string>;
  aliases?: ReadonlyMap<string, string>;
  currentTarget?: string;
  selfReferenceText?: string;
  unsupportedKeys?: ReadonlySet<string>;
  preserveUnknown?: boolean;
}

export function normalizeCodexRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function canonicalCodexReferenceKey(value: string): string {
  const normalized = normalizeCodexRelativePath(value)
    .replace(/^(?:\.\.\/)+/, "")
    .replace(/^\.claude\//, "");
  return normalized.replace(/(^|\/)h4tcher-/, "$1hatch3r-");
}

export function assertSafeCodexRelativePath(value: string, label: string): string {
  const normalized = normalizeCodexRelativePath(value);
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    segments.some((segment) => segment === ".." || segment === "") ||
    /[\0\r\n]/.test(normalized)
  ) {
    throw new CodexProjectionError(`${label} contains an unsafe path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

export function codexSupportOutputPath(canonicalRelativePath: string): string {
  const safe = assertSafeCodexRelativePath(
    canonicalRelativePath,
    "Canonical support reference",
  );
  return `${CODEX_SUPPORT_ROOT}/${safe}`;
}

export function topLevelPrefixedReferenceAlias(reference: string): string | undefined {
  const match = reference.match(/^(agents|rules|commands)\/([^/]+\.md)$/);
  if (!match || match[2]!.startsWith("hatch3r-")) return undefined;
  return `${match[1]}/hatch3r-${match[2]}`;
}

export function resolveCodexReference(
  rawReference: string,
  resolver: CodexReferenceResolver,
): CodexReferenceResolution {
  const sourceKey = canonicalCodexReferenceKey(rawReference);
  const canonicalKey = resolver.aliases?.get(sourceKey) ?? sourceKey;
  const target = resolver.targets.get(canonicalKey);
  if (target === undefined) return { status: "unsupported", canonicalKey };
  if (target === resolver.currentTarget) return { status: "self", canonicalKey, target };
  return { status: "resolved", canonicalKey, target };
}

export function extractStructuredCodexReferences(rawContent: string): string[] {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const parsed = parseYaml(match[1]) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return [];
  const references = Object.entries(parsed).flatMap(([key, value]) => {
    if (!STRUCTURED_REFERENCE_KEYS.has(key)) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.filter((item): item is string =>
      typeof item === "string" && canonicalReferenceMatches(item)
    );
  });
  return [...new Set(references)].sort();
}

function canonicalReferenceMatches(value: string): boolean {
  const matched = CANONICAL_REFERENCE_RE.test(value);
  CANONICAL_REFERENCE_RE.lastIndex = 0;
  return matched;
}

export function extractCodexCanonicalReferences(
  content: string,
  sourcePath?: string,
  canonicalRoot?: string,
): string[] {
  const references = [...content.matchAll(CANONICAL_REFERENCE_RE)]
    .map((match) => canonicalCodexReferenceKey(match[1]!))
    .filter((reference) => !/^commands\/hatch3r-[a-z0-9-]+\/SKILL\.md$/i.test(reference));
  CANONICAL_REFERENCE_RE.lastIndex = 0;
  if (sourcePath && canonicalRoot) {
    references.push(...extractRelativeSharedReferences(content, sourcePath, canonicalRoot));
  }
  return [...new Set(references)].sort();
}

function extractRelativeSharedReferences(
  content: string,
  sourcePath: string,
  canonicalRoot: string,
): string[] {
  const references = [...content.matchAll(RELATIVE_SHARED_REFERENCE_RE)].flatMap((match) => {
    const absolute = resolve(dirname(sourcePath), match[1]!);
    return isPathWithin(canonicalRoot, absolute)
      ? [normalizeCodexRelativePath(relative(canonicalRoot, absolute))]
      : [];
  });
  RELATIVE_SHARED_REFERENCE_RE.lastIndex = 0;
  return references;
}

function renderResolution(
  raw: string,
  resolution: CodexReferenceResolution,
  resolver: CodexReferenceResolver,
): string {
  if (resolution.status === "resolved") return resolution.target;
  if (resolution.status === "self") return resolver.selfReferenceText ?? resolution.target;
  if (resolver.preserveUnknown && !resolver.unsupportedKeys?.has(resolution.canonicalKey)) {
    return raw;
  }
  return `[unsupported Hatcher reference omitted: ${resolution.canonicalKey || raw}]`;
}

export function rewriteCodexCanonicalReferences(
  content: string,
  resolver: CodexReferenceResolver,
  sourcePath?: string,
  canonicalRoot?: string,
): string {
  const replace = (raw: string): string => {
    const key = canonicalCodexReferenceKey(raw);
    if (/^commands\/hatch3r-[a-z0-9-]+\/SKILL\.md$/i.test(key)) return raw;
    return renderResolution(raw, resolveCodexReference(raw, resolver), resolver);
  };
  let rewritten = content.replace(CANONICAL_REFERENCE_RE, (_whole, raw: string) => replace(raw));
  if (sourcePath && canonicalRoot) {
    rewritten = rewriteRelativeSharedReferences(
      rewritten,
      resolver,
      sourcePath,
      canonicalRoot,
    );
  }
  return rewriteStructuredReferences(rewritten, replace);
}

function rewriteRelativeSharedReferences(
  content: string,
  resolver: CodexReferenceResolver,
  sourcePath: string,
  canonicalRoot: string,
): string {
  return content.replace(RELATIVE_SHARED_REFERENCE_RE, (_whole, raw: string) => {
    const absolute = resolve(dirname(sourcePath), raw);
    if (!isPathWithin(canonicalRoot, absolute)) return raw;
    const key = normalizeCodexRelativePath(relative(canonicalRoot, absolute));
    return renderResolution(raw, resolveCodexReference(key, resolver), resolver);
  });
}

function rewriteStructuredReferences(
  content: string,
  replace: (raw: string) => string,
): string {
  let rewritten = content;
  for (const key of STRUCTURED_REFERENCE_KEYS) {
    const pattern = new RegExp(
      `^(\\s*${key}:\\s*)(["']?)(${CANONICAL_REFERENCE_SOURCE})\\2(\\s*)$`,
      "gm",
    );
    rewritten = rewritten.replace(
      pattern,
      (_whole, prefix: string, quote: string, raw: string, suffix: string) =>
        `${prefix}${quote}${replace(raw)}${quote}${suffix}`,
    );
  }
  return rewritten;
}
