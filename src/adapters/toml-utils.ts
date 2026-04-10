/**
 * Escape a string value for use in a TOML quoted string.
 *
 * Handles backslash, double-quote, backspace (`\b`), form-feed (`\f`),
 * tab, newline, and carriage-return per the TOML v1.0 spec.
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
    .replace(/\r/g, "\\r");
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
    throw new Error(`Invalid TOML key: contains control characters: "${key}"`);
  }
  return `"${escapeTomlString(key)}"`;
}
