import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepo, formatRepoSummary, detectLinters, detectTestFrameworks, detectCIProviders, detectMonorepoPackages, analyzeConventionConflicts } from "../../detect/repoAnalyzer.js";

describe("analyzeRepo", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-repo-"));
    return tempDir;
  }

  describe("language detection", () => {
    it("detects TypeScript from tsconfig.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "tsconfig.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("typescript");
    });

    it("detects TypeScript from tsconfig.base.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "tsconfig.base.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("typescript");
    });

    it("detects JavaScript from jsconfig.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "jsconfig.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("javascript");
    });

    it("detects Python from requirements.txt", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "requirements.txt"), "flask\n");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("python");
    });

    it("detects Python from pyproject.toml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "pyproject.toml"), "[tool.poetry]");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("python");
    });

    it("detects Python from setup.py", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "setup.py"), "from setuptools import setup");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("python");
    });

    it("detects Go from go.mod", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "go.mod"), "module example.com/test");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("go");
    });

    it("detects Rust from Cargo.toml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "Cargo.toml"), "[package]");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("rust");
    });

    it("detects Java from pom.xml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "pom.xml"), "<project></project>");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("java");
    });

    it("detects Java from build.gradle", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "build.gradle"), "apply plugin: 'java'");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("java");
    });

    it("detects Ruby from Gemfile", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "Gemfile"), "source 'https://rubygems.org'\ngem 'rails'");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("ruby");
    });

    it("detects Kotlin from build.gradle.kts", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "build.gradle.kts"), "plugins { kotlin(\"jvm\") }");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("kotlin");
    });

    it("detects Python from Pipfile", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "Pipfile"), "[packages]\nflask = \"*\"");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("python");
    });

    it("detects Dart from pubspec.yaml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "pubspec.yaml"), "name: my_app");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("dart");
    });

    it("detects Elixir from mix.exs", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "mix.exs"), "defmodule MyApp do");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("elixir");
    });

    it("detects Swift from Package.swift", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "Package.swift"), "// swift-tools-version:5.5");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("swift");
    });

    it("detects PHP from composer.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "composer.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("php");
    });

    it("detects C# from .csproj files", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "App.csproj"), "<Project></Project>");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("csharp");
    });

    it("detects C# from .sln files", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "App.sln"), "");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("csharp");
    });

    it("returns unknown when no language indicators found", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "README.md"), "# Hello");

      const info = await analyzeRepo(root);
      expect(info.languages).toEqual(["unknown"]);
    });

    it("detects multiple languages simultaneously", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "tsconfig.json"), "{}");
      await writeFile(join(root, "go.mod"), "module test");
      await writeFile(join(root, "Cargo.toml"), "[package]");

      const info = await analyzeRepo(root);
      expect(info.languages).toContain("typescript");
      expect(info.languages).toContain("go");
      expect(info.languages).toContain("rust");
      expect(info.languages).not.toContain("unknown");
    });
  });

  describe("package manager detection", () => {
    it("detects npm from package-lock.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "package-lock.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("npm");
    });

    it("detects yarn from yarn.lock", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "yarn.lock"), "");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("yarn");
    });

    it("detects pnpm from pnpm-lock.yaml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "pnpm-lock.yaml"), "");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("pnpm");
    });

    it("detects bun from bun.lockb", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "bun.lockb"), "");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("bun");
    });

    it("falls back to npm when only package.json exists", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "package.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("npm");
    });

    it("defaults to npm when no package indicators found", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "README.md"), "# Hello");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("npm");
    });

    it("prioritizes bun over other lock files", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "bun.lockb"), "");
      await writeFile(join(root, "package-lock.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("bun");
    });
  });

  describe("monorepo detection", () => {
    it("detects workspaces in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
    });

    it("detects lerna.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "lerna.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
    });

    it("detects pnpm-workspace.yaml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*");

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
    });

    it("detects nx.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "nx.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
    });

    it("detects turbo.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "turbo.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
    });

    it("returns false when package.json has no workspaces", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "my-app" }),
      );

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(false);
    });

    it("returns false when no monorepo indicators found", async () => {
      const root = await createTempRepo();

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(false);
    });

    // F14.2-H1 (D14): `analyzeRepo` now populates `RepoInfo.packages` when a
    // monorepo's workspace globs resolve to package.json-bearing directories.
    it("populates packages when workspaces resolve to package.json directories", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );
      await mkdir(join(root, "packages", "alpha"), { recursive: true });
      await writeFile(
        join(root, "packages", "alpha", "package.json"),
        JSON.stringify({ name: "@scope/alpha" }),
      );

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
      expect(info.packages).toEqual([
        { name: "@scope/alpha", path: "packages/alpha" },
      ]);
    });

    it("omits packages on non-monorepo repos", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "single" }),
      );

      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(false);
      expect(info.packages).toBeUndefined();
    });

    it("omits packages when workspace globs resolve to no directories", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );
      // packages/ directory deliberately absent
      const info = await analyzeRepo(root);
      expect(info.isMonorepo).toBe(true);
      expect(info.packages).toBeUndefined();
    });
  });

  describe("existing tools detection", () => {
    it("detects Cursor from .cursor/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".cursor"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("cursor");
    });

    it("detects Copilot from .github/copilot-instructions.md", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(join(root, ".github", "copilot-instructions.md"), "# Copilot");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("copilot");
    });

    it("detects Claude Code from CLAUDE.md", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "CLAUDE.md"), "# Claude");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("claude");
    });

    it("detects Claude Code from .claude/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".claude"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("claude");
    });

    // W1-C (release/1.9.0): repoAnalyzer detects only the 3 supported adapters —
    // claude, cursor, copilot. Detection cases for the 12 removed adapters
    // (aider/amazonq/amp/antigravity/cline/codex/gemini/goose/kiro/opencode/
    // windsurf/zed) were deleted alongside the adapter sources.

    it("returns empty array when no tools detected", async () => {
      const root = await createTempRepo();

      const info = await analyzeRepo(root);
      expect(info.existingTools).toEqual([]);
    });

    it("detects multiple supported tools simultaneously", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".cursor"), { recursive: true });
      await writeFile(join(root, "CLAUDE.md"), "# Claude");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("cursor");
      expect(info.existingTools).toContain("claude");
    });
  });

  describe("existing agents detection", () => {
    it("detects .agents/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".agents"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.hasExistingAgents).toBe(true);
    });

    it("returns false when .agents/ is absent", async () => {
      const root = await createTempRepo();

      const info = await analyzeRepo(root);
      expect(info.hasExistingAgents).toBe(false);
    });
  });

  describe("framework detection", () => {
    it("detects Next.js from next.config.js", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "next.config.js"), "module.exports = {}");

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("next");
    });

    it("detects Next.js from next in package.json dependencies", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("next");
    });

    it("suppresses react when next is detected", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("next");
      expect(info.frameworks).not.toContain("react");
    });

    it("detects Angular from angular.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "angular.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("angular");
    });

    it("detects Angular from @angular/core in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "@angular/core": "17.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("angular");
    });

    it("detects Vue from vue in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { vue: "3.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("vue");
    });

    it("suppresses vue when nuxt is detected", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { nuxt: "3.0.0", vue: "3.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("nuxt");
      expect(info.frameworks).not.toContain("vue");
    });

    it("detects Svelte from svelte.config.js", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "svelte.config.js"), "export default {}");

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("svelte");
    });

    it("detects SvelteKit from @sveltejs/kit in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ devDependencies: { "@sveltejs/kit": "2.0.0", svelte: "4.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("sveltekit");
    });

    it("suppresses svelte when sveltekit is detected", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ devDependencies: { "@sveltejs/kit": "2.0.0", svelte: "4.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("sveltekit");
      expect(info.frameworks).not.toContain("svelte");
    });

    it("detects Remix from @remix-run/react in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "@remix-run/react": "2.0.0", react: "18.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("remix");
    });

    it("suppresses react when remix is detected", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { "@remix-run/react": "2.0.0", react: "18.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("remix");
      expect(info.frameworks).not.toContain("react");
    });

    it("detects Astro from astro.config.mjs", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "astro.config.mjs"), "export default {}");

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("astro");
    });

    it("detects Nuxt from nuxt.config.ts", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "nuxt.config.ts"), "export default {}");

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("nuxt");
    });

    it("detects plain React when no meta-framework present", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { react: "18.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("react");
    });

    it("detects Express from express in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { express: "4.18.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("express");
    });

    it("detects Fastify from fastify in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { fastify: "4.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("fastify");
    });

    it("detects Hono from hono in package.json", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { hono: "3.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("hono");
    });

    it("detects frameworks from devDependencies", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ devDependencies: { astro: "4.0.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("astro");
    });

    it("detects multiple frameworks simultaneously", async () => {
      const root = await createTempRepo();
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { react: "18.0.0", express: "4.18.0" } }),
      );

      const info = await analyzeRepo(root);
      expect(info.frameworks).toContain("react");
      expect(info.frameworks).toContain("express");
    });

    it("returns empty array when no frameworks detected", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "README.md"), "# Hello");

      const info = await analyzeRepo(root);
      expect(info.frameworks).toEqual([]);
    });
  });

  describe("rootDir", () => {
    it("returns the analyzed directory as rootDir", async () => {
      const root = await createTempRepo();

      const info = await analyzeRepo(root);
      expect(info.rootDir).toBe(root);
    });
  });
});

