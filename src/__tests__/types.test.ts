import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HatchError,
  ERROR_CODE_TO_EXIT_CODE,
  exitCodeForErrorCode,
  MATURITY_TIERS,
  MATURITY_TIER_RANK,
  TOOLS,
  TOOL_WORKTREE_SUPPORT,
  WORKTREE_CAPABLE_TOOLS,
  AVAILABLE_MCP_SERVERS,
  type HatchErrorCode,
} from "../types.js";
import { findPackageRoot } from "../cli/shared/paths.js";

describe("ERROR_CODE_TO_EXIT_CODE (C8-D1-M5)", () => {
  it("has an entry for every HatchErrorCode literal", () => {
    // Enumerate expected codes -- keeps this test in lockstep with the
    // HatchErrorCode union. If the union gains a member without an entry,
    // the map literal in src/types.ts will fail to typecheck first; this
    // test is the runtime sanity check.
    const expectedCodes: HatchErrorCode[] = [
      "VALIDATION_ERROR",
      "CONFIG_ERROR",
      "FS_ERROR",
      "INTEGRITY_ERROR",
      "ADAPTER_ERROR",
      "NETWORK_ERROR",
      "CLEAN_ERROR",
      "LOCK_TIMEOUT",
      "UNKNOWN_ERROR",
    ];
    for (const code of expectedCodes) {
      expect(ERROR_CODE_TO_EXIT_CODE[code]).toBeTypeOf("number");
    }
    // Guard against silent union drift: confirm the map key set matches.
    expect(new Set(Object.keys(ERROR_CODE_TO_EXIT_CODE))).toEqual(
      new Set(expectedCodes),
    );
  });

  it("maps every entry to a valid POSIX exit code in [0, 255]", () => {
    for (const [code, exit] of Object.entries(ERROR_CODE_TO_EXIT_CODE) as Array<
      [string, number]
    >) {
      expect(
        Number.isInteger(exit) && exit >= 0 && exit <= 255,
        `${code} -> ${exit} is not a valid POSIX exit code`,
      ).toBe(true);
    }
  });

  it("differentiates exit codes per sysexits.h (SA12.1-F-D12-M1)", () => {
    // SA12.1-F-D12-M1 (Cycle 10 Wave 3, D12, P1): each HatchErrorCode maps to
    // the closest matching sysexits.h convention so CI consumers and shell
    // pipelines can branch on failure kind. Source: FreeBSD `/usr/include/
    // sysexits.h`, accessed 2026-05-28. Explicit exitCode arguments still
    // override this default (see "preserves an explicit non-default exitCode"
    // below).
    expect(ERROR_CODE_TO_EXIT_CODE.VALIDATION_ERROR).toBe(64); // EX_USAGE
    expect(ERROR_CODE_TO_EXIT_CODE.CONFIG_ERROR).toBe(65); // EX_DATAERR
    expect(ERROR_CODE_TO_EXIT_CODE.FS_ERROR).toBe(74); // EX_IOERR
    expect(ERROR_CODE_TO_EXIT_CODE.INTEGRITY_ERROR).toBe(73); // EX_CANTCREAT
    expect(ERROR_CODE_TO_EXIT_CODE.ADAPTER_ERROR).toBe(69); // EX_UNAVAILABLE
    expect(ERROR_CODE_TO_EXIT_CODE.NETWORK_ERROR).toBe(75); // EX_TEMPFAIL
    expect(ERROR_CODE_TO_EXIT_CODE.CLEAN_ERROR).toBe(74); // EX_IOERR
    expect(ERROR_CODE_TO_EXIT_CODE.LOCK_TIMEOUT).toBe(75); // EX_TEMPFAIL
    expect(ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR).toBe(70); // EX_SOFTWARE
  });
});

describe("exitCodeForErrorCode (C8-D1-M5)", () => {
  it("returns the mapped default for each HatchErrorCode", () => {
    expect(exitCodeForErrorCode("VALIDATION_ERROR")).toBe(
      ERROR_CODE_TO_EXIT_CODE.VALIDATION_ERROR,
    );
    expect(exitCodeForErrorCode("UNKNOWN_ERROR")).toBe(
      ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR,
    );
    expect(exitCodeForErrorCode("NETWORK_ERROR")).toBe(
      ERROR_CODE_TO_EXIT_CODE.NETWORK_ERROR,
    );
  });
});

