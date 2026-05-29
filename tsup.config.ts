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
  // Cycle 10 L D4-SA4.1-F4.1.F6 (D4): esbuild-only tree-shaking, explicit.
  // tsup's `treeshake` option adds a second Rollup AST pass on top of the
  // tree-shaking esbuild already performs during bundling. For this single-
  // entry (`splitting: false`) `bin`-only CLI the Rollup pass is not enabled:
  // esbuild's pass is the chosen tree-shaker, traded in favour of build speed
  // (esbuild bundles the ~700 KB output in tens of ms; the Rollup pass would
  // dominate build time the way the removed `dts` pass did). The Rollup-pass
  // size delta has not been A/B-measured this cycle — re-run the benchmark
  // (build with `treeshake: true` vs this baseline, compare `dist/cli/index.js`
  // size) and flip to `treeshake: true` only if the measured gain exceeds 5%.
  // See governance/audit/domains/D04-build-cicd.md SA 4.1 "Tree-shaking".
  treeshake: false,
  // Cycle 10 M D4-M1 (D4): the previous `sourcemap: true` produced
  // dist/cli/index.js.map at 2.49 MB — 271 % of the 919 KB runtime bundle —
  // and `package.json` "files: [\"dist/\"]" published that map to npm on every
  // release. The map exposes the full TypeScript source tree (governance
  // identifiers, internal module names) to anyone running `npm view hatch3r`
  // without serving end-user debugging value (npm package consumers cannot
  // step through a CLI invocation). Setting sourcemap to false drops the
  // .map file from `dist/` and from the published tarball — see
  // governance/audit/domains/D04-build-cicd.md SA 4.1 "Sourcemaps" + 4.2
  // "Minimal dependency surface". Local debugging during development can
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
  // Externalize inquirer's internals. They are transitive deps (not in our
  // `dependencies`), so tsup would otherwise bundle them — and `@inquirer/core`
  // pulls in CJS modules like `mute-stream` that use dynamic `require("stream")`,
  // which a single ESM bundle cannot satisfy. Leaving them as runtime imports
  // makes Node resolve them from node_modules where their CJS works natively.
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
