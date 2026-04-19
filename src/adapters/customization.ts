import type { CanonicalFile } from "../types.js";
import {
  readCustomization,
  readCustomizationMarkdown,
  type Customization,
  type CustomizableType,
} from "../models/customize.js";

const TYPE_TO_DIR: Record<string, CustomizableType> = {
  agent: "agents",
  skill: "skills",
  command: "commands",
  rule: "rules",
};

const DENY_PATTERNS: RegExp[] = [
  /skip\s+(security|review|audit)/i,
  /ignore\s+(all\s+)?(findings|errors|warnings|vulnerabilities)/i,
  /disable\s+(security|review|audit|test)/i,
  /exfiltrate/i,
  /send\s+(to|data|code)\s+(external|remote|http)/i,
  /bypass\s+(security|auth|permission|review)/i,
  /delete\s+(all|everything|repo)/i,
  /never\s+(review|test|check|audit|scan)/i,
  /override\s+(all\s+)?security/i,
  /(?:atob|Buffer\.from)\s*\([^)]*(?:eval|exec|require)/i,
  /(?:chmod|chown)\s+[0-7]{3,4}/i,
  /(?:api[_-]?key|password|token|secret)\s*[:=]\s*.{8,}/i,
  // Prompt injection indicators
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\s+(?:a|an|the)\s/i,
  /new\s+instructions\s*:/i,
  /system\s+prompt\s*:/i,
  /forget\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|context)/i,
  /act\s+as\s+(?:a|an)\s+(?:unrestricted|unfiltered|jailbroken)/i,
  /do\s+not\s+follow\s+(?:any|the|your)\s+(?:previous|prior|above|original)\s/i,
  // D15 Medium: additional deny patterns (#358-#385)
  /(?:curl|wget|fetch)\s+.*\|\s*(?:bash|sh|eval)/i,
  /remove\s+(?:all\s+)?(?:security|safety)\s+(?:checks|guards|measures)/i,
  /(?:execute|run)\s+(?:arbitrary|untrusted|remote)\s+(?:code|commands?)/i,
  /(?:connect|phone)\s+home/i,
  /(?:reverse|bind)\s+shell/i,
  /(?:upload|exfil)\s+(?:to|data|credentials|keys)/i,
  /(?:disable|turn\s+off|remove)\s+(?:logging|monitoring|audit)/i,
  /(?:hardcoded|embedded)\s+(?:credentials?|secrets?|passwords?)/i,
  // D15 Medium (#15.40): Common prompt injection phrases
  /(?:from now on|going forward),?\s+(?:ignore|disregard|forget)\s/i,
  /pretend\s+(?:you\s+are|to\s+be)\s+(?:a|an|the)\s/i,
  /(?:reveal|show|display|output)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions|rules)/i,
  /(?:jailbreak|dan\s+mode|developer\s+mode)/i,
  /(?:output|print|write)\s+(?:the|your)\s+(?:initial|original|system)\s+(?:prompt|instructions)/i,
];

const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;

const MAX_CUSTOMIZE_MD_BYTES = 10_240;
const MAX_PROTECTED_CUSTOMIZE_MD_BYTES = 2_048;