describe("formatRepoSummary", () => {
  it("formats repo info as readable summary", () => {
    const summary = formatRepoSummary({
      languages: ["typescript", "python"],
      packageManager: "npm",
      frameworks: ["next"],
      isMonorepo: true,
      hasExistingAgents: false,
      existingTools: ["cursor"],
      rootDir: "/test",
    });

    expect(summary).toContain("typescript, python");
    expect(summary).toContain("npm");
    expect(summary).toContain("Frameworks: next");
    expect(summary).toContain("Monorepo: yes");
    expect(summary).toContain("Existing .agents/: no");
    expect(summary).toContain("cursor");
  });

  it("omits existing tools line when none detected", () => {
    const summary = formatRepoSummary({
      languages: ["unknown"],
      packageManager: "unknown",
      frameworks: [],
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
    });

    expect(summary).not.toContain("Frameworks");
    expect(summary).not.toContain("Existing tool configs");
    expect(summary).toContain("Monorepo: no");
  });

  it("includes linters, test frameworks, and CI providers when present", () => {
    const summary = formatRepoSummary({
      languages: ["typescript"],
      packageManager: "npm",
      frameworks: [],
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
      linters: ["eslint", "prettier"],
      testFrameworks: ["vitest"],
      ciProviders: ["github-actions"],
    });

    expect(summary).toContain("Linters: eslint, prettier");
    expect(summary).toContain("Test frameworks: vitest");
    expect(summary).toContain("CI providers: github-actions");
  });

  it("surfaces convention conflicts in the summary (F14.4-H3)", () => {
    const summary = formatRepoSummary({
      languages: ["typescript"],
      packageManager: "npm",
      frameworks: [],
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
      linters: ["eslint"],
      testFrameworks: ["vitest", "jest"],
    });

    expect(summary).toContain("Convention conflicts detected:");
    expect(summary).toContain("jest, vitest");
  });

  it("omits the conflict block when toolchains are unambiguous (F14.4-H3)", () => {
    const summary = formatRepoSummary({
      languages: ["typescript"],
      packageManager: "npm",
      frameworks: [],
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
      linters: ["eslint", "prettier"],
      testFrameworks: ["vitest", "playwright"],
    });

    expect(summary).not.toContain("Convention conflicts detected:");
  });
});