describe("HatchError constructor (C8-D1-M5)", () => {
  it("derives exitCode from the map when none is passed", () => {
    const err = new HatchError("fs failure", undefined, "FS_ERROR");
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.FS_ERROR);
    expect(err.errorCode).toBe("FS_ERROR");
    expect(err.message).toBe("fs failure");
    expect(err.name).toBe("HatchError");
  });

  it("derives exitCode from UNKNOWN_ERROR when errorCode is also omitted", () => {
    const err = new HatchError("boom");
    expect(err.errorCode).toBe("UNKNOWN_ERROR");
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR);
  });

  it("preserves an explicit non-default exitCode (user cancellation case)", () => {
    // clean.ts / init.ts throw HatchError with exit 0 for user-initiated
    // cancellation; the constructor must not overwrite that with the map
    // default (which is 1 for UNKNOWN_ERROR).
    const err = new HatchError("Cancelled by user", 0);
    expect(err.exitCode).toBe(0);
    expect(err.errorCode).toBe("UNKNOWN_ERROR");
  });

  it("preserves an explicit exitCode even when errorCode is supplied", () => {
    // sync.ts budgetGateFailed path: exit 2 (usage) with ADAPTER_ERROR code.
    // The explicit exitCode wins over the map lookup for ADAPTER_ERROR (=1).
    const err = new HatchError("budget gate tripped", 2, "ADAPTER_ERROR");
    expect(err.exitCode).toBe(2);
    expect(err.errorCode).toBe("ADAPTER_ERROR");
  });

  it("is instanceof Error and HatchError", () => {
    const err = new HatchError("x", undefined, "CONFIG_ERROR");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HatchError);
  });
});

describe("HatchError.recoveryHint (C9-H27 / D10-SA10.2-F2)", () => {
  it("is undefined by default", () => {
    const err = new HatchError("boom", 1, "VALIDATION_ERROR");
    expect(err.recoveryHint).toBeUndefined();
  });

  it("preserves an explicit hint as the fourth ctor arg", () => {
    const err = new HatchError(
      "Invalid --tools value",
      1,
      "VALIDATION_ERROR",
      "Re-run with one of the supported tool ids.",
    );
    expect(err.recoveryHint).toBe("Re-run with one of the supported tool ids.");
    // Hint does not displace any other field.
    expect(err.message).toBe("Invalid --tools value");
    expect(err.exitCode).toBe(1);
    expect(err.errorCode).toBe("VALIDATION_ERROR");
  });

  it("accepts a hint even when exitCode/errorCode are omitted", () => {
    const err = new HatchError("transient", undefined, undefined, "Retry in a moment.");
    expect(err.recoveryHint).toBe("Retry in a moment.");
    expect(err.errorCode).toBe("UNKNOWN_ERROR");
    // SA12.1-F-D12-M1: default exitCode comes from ERROR_CODE_TO_EXIT_CODE.
    expect(err.exitCode).toBe(ERROR_CODE_TO_EXIT_CODE.UNKNOWN_ERROR);
  });

  it("treats recoveryHint as readonly (compile-time invariant)", () => {
    const err = new HatchError("x", 1, "CONFIG_ERROR", "hint-A");
    // TypeScript marks recoveryHint as readonly; this runtime check guards
    // the contract that the CLI top-level handler observes a stable value.
    expect(err.recoveryHint).toBe("hint-A");
  });
});

describe("MATURITY_TIER_RANK (D1-SA1.8-F-1.8-7)", () => {
  // D1-SA1.8-F-1.8-7 (Cycle 10 Wave 4, content-quality CQ8 / DRY): the rank map
  // is derived from MATURITY_TIERS (single source of truth) rather than a
  // hand-maintained literal, so adding/removing a tier updates the rank
  // automatically. This canary fails if the derivation ever drifts from the
  // canonical array — guarding the rank-comparison gates that admit content
  // (src/content/resolveSelection.ts, src/manifest/hatchJson.ts consume it).
  it("maps the first tier (solo) to rank 0", () => {
    expect(MATURITY_TIER_RANK.solo).toBe(0);
  });

  it("maps the last tier to the array's final index", () => {
    const lastTier = MATURITY_TIERS[MATURITY_TIERS.length - 1];
    expect(MATURITY_TIER_RANK[lastTier]).toBe(MATURITY_TIERS.length - 1);
  });

  it("assigns every tier a contiguous rank equal to its array index", () => {
    // Stronger than the two endpoint checks: every entry must equal its
    // position, and the key set must match MATURITY_TIERS exactly (no extra
    // or missing keys after a future tier edit).
    MATURITY_TIERS.forEach((tier, i) => {
      expect(MATURITY_TIER_RANK[tier]).toBe(i);
    });
    expect(new Set(Object.keys(MATURITY_TIER_RANK))).toEqual(new Set(MATURITY_TIERS));
  });

  it("produces a strictly increasing rank across the tier ladder", () => {
    const ranks = MATURITY_TIERS.map((t) => MATURITY_TIER_RANK[t]);
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
    expect(new Set(ranks).size).toBe(ranks.length); // no duplicate ranks
  });
});