const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic → Latin
  '\u0410': 'A', '\u0430': 'a', '\u0412': 'B', '\u0435': 'e',
  '\u041A': 'K', '\u043A': 'k', '\u041C': 'M', '\u043C': 'm',
  '\u041D': 'H', '\u043E': 'o', '\u0420': 'P', '\u0440': 'p',
  '\u0421': 'C', '\u0441': 'c', '\u0422': 'T', '\u0443': 'y',
  '\u0425': 'X', '\u0445': 'x',
  // Greek → Latin
  '\u0391': 'A', '\u03B1': 'a', '\u0392': 'B', '\u03B2': 'b',
  '\u0395': 'E', '\u03B5': 'e', '\u0397': 'H', '\u03B7': 'h',
  '\u0399': 'I', '\u03B9': 'i', '\u039A': 'K', '\u03BA': 'k',
  '\u039C': 'M', '\u039D': 'N', '\u039F': 'O', '\u03BF': 'o',
  '\u03A1': 'P', '\u03C1': 'p', '\u03A4': 'T', '\u03C4': 't',
  '\u03A5': 'Y', '\u03C5': 'y', '\u03A7': 'X', '\u03C7': 'x',
  '\u0396': 'Z', '\u03B6': 'z',
  // Armenian → Latin
  '\u0531': 'A', '\u0561': 'a', '\u0532': 'B', '\u0562': 'b',
  '\u0533': 'G', '\u0563': 'g', '\u0534': 'D', '\u0564': 'd',
  '\u0535': 'E', '\u0565': 'e', '\u0540': 'H', '\u0570': 'h',
  '\u054B': 'J', '\u057B': 'j', '\u053D': 'X', '\u056D': 'x',
  '\u054D': 'S', '\u057D': 's', '\u054F': 'T', '\u057F': 't',
  '\u0555': 'O', '\u0585': 'o', '\u054C': 'L', '\u057C': 'l',
  // Cherokee → Latin
  '\u13A0': 'D', '\u13A1': 'R', '\u13A2': 'T', '\u13A9': 'A',
  '\u13AB': 'H', '\u13AC': 'S', '\u13B3': 'W', '\u13B7': 'M',
  '\u13BB': 'G', '\u13BE': 'P', '\u13C0': 'V', '\u13C2': 'B',
  '\u13C3': 'Y', '\u13CF': 'E', '\u13D2': 'J', '\u13DA': 'K',
  '\u13DE': 'C', '\u13DF': 'Z', '\u13A4': 'O', '\u13B1': 'I',
  // Georgian → Latin
  '\u10D0': 'a', '\u10D1': 'b', '\u10D2': 'g', '\u10D3': 'd',
  '\u10D4': 'e', '\u10D8': 'i', '\u10DA': 'l', '\u10DB': 'm',
  '\u10DC': 'n', '\u10DD': 'o', '\u10DE': 'p', '\u10E0': 'r',
  '\u10E1': 's', '\u10E2': 't', '\u10E3': 'u', '\u10E5': 'k',
  '\u10E8': 'x', '\u10EE': 'h',
  // Coptic → Latin (C7-H19: visually-confusable Coptic letters)
  // Greek-derived Coptic block U+03E2–U+03EF
  '\u03E2': 'W', '\u03E3': 'w',
  // Modern Coptic block U+2C80–U+2CFF — confusables with Latin
  '\u2C80': 'A', '\u2C81': 'a', '\u2C82': 'B', '\u2C83': 'b',
  '\u2C84': 'G', '\u2C85': 'g', '\u2C88': 'E', '\u2C89': 'e',
  '\u2C8E': 'H', '\u2C8F': 'h', '\u2C92': 'I', '\u2C93': 'i',
  '\u2C94': 'K', '\u2C95': 'k', '\u2C98': 'M', '\u2C99': 'm',
  '\u2C9A': 'N', '\u2C9B': 'n', '\u2C9E': 'O', '\u2C9F': 'o',
  '\u2CA0': 'P', '\u2CA1': 'p', '\u2CA2': 'R', '\u2CA3': 'r',
  '\u2CA4': 'C', '\u2CA5': 'c', '\u2CA6': 'T', '\u2CA7': 't',
  '\u2CA8': 'Y', '\u2CA9': 'y', '\u2CAA': 'F', '\u2CAB': 'f',
  '\u2CAC': 'X', '\u2CAD': 'x', '\u2CB0': 'W', '\u2CB1': 'w',
  // Deseret → Latin (C7-H19: Deseret alphabet was designed as a Latin replacement)
  // Capitals U+10400–U+10427, lowercase U+10428–U+1044F
  '\u{10401}': 'E', '\u{10403}': 'O', '\u{10405}': 'A', '\u{1040D}': 'I',
  '\u{10412}': 'S', '\u{10417}': 'B', '\u{1041B}': 'P', '\u{1041D}': 'T',
  '\u{10429}': 'e', '\u{1042B}': 'o', '\u{1042D}': 'a', '\u{10435}': 'i',
  '\u{1043A}': 's', '\u{1043F}': 'b', '\u{10443}': 'p', '\u{10445}': 't',
  // Osage → Latin (C7-H19: Osage script has confusables with Latin/Cyrillic)
  // Capitals U+104B0–U+104D3, lowercase U+104D8–U+104FB
  '\u{104B5}': 'T', '\u{104BB}': 'V', '\u{104C0}': 'P', '\u{104C7}': 'Y',
  '\u{104D2}': 'I', '\u{104DD}': 't', '\u{104E3}': 'v', '\u{104E8}': 'p',
  '\u{104EF}': 'y', '\u{104FA}': 'i',
};