// ── F14.4-H3 (D14): convention-conflict consumer re-export ────────

describe("analyzeConventionConflicts", () => {
  it("returns conflicts detected on a RepoInfo", () => {
    const conflicts = analyzeConventionConflicts({
      languages: ["typescript"],
      packageManager: "npm",
      frameworks: [],
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
      testFrameworks: ["vitest", "jest"],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.dimension).toBe("testFramework");
  });

  it("returns no conflicts for a single-toolchain RepoInfo", () => {
    const conflicts = analyzeConventionConflicts({
      languages: ["typescript"],
      packageManager: "npm",
      frameworks: [],
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
      testFrameworks: ["vitest"],
      linters: ["eslint"],
    });
    expect(conflicts).toEqual([]);
  });
});

// ── D14 Medium (#14.5): Linter detection ──────────────────────────

describe("detectLinters", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-lint-"));
    return tempDir;
  }

  it("detects ESLint from eslint.config.js", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "eslint.config.js"), "export default {};");

    const linters = await detectLinters(root);
    expect(linters).toContain("eslint");
  });

  it("detects Prettier from .prettierrc", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, ".prettierrc"), "{}");

    const linters = await detectLinters(root);
    expect(linters).toContain("prettier");
  });

  it("detects Biome from biome.json", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "biome.json"), "{}");

    const linters = await detectLinters(root);
    expect(linters).toContain("biome");
  });

  it("detects Ruff from ruff.toml", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "ruff.toml"), "[lint]");

    const linters = await detectLinters(root);
    expect(linters).toContain("ruff");
  });

  it("detects RuboCop from .rubocop.yml", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, ".rubocop.yml"), "AllCops:");

    const linters = await detectLinters(root);
    expect(linters).toContain("rubocop");
  });

  it("detects golangci-lint from .golangci.yml", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, ".golangci.yml"), "linters:");

    const linters = await detectLinters(root);
    expect(linters).toContain("golangci-lint");
  });

  it("detects multiple linters simultaneously", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "eslint.config.js"), "export default {};");
    await writeFile(join(root, ".prettierrc"), "{}");

    const linters = await detectLinters(root);
    expect(linters).toContain("eslint");
    expect(linters).toContain("prettier");
  });

  it("returns empty array when no linters found", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "README.md"), "# Hello");

    const linters = await detectLinters(root);
    expect(linters).toEqual([]);
  });
});

