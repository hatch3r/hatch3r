import { HatchError } from "../types.js";

/**
 * Escape a string value for use in a TOML quoted string.
 *
 * Handles backslash, double-quote, backspace (`\b`), form-feed (`\f`),
 * tab, newline, and carriage-return per the TOML v1.0 spec. All remaining
 * control characters required by the spec (U+0000-U+0008, U+000B,
 * U+000E-U+001F, U+007F) are emitted as `\uNNNN` short-form escapes per
 * C7.5-W2B2-H5 (D2-SA2.4-4) so canonical content with embedded control
 * characters produces valid TOML for downstream adapters (codex).
 *
 * Reference: https://toml.io/en/v1.0.0 §Strings — "Any Unicode character
 * may be used except those that must be escaped: quotation mark,
 * backslash, and the control characters other than tab (U+0000 to U+0008,
 * U+000A to U+001F, U+007F)."
 *
 * @param s - The raw string value to escape.
 * @returns The escaped string (without surrounding quotes).
 */
export function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\x08/g, "\\b")
    .replace(/\f/g, "\\f")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    // C7.5-W2B2-H5: remaining control chars required by TOML 1.0 spec.
    // Excludes \b \t \n \f \r (already escaped above) and printable ASCII.
    // Range: U+0000-U+0007, U+000B, U+000E-U+001F, U+007F.
    .replace(/[\x00-\x07\x0b\x0e-\x1f\x7f]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
    });
}

/**
 * Escape a string for use in a TOML multi-line basic string (triple-quoted).
 *
 * Multi-line basic strings preserve newlines natively; only backslash, bare
 * triple-quote sequences, and unsupported control characters require escaping.
 * Per TOML v1.0 §Strings-Multi-line, U+000A (LF) and U+000D (CR) are allowed
 * verbatim; U+0009 (tab) is allowed verbatim; other control characters
 * (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F, U+007F) must be escaped.
 *
 * Used by the Codex adapter (C7.5-W2B2-H36) to emit `developer_instructions`
 * as a multi-line basic string containing the agent body, so adapters do not
 * collapse the body onto a single line with literal `\n` sequences.
 *
 * @param s - The raw string value to escape.
 * @returns The escaped string body (without surrounding `"""`).
 */
export function escapeTomlMultilineString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    // Escape any "" followed by another quote to break the triple-quote
    // terminator. A single " or "" inside the body is fine; only """ is
    // illegal. We break the sequence by escaping the third ".
    .replace(/"""/g, '""\\"')
    // LF, CR, tab are allowed verbatim inside multi-line basic strings.
    // Remaining control characters must be escaped (U+0000-U+0008, U+000B,
    // U+000C, U+000E-U+001F, U+007F).
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
    });
}

/**
 * TOML bare key regex — keys matching this pattern can be used unquoted.
 * TOML spec: bare keys may only contain A-Za-z0-9, dashes, and underscores.
 */
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Validate that a string is a valid TOML key. If not a valid bare key,
 * returns the key quoted. Throws if the key contains characters that
 * cannot be represented in TOML (e.g. newlines, control chars).
 */
export function tomlKey(key: string): string {
  if (TOML_BARE_KEY.test(key)) return key;
  // Keys with special chars need quoting — reject control characters
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(key)) {
    throw new HatchError(
      `Invalid TOML key: contains control characters: "${key}"`,
      1,
      "VALIDATION_ERROR",
    );
  }
  return `"${escapeTomlString(key)}"`;
}