describe("WORKTREE_CAPABLE_TOOLS / TOOL_WORKTREE_SUPPORT (D2-17)", () => {
  // D2-17 (Cycle 11 Wave 3): the worktree-capable membership set is derived
  // from the `Record<Tool, boolean>` TOOL_WORKTREE_SUPPORT (single typed
  // source) rather than a hand-listed string literal, so a future 4th adapter
  // added to TOOLS forces a compile error here until its support is declared —
  // the Set can no longer silently omit a tool. The derive direction stays
  // types.ts -> adapters (ADAPTER_CAPABILITIES.worktree reads this Set), pinned
  // by the capabilityMatrixDrift test.
  it("keys TOOL_WORKTREE_SUPPORT to exactly the TOOLS enum (no extra/missing)", () => {
    expect(new Set(Object.keys(TOOL_WORKTREE_SUPPORT))).toEqual(new Set(TOOLS));
  });

  it("derives the Set membership from TOOL_WORKTREE_SUPPORT", () => {
    for (const tool of TOOLS) {
      expect(WORKTREE_CAPABLE_TOOLS.has(tool)).toBe(TOOL_WORKTREE_SUPPORT[tool]);
    }
  });

  it("contains only declared-supported tools and never a non-Tool string", () => {
    const expected = TOOLS.filter((t) => TOOL_WORKTREE_SUPPORT[t]);
    expect([...WORKTREE_CAPABLE_TOOLS].sort()).toEqual([...expected].sort());
  });

  it("marks all three retained adapters worktree-capable today", () => {
    expect(WORKTREE_CAPABLE_TOOLS.has("cursor")).toBe(true);
    expect(WORKTREE_CAPABLE_TOOLS.has("claude")).toBe(true);
    expect(WORKTREE_CAPABLE_TOOLS.has("copilot")).toBe(true);
  });
});

describe("AVAILABLE_MCP_SERVERS.requiresEnv — lockstep with bundled mcp.json (D3-SA3.4-03)", () => {
  // D3-SA3.4-03 (Cycle 12 Wave 3, Medium, content-quality CQ5): env-var
  // requirements are declared on two surfaces — the hand-maintained
  // AVAILABLE_MCP_SERVERS[*].requiresEnv map (src/types.ts) and the ${env:*}
  // placeholders in the bundled mcp/mcp.json. Nothing pinned them together, so a
  // server add/rename or an env-var change in one surface could silently diverge
  // the other, scaffolding a .env.mcp that omits a variable the generated adapter
  // MCP config references — the exact missing-credential failure the env-
  // generation feature exists to prevent. This loads the REAL bundle (no
  // fixtures, CONSTITUTION §2 P2 Decision 20) and asserts set-equality in both
  // directions, mirroring the package-axis lockstep in
  // mcp-package-resolution.test.ts (D15-25).
  const PKG_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const MCP_JSON_PATH = join(PKG_ROOT, "mcp", "mcp.json");

  // Every ${env:VAR} placeholder anywhere in a server entry (env block, headers,
  // args, url). The bundled `github` server declares GITHUB_PAT inside
  // headers.Authorization rather than an `env` block, so a whole-entry scan is
  // required — an env-block-only extractor would miss it.
  function bundleEnvVars(entry: unknown): Set<string> {
    const vars = new Set<string>();
    for (const match of JSON.stringify(entry).matchAll(/\$\{env:([A-Z0-9_]+)\}/g)) {
      if (match[1]) vars.add(match[1]);
    }
    return vars;
  }

  function loadBundleEnv(): Map<string, Set<string>> {
    const parsed = JSON.parse(readFileSync(MCP_JSON_PATH, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(parsed.mcpServers, `mcpServers missing in ${MCP_JSON_PATH}`).toBeTruthy();
    const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
    const out = new Map<string, Set<string>>();
    for (const [name, entry] of Object.entries(servers)) {
      out.set(name, bundleEnvVars(entry));
    }
    return out;
  }

  function mapEnv(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const [name, meta] of Object.entries(AVAILABLE_MCP_SERVERS)) {
      out.set(name, new Set(meta.requiresEnv ?? []));
    }
    return out;
  }

  it("declares the same server-name set on both surfaces", () => {
    const bundle = [...loadBundleEnv().keys()].sort();
    const map = [...mapEnv().keys()].sort();
    expect(
      bundle,
      "server names in mcp/mcp.json and AVAILABLE_MCP_SERVERS (src/types.ts) diverged — " +
        "add or remove the server on whichever surface is missing it",
    ).toEqual(map);
  });

  it("declares every bundled env placeholder in requiresEnv (bundle -> map)", () => {
    const bundle = loadBundleEnv();
    const map = mapEnv();
    const missing: string[] = [];
    for (const [server, vars] of bundle) {
      const declared = map.get(server) ?? new Set<string>();
      for (const v of vars) {
        if (!declared.has(v)) missing.push(`${server}:${v}`);
      }
    }
    expect(
      missing.sort(),
      "mcp/mcp.json references env placeholder(s) absent from the matching " +
        "AVAILABLE_MCP_SERVERS[server].requiresEnv (src/types.ts) — add them to the map " +
        `so env scaffolding prompts for the credential: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("backs every requiresEnv var with a bundled env placeholder (map -> bundle)", () => {
    const bundle = loadBundleEnv();
    const map = mapEnv();
    const missing: string[] = [];
    for (const [server, vars] of map) {
      const placeholders = bundle.get(server) ?? new Set<string>();
      for (const v of vars) {
        if (!placeholders.has(v)) missing.push(`${server}:${v}`);
      }
    }
    expect(
      missing.sort(),
      "AVAILABLE_MCP_SERVERS[server].requiresEnv (src/types.ts) names env var(s) that no " +
        "placeholder in the mcp/mcp.json server entry references — update the bundle " +
        `or the map so the two agree: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