// ── D14 Medium (#14.6): Test framework detection ──────────────────

describe("detectTestFrameworks", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-test-"));
    return tempDir;
  }

  it("detects Vitest from vitest.config.ts", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "vitest.config.ts"), "export default {};");

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toContain("vitest");
  });

  it("detects Jest from jest.config.js", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "jest.config.js"), "module.exports = {};");

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toContain("jest");
  });

  it("detects pytest from conftest.py", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "conftest.py"), "import pytest");

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toContain("pytest");
  });

  it("detects RSpec from .rspec", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, ".rspec"), "--format documentation");

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toContain("rspec");
  });

  it("detects Playwright from playwright.config.ts", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "playwright.config.ts"), "export default {};");

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toContain("playwright");
  });

  it("detects Cypress from cypress.config.ts", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "cypress.config.ts"), "export default {};");

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toContain("cypress");
  });

  it("returns empty array when no test frameworks found", async () => {
    const root = await createTempRepo();

    const frameworks = await detectTestFrameworks(root);
    expect(frameworks).toEqual([]);
  });
});

// ── D14 Medium (#14.7): CI provider detection ────────────────────

describe("detectCIProviders", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-ci-"));
    return tempDir;
  }

  it("detects GitHub Actions from .github/workflows directory", async () => {
    const root = await createTempRepo();
    await mkdir(join(root, ".github", "workflows"), { recursive: true });

    const providers = await detectCIProviders(root);
    expect(providers).toContain("github-actions");
  });

  it("detects GitLab CI from .gitlab-ci.yml", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, ".gitlab-ci.yml"), "stages:");

    const providers = await detectCIProviders(root);
    expect(providers).toContain("gitlab-ci");
  });

  it("detects CircleCI from .circleci/config.yml", async () => {
    const root = await createTempRepo();
    await mkdir(join(root, ".circleci"), { recursive: true });
    await writeFile(join(root, ".circleci", "config.yml"), "version: 2.1");

    const providers = await detectCIProviders(root);
    expect(providers).toContain("circleci");
  });

  it("detects Jenkins from Jenkinsfile", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "Jenkinsfile"), "pipeline {}");

    const providers = await detectCIProviders(root);
    expect(providers).toContain("jenkins");
  });

  it("detects Azure Pipelines from azure-pipelines.yml", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "azure-pipelines.yml"), "trigger:");

    const providers = await detectCIProviders(root);
    expect(providers).toContain("azure-pipelines");
  });

  it("returns empty array when no CI providers found", async () => {
    const root = await createTempRepo();

    const providers = await detectCIProviders(root);
    expect(providers).toEqual([]);
  });

  it("detects multiple CI providers", async () => {
    const root = await createTempRepo();
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await writeFile(join(root, ".gitlab-ci.yml"), "stages:");

    const providers = await detectCIProviders(root);
    expect(providers).toContain("github-actions");
    expect(providers).toContain("gitlab-ci");
  });
});