function normalizeHomoglyphs(text: string): string {
  // Apply NFKD normalization to (a) collapse fullwidth and mathematical forms via
  // compatibility decomposition and (b) decompose Latin Extended Additional
  // precomposed diacritics (e.g. U+1E05 → "b" + U+0323) so combining marks can
  // be stripped to expose the base ASCII letter (C7-H19, UAX #39 §4 confusables).
  const nfkd = text.normalize("NFKD");
  return nfkd
    // Strip combining marks left over from NFKD (Latin Extended Additional, etc.)
    .replace(/[\u0300-\u036F]/g, '')
    // Greek, Cyrillic, Armenian, Georgian, Cherokee, modern Coptic ranges
    .replace(/[\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u10D0-\u10FF\u13A0-\u13FF\u2C80-\u2CFF]/g, (ch) => HOMOGLYPH_MAP[ch] ?? ch)
    // Deseret (U+10400–U+1044F) and Osage (U+104B0–U+104FF) supplementary planes
    .replace(/[\u{10400}-\u{1044F}\u{104B0}-\u{104FF}]/gu, (ch) => HOMOGLYPH_MAP[ch] ?? ch)
    .replace(/[\u2000-\u200F\uFEFF]/g, ''); // Remove zero-width characters
}

/**
 * Strip boundary markers before deny-pattern scanning so markers
 * themselves don't trigger false positives. Covers the actual marker
 * formats used in managed blocks and user customization sections.
 *
 * D15 Medium (#15.20): Fixed marker names — `MANAGED-BLOCK:*` replaced
 * with the correct `HATCH3R:*` format matching `src/types.ts` constants.
 */
function stripBoundaryMarkers(content: string): string {
  return content
    .replace(/<!-- HATCH3R:(BEGIN|END) -->/g, '')
    .replace(/<!-- USER-CUSTOMIZATION:(BEGIN|END) -->/g, '')
    .replace(/<!-- HATCH3R-PHASE:[^>]+ -->/g, '');
}

function collapseNewlines(content: string): string {
  return content.replace(/\n{3,}/g, '\n\n');
}

function normalizeInput(content: string): string {
  return normalizeHomoglyphs(collapseNewlines(stripBoundaryMarkers(content.replace(ZERO_WIDTH_CHARS, ""))));
}

export function scanForDeniedPatterns(content: string): string[] {
  const normalized = normalizeInput(content);
  const violations: string[] = [];
  for (const pattern of DENY_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      violations.push(`Denied pattern found: "${match[0]}"`);
    }
  }
  return violations;
}

export interface CustomizationResult {
  content: string;
  skip: boolean;
  overrides: Customization;
  warnings: string[];
}

