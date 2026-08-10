import { readFileSync, rmSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node22",
  splitting: false,
  // Cycle 10 L D4-SA4.1-F4.1.F4 (D4): no `dts` emission. hatch3r is a
  // `bin`-only package (no `exports` field, no library API surface) — its
  // single entry `src/cli/index.ts` is a side-effect module (program.parse)
  // with zero named exports, so tsup's `dts` pass compiled it to a 13-byte
  // `export {  }` while consuming the longest single build phase (~2.1s).
  // Removing it drops the empty `.d.ts` from `dist/` and the published
  // tarball and shortens the build. Re-introduce only alongside a real
  // library `exports` entry filed as a PRD CL-1.
  clean: true,
  // Cycle 10 L D4-SA4.1-F4.1.F6 (D4): second-pass tree-shaking, explicit.
  // tsup's `treeshake` option adds a second Rollup AST pass on top of the
  // tree-shaking esbuild already performs during bundling. For this single-
  // entry (`splitting: false`) `bin`-only CLI the Rollup pass was initially
  // left off, trading its byte reduction for faster builds.
  //
  // Cycle 12 D4-SA4.1-09 (D4): the Cycle-10 "re-run each cycle" note was
  // retired after this measured decision. A/B measured 2026-07-12
  // (tsup 8.5.1, three-way, one source tree): `treeshake: true` = 1,325,930 B
  // vs this `false` baseline = 1,359,021 B — a 33,091 B (2.4%) reduction, at
  // ~9x build time (~480 ms vs ~55 ms for the Rollup pass). Omitting the key
  // is byte-identical to `false` (1,359,021 B), which answers egoist/tsup#1136
  // for this build: `false` and `undefined` both leave the Rollup pass off and
  // keep esbuild's tree-shaker. The documented re-open trigger fired on
  // 2026-08-10: the Codex-support bundle reached 1,720,078 B, above the
  // 1,693,371 B CI budget. Enabling the second pass reduced it to 1,683,560 B
  // (-36,518 B, -2.1%) while keeping the build under two seconds locally.
  // Keep it enabled so the runtime bundle remains within the enforced budget.
  // See governance/audit/domains/D04-build-cicd.md SA 4.1 (registry D4-SA4.1-09).
  treeshake: true,
  // Cycle 10 M D4-M1 (D4): the previous `sourcemap: true` produced
  // dist/cli/index.js.map at 2.49 MB — 271 % of the 919 KB runtime bundle —
  // and `package.json` "files: [\"dist/\"]" published that map to npm on every
  // release. The map exposes the full TypeScript source tree (governance
  // identifiers, internal module names) to anyone running `npm view hatch3r`
  // without serving end-user debugging value (npm package consumers cannot
  // step through a CLI invocation). Setting sourcemap to false drops the
  // .map file from `dist/` and from the published tarball — see
  // governance/audit/domains/D04-build-cicd.md SA 4.1 (Output hygiene /
  // sourcemap posture; registry D4-M1). Local debugging during development can
  // re-enable via `npm run dev` (tsup --watch) + the TSX REPL, which both
  // run unbundled source.
  sourcemap: false,
  outDir: "dist/cli",
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Externalize inquirer's internals. `@inquirer/core` pulls in CJS modules like
  // `mute-stream` that use dynamic `require("stream")`, which a single ESM bundle
  // cannot satisfy; leaving them as runtime imports makes Node resolve them from
  // node_modules where their CJS works natively. `@inquirer/core` and
  // `@inquirer/figures` are declared as exact-pinned direct dependencies in
  // package.json so these externalized imports resolve deterministically in
  // published installs — do not remove either the `external` entry or its
  // package.json dependency (Cycle 12 L D4-SA4.1-07, D4).
  external: ["@inquirer/core", "@inquirer/figures"],
  // Cycle 10 L D4-SA4.1-F4.1.F2 (D4): prune stale empty output subdirectories.
  // `dist/cli/commands/` and `dist/cli/shared/` are relics of a prior build
  // shape (per-command/per-module entry points, before this config settled on
  // a single `src/cli/index.ts` entry with `splitting: false`). tsup's
  // `clean: true` removes files at the output paths but leaves these now-unused
  // empty directories behind, so they survive every rebuild and mislead anyone
  // inspecting `dist/`. Remove them after each successful build. `onSuccess`
  // also runs on `--watch` rebuilds, keeping the dev tree clean.
  onSuccess: async () => {
    for (const stale of ["dist/cli/commands", "dist/cli/shared"]) {
      rmSync(stale, { recursive: true, force: true });
    }
  },
});
