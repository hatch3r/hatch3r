/**
 * Repository command tokens are slash-prefixed only when they are standalone
 * lexical tokens. URL segments, filesystem paths, and word-adjacent text are
 * data, not invocations, and must remain byte-stable.
 */
const STANDALONE_HATCHER_SLASH_RE =
  /(^|[\s([{"'`>→,:;])\/((?:hatch3r|h4tcher)-[a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s)\]}"'`,:;!?]|\.(?:$|\s))/gim;

export function translateStandaloneHatcherSlashInvocations(
  content: string,
  translate: (id: string) => string,
): string {
  STANDALONE_HATCHER_SLASH_RE.lastIndex = 0;
  return content.replace(
    STANDALONE_HATCHER_SLASH_RE,
    (_match, prefix: string, id: string) => `${prefix}${translate(id)}`,
  );
}

export function findStandaloneHatcherSlashInvocations(content: string): string[] {
  STANDALONE_HATCHER_SLASH_RE.lastIndex = 0;
  return [...content.matchAll(STANDALONE_HATCHER_SLASH_RE)].map((match) => match[2]!);
}
