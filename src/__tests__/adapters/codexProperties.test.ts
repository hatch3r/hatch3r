import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { planCodexRemoval } from "../../merge/codexOwnership.js";
import { buildCodexDiscoveryCatalog } from "../../adapters/codexContentProjection.js";
import { renderCodexMcpServers } from "../../adapters/codexMcp.js";
import {
  mergeCodexTomlManagedRegion,
  parseCodexToml,
  removeCodexTomlManagedRegion,
} from "../../adapters/codexToml.js";
import { wrapManagedFor } from "../../merge/managedBlocks.js";

const PROPERTY_CASES = 240;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

describe("Codex seeded lifecycle properties", () => {
  it(`keeps normalized MCP transport fields equivalent for ${PROPERTY_CASES} seeded cases`, () => {
    for (let index = 0; index < PROPERTY_CASES; index += 1) {
      const name = `server-${index}`;
      const envName = `TOKEN_${index}`;
      const args = ["--mode", `safe-${index}`];
      const project = renderCodexMcpServers({
        [name]: {
          command: "tool",
          args,
          cwd: `tools/server-${index}`,
          env: { [envName]: `\${env:${envName}}` },
        },
      }, "project").body;
      const agent = renderCodexMcpServers({
        [name]: {
          command: "tool",
          args,
          cwd: `tools/server-${index}`,
          envVars: [envName],
        },
      }, "custom-agent").body;
      const projectParsed = parseCodexToml(project) as unknown as {
        mcp_servers: Record<string, Record<string, unknown>>;
      };
      const agentParsed = parseCodexToml(agent) as unknown as {
        mcp_servers: Record<string, Record<string, unknown>>;
      };
      expect(agentParsed.mcp_servers[name], `normalized MCP case ${index}`).toEqual(
        projectParsed.mcp_servers[name],
      );
    }
  });

  it(`preserves TOML bytes across merge, repeat, and removal for ${PROPERTY_CASES} seeded cases`, () => {
    const rng = mulberry32(0xc0de_7001);
    const unicode = ["Ångström", "Grüße", "東京", "🚀", "naïve", "Δelta"] as const;

    for (let index = 0; index < PROPERTY_CASES; index += 1) {
      const newline = index % 2 === 0 ? "\n" : "\r\n";
      const finalNewlines = index % 4 === 0 ? 0 : index % 4 === 1 ? 1 : 2;
      const key = `user_${index}`;
      const user = [
        `# ${pick(rng, unicode)} ${index}`,
        `${key} = ${JSON.stringify(`${pick(rng, unicode)}-${Math.floor(rng() * 10_000)}`)}`,
      ].join(newline) + newline.repeat(finalNewlines);
      const body = `[mcp_servers.${JSON.stringify(`managed-${index}`)}]${newline}command = "tool"`;

      const first = mergeCodexTomlManagedRegion(user, body);
      const repeated = mergeCodexTomlManagedRegion(first, body);

      expect(repeated, `merge idempotence case ${index}`).toBe(first);
      expect(removeCodexTomlManagedRegion(first), `removal inverse case ${index}`).toBe(user);
      expect(() => parseCodexToml(first), `parse case ${index}`).not.toThrow();
    }
  });

  it(`keeps Codex removal ownership fail-closed for ${PROPERTY_CASES} seeded cases`, () => {
    const rng = mulberry32(0xc0de_7002);
    const dispositions = new Set<string>();

    for (let index = 0; index < PROPERTY_CASES; index += 1) {
      const relPath = `.agents/skills/hatch3r-case-${index}/SKILL.md`;
      const absPath = join("/repo", relPath);
      const recorded = rng() >= 0.5;
      const shape = index % 5;
      const content = shape === 0
        ? `foreign-${index}\n`
        : shape === 1
          ? wrapManagedFor(absPath, `managed-${index}`)
          : shape === 2
            ? `user-prefix-${index}\n${wrapManagedFor(absPath, `managed-${index}`)}user-suffix-${index}\n`
            : shape === 3
              ? `# HATCH3R:BEGIN\nbroken-${index}\n`
              : `developer_instructions = ${JSON.stringify("Example tokens: HATCH3R:BEGIN / HATCH3R:END")}\n`;

      if (shape === 3 && recorded) {
        expect(() => planCodexRemoval(relPath, absPath, content, recorded)).toThrow(/broken/i);
        dispositions.add("throw");
        continue;
      }

      const first = planCodexRemoval(relPath, absPath, content, recorded);
      const second = planCodexRemoval(relPath, absPath, content, recorded);
      expect(second, `determinism case ${index}`).toEqual(first);
      dispositions.add(first.disposition);
      if (!recorded) {
        expect(first.disposition, `unrecorded case ${index}`).toBe("foreign");
      } else if (shape === 0 || shape === 4) {
        expect(first.disposition, `recorded markerless case ${index}`).toBe("remove");
      } else if (shape === 1) {
        expect(first.disposition, `managed-only case ${index}`).toBe("remove");
      } else {
        expect(first, `mixed-content case ${index}`).toEqual({
          disposition: "preserve",
          content: `user-prefix-${index}\n\nuser-suffix-${index}\n`,
        });
      }
    }

    expect(dispositions).toEqual(new Set(["foreign", "remove", "preserve", "throw"]));
  });

  it(`serializes Unicode discovery metadata within budget deterministically for ${PROPERTY_CASES} seeded cases`, () => {
    const rng = mulberry32(0xc0de_7003);
    const fragments = ["🚀 launch", "Grüße", "東京", "é composed", "🧪 test", "Δelta"] as const;

    for (let index = 0; index < PROPERTY_CASES; index += 1) {
      const count = 2 + Math.floor(rng() * 5);
      const entries = Array.from({ length: count }, (_, entryIndex) => ({
        name: `hatch3r-${index}-${entryIndex}`,
        description: Array.from(
          { length: 8 + Math.floor(rng() * 12) },
          () => pick(rng, fragments),
        ).join(" "),
        path: `.agents/skills/hatch3r-${index}-${entryIndex}/SKILL.md`,
      }));
      const fixedCost = Array.from(entries.map((entry) =>
        `- ${entry.name}:  (file: ${entry.path})\n`
      ).join("")).length;
      const budget = fixedCost + count * (8 + index % 19);

      const first = buildCodexDiscoveryCatalog(entries, budget);
      const repeated = buildCodexDiscoveryCatalog([...entries].reverse(), budget);

      expect(repeated, `determinism case ${index}`).toEqual(first);
      expect(first.characterCount, `exact Unicode length case ${index}`).toBe(
        Array.from(first.serialized).length,
      );
      expect(first.characterCount, `budget case ${index}`).toBeLessThanOrEqual(budget);
      expect(first.serialized, `serialization case ${index}`).toBe(first.entries.map(
        (entry) => `- ${entry.name}: ${entry.description} (file: ${entry.path})\n`,
      ).join(""));
      expect(first.entries.map((entry) => entry.fullDescription)).toEqual(
        [...entries]
          .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
          .map((entry) => entry.description.replace(/\s+/g, " ").trim()),
      );
    }
  });
});
