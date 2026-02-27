import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepo, formatRepoSummary } from "../../detect/repoAnalyzer.js";

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

    it("returns unknown when no package indicators found", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "README.md"), "# Hello");

      const info = await analyzeRepo(root);
      expect(info.packageManager).toBe("unknown");
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

    it("detects OpenCode from opencode.json", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "opencode.json"), "{}");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("opencode");
    });

    it("detects OpenCode from opencode.jsonc", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "opencode.jsonc"), "{}");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("opencode");
    });

    it("detects Windsurf from .windsurfrules", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, ".windsurfrules"), "rules");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("windsurf");
    });

    it("detects Amp from .amp/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".amp"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("amp");
    });

    it("does not detect Amp from .agents/commands (hatch3r canonical structure)", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".agents", "commands"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).not.toContain("amp");
    });

    it("detects Codex from .codex/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".codex"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("codex");
    });

    it("detects Gemini from .gemini/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".gemini"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("gemini");
    });

    it("detects Gemini from GEMINI.md", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, "GEMINI.md"), "# Gemini");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("gemini");
    });

    it("detects Cline from .clinerules", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, ".clinerules"), "rules");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("cline");
    });

    it("detects Cline from .roo directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".roo"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("cline");
    });

    it("detects Cline from .roomodes", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, ".roomodes"), "{}");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("cline");
    });

    it("detects Aider from .aider.conf.yml", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, ".aider.conf.yml"), "read: []");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("aider");
    });

    it("detects Kiro from .kiro/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".kiro"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("kiro");
    });

    it("detects Goose from .goosehints", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, ".goosehints"), "hints");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("goose");
    });

    it("detects Goose from .goose/ directory", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".goose"), { recursive: true });

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("goose");
    });

    it("detects Zed from .rules file", async () => {
      const root = await createTempRepo();
      await writeFile(join(root, ".rules"), "zed rules");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("zed");
    });

    it("returns empty array when no tools detected", async () => {
      const root = await createTempRepo();

      const info = await analyzeRepo(root);
      expect(info.existingTools).toEqual([]);
    });

    it("detects multiple tools simultaneously", async () => {
      const root = await createTempRepo();
      await mkdir(join(root, ".cursor"), { recursive: true });
      await writeFile(join(root, "CLAUDE.md"), "# Claude");
      await writeFile(join(root, ".windsurfrules"), "rules");

      const info = await analyzeRepo(root);
      expect(info.existingTools).toContain("cursor");
      expect(info.existingTools).toContain("claude");
      expect(info.existingTools).toContain("windsurf");
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
      isMonorepo: true,
      hasExistingAgents: false,
      existingTools: ["cursor"],
      rootDir: "/test",
    });

    expect(summary).toContain("typescript, python");
    expect(summary).toContain("npm");
    expect(summary).toContain("Monorepo: yes");
    expect(summary).toContain("Existing .agents/: no");
    expect(summary).toContain("cursor");
  });

  it("omits existing tools line when none detected", () => {
    const summary = formatRepoSummary({
      languages: ["unknown"],
      packageManager: "unknown",
      isMonorepo: false,
      hasExistingAgents: false,
      existingTools: [],
      rootDir: "/test",
    });

    expect(summary).not.toContain("Existing tool configs");
    expect(summary).toContain("Monorepo: no");
  });
});