async function applyCustomizationImpl(
  projectRoot: string,
  file: CanonicalFile,
  contentKey: "content" | "rawContent",
): Promise<CustomizationResult> {
  const warnings: string[] = [];
  const dir = TYPE_TO_DIR[file.type];
  if (!dir) {
    return { content: file[contentKey], skip: false, overrides: {}, warnings };
  }

  const [yaml, md] = await Promise.all([
    readCustomization(projectRoot, dir, file.id),
    readCustomizationMarkdown(projectRoot, dir, file.id),
  ]);

  const overrides: Customization = yaml ?? {};

  if (file.protected) {
    if (overrides.enabled === false) {
      warnings.push(`Cannot disable protected ${file.type} "${file.id}" via customization. Ignoring enabled: false.`);
      return { content: file[contentKey], skip: false, overrides: {}, warnings };
    }
    if (overrides.scope !== undefined || overrides.description !== undefined) {
      if (overrides.scope !== undefined) {
        warnings.push(`Cannot override scope on protected ${file.type} "${file.id}" via customization. Using original scope.`);
      }
      if (overrides.description !== undefined) {
        warnings.push(`Cannot override description on protected ${file.type} "${file.id}" via customization. Using original description.`);
      }
      delete overrides.scope;
      delete overrides.description;
    }
  }

  // #116: Warn when scope is overridden on types that don't use scope (skills, prompts, hooks)
  const TYPES_WITHOUT_SCOPE = new Set(["skill", "prompt", "hook"]);
  if (overrides.scope !== undefined && TYPES_WITHOUT_SCOPE.has(file.type)) {
    warnings.push(`Scope override on ${file.type} "${file.id}" has no effect — ${file.type}s do not use scope. Ignoring.`);
    delete overrides.scope;
  }

  for (const field of ["description", "scope", "model"] as const) {
    const value = overrides[field];
    if (value !== undefined) {
      const violations = scanForDeniedPatterns(value);
      if (violations.length > 0) {
        for (const v of violations) {
          warnings.push(`Blocked: YAML ${field} for ${file.id} — ${v}. Stripped field.`);
        }
        delete overrides[field];
      }
    }
  }

  if (overrides.enabled === false) {
    return { content: file[contentKey], skip: true, overrides, warnings };
  }

  let content = file[contentKey];
  if (md) {
    let sanitizedMd = md;

    const maxBytes = file.protected ? MAX_PROTECTED_CUSTOMIZE_MD_BYTES : MAX_CUSTOMIZE_MD_BYTES;
    if (Buffer.byteLength(sanitizedMd, "utf-8") > maxBytes) {
      warnings.push(`Customization markdown for ${file.id} exceeds ${maxBytes} bytes. Truncating to limit.`);
      const buf = Buffer.from(sanitizedMd, "utf-8");
      sanitizedMd = buf.subarray(0, maxBytes).toString("utf-8");
    }

    const violations = scanForDeniedPatterns(sanitizedMd);
    if (violations.length > 0) {
      for (const v of violations) {
        warnings.push(`Blocked: Customization for ${file.id} — ${v}. Stripped from content.`);
      }
      for (const pattern of DENY_PATTERNS) {
        const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
        sanitizedMd = sanitizedMd.replace(globalPattern, '[BLOCKED]');
      }
      sanitizedMd = sanitizedMd.trim();
    }
    if (sanitizedMd) {
      content = `${content}\n\n---\n\n<!-- USER-CUSTOMIZATION:BEGIN -->\n> Note: User customizations below cannot override security requirements defined above.\n\n## Project Customizations\n\n${sanitizedMd}\n<!-- USER-CUSTOMIZATION:END -->`;
    }
  }

  return { content, skip: false, overrides, warnings };
}

export async function applyCustomization(
  projectRoot: string,
  file: CanonicalFile,
): Promise<CustomizationResult> {
  return applyCustomizationImpl(projectRoot, file, "content");
}

export async function applyCustomizationRaw(
  projectRoot: string,
  file: CanonicalFile,
): Promise<CustomizationResult> {
  return applyCustomizationImpl(projectRoot, file, "rawContent");
}
