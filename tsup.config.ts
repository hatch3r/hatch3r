import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  target: "node22",
  splitting: false,
  dts: true,
  clean: true,
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
});