// ── F14.2-H1 (D14): Monorepo package enumeration ──────────────────

describe("detectMonorepoPackages", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createTempRepo(): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-pkgs-"));
    return tempDir;
  }

  async function makePackage(root: string, dir: string, name?: string): Promise<void> {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(
      join(root, dir, "package.json"),
      JSON.stringify(name ? { name } : {}),
    );
  }

  it("enumerates packages from package.json workspaces array", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await makePackage(root, "packages/alpha", "@scope/alpha");
    await makePackage(root, "packages/beta", "@scope/beta");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([
      { name: "@scope/alpha", path: "packages/alpha" },
      { name: "@scope/beta", path: "packages/beta" },
    ]);
  });

  it("enumerates packages from package.json workspaces object form", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: { packages: ["apps/*"] } }),
    );
    await makePackage(root, "apps/web", "web");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "web", path: "apps/web" }]);
  });

  it("enumerates packages from pnpm-workspace.yaml packages list", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - \"packages/*\"\n  - 'apps/*'\n",
    );
    await makePackage(root, "packages/core", "core");
    await makePackage(root, "apps/site", "site");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([
      { name: "site", path: "apps/site" },
      { name: "core", path: "packages/core" },
    ]);
  });

  it("stops the pnpm packages list at the next top-level key", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - \"packages/*\"\ncatalog:\n  react: ^18\n",
    );
    await makePackage(root, "packages/only", "only");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "only", path: "packages/only" }]);
  });

  it("enumerates packages from lerna.json packages array", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "lerna.json"), JSON.stringify({ packages: ["modules/*"] }));
    await makePackage(root, "modules/m1", "m1");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "m1", path: "modules/m1" }]);
  });

  it("resolves an exact (non-wildcard) workspace path", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["server"] }),
    );
    await makePackage(root, "server", "server");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "server", path: "server" }]);
  });

  it("falls back to directory basename when package.json has no name", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await makePackage(root, "packages/nameless");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "nameless", path: "packages/nameless" }]);
  });

  it("skips candidate directories that lack a package.json", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await makePackage(root, "packages/real", "real");
    await mkdir(join(root, "packages", "empty"), { recursive: true });

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "real", path: "packages/real" }]);
  });

  it("ignores dotfiles and node_modules under a wildcard prefix", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await makePackage(root, "packages/keep", "keep");
    await makePackage(root, "packages/node_modules", "should-skip");
    await makePackage(root, "packages/.hidden", "should-skip-too");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "keep", path: "packages/keep" }]);
  });

  it("collapses a recursive glob to its leading directory segment", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/**"] }),
    );
    await makePackage(root, "packages/top", "top");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "top", path: "packages/top" }]);
  });

  it("deduplicates a package matched by overlapping globs", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - \"packages/*\"\n");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await makePackage(root, "packages/dup", "dup");

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([{ name: "dup", path: "packages/dup" }]);
  });

  it("returns an empty array when no workspace config declares packages", async () => {
    const root = await createTempRepo();
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "standalone" }));

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([]);
  });

  it("returns an empty array when workspace globs resolve to no package dirs", async () => {
    const root = await createTempRepo();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    // packages/ dir absent entirely.

    const packages = await detectMonorepoPackages(root);
    expect(packages).toEqual([]);
  });
});
