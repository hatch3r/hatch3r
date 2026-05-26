import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sanitizeInput,
  isWSL,
  TOOL_DISPLAY_NAMES,
  TOOL_PROMPT_CHOICES,
  FEATURE_CHOICES,
  MCP_CHOICES,
  PLATFORM_DISPLAY_NAMES,
  PLATFORM_MCP_SERVER,
  formatCommandHint,
  formatCommandHintByTool,
  TOOL_SECRET_NOTES,
  TOOL_COMMAND_SYNTAX,
} from "../../cli/shared/constants.js";

describe("sanitizeInput", () => {
  it("passes through valid alphanumeric characters unchanged", () => {
    expect(sanitizeInput("hello123")).toBe("hello123");
  });

  it("strips special characters", () => {
    expect(sanitizeInput("hello!@#$%^&*()world")).toBe("helloworld");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeInput("")).toBe("");
  });

  it("allows hyphens and underscores", () => {
    expect(sanitizeInput("my-project_name")).toBe("my-project_name");
  });

  it("allows dots", () => {
    expect(sanitizeInput("file.name.txt")).toBe("file.name.txt");
  });

  it("only valid characters remain after sanitization", () => {
    expect(sanitizeInput("a/b c<d>e|f")).toBe("abcdef");
  });

  it("handles strings with only invalid characters", () => {
    expect(sanitizeInput("!@#$%^&*()")).toBe("");
  });
});

describe("isWSL", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns true when WSL_DISTRO_NAME is set", () => {
    process.env.WSL_DISTRO_NAME = "Ubuntu";
    expect(isWSL()).toBe(true);
  });

  it("returns false on normal macOS/Linux without WSL env", () => {
    delete process.env.WSL_DISTRO_NAME;
    // On macOS/Linux (where these tests run), /proc/version either
    // doesn't exist or doesn't contain "microsoft"/"wsl"
    expect(isWSL()).toBe(false);
  });
});

describe("data constants", () => {
  it("TOOL_DISPLAY_NAMES matches snapshot", () => {
    expect(TOOL_DISPLAY_NAMES).toMatchSnapshot();
  });

  it("TOOL_PROMPT_CHOICES matches snapshot", () => {
    expect(TOOL_PROMPT_CHOICES).toMatchSnapshot();
  });

  it("FEATURE_CHOICES matches snapshot", () => {
    expect(FEATURE_CHOICES).toMatchSnapshot();
  });

  it("MCP_CHOICES matches snapshot", () => {
    expect(MCP_CHOICES).toMatchSnapshot();
  });

  it("PLATFORM_DISPLAY_NAMES matches snapshot", () => {
    expect(PLATFORM_DISPLAY_NAMES).toMatchSnapshot();
  });

  it("PLATFORM_MCP_SERVER matches snapshot", () => {
    expect(PLATFORM_MCP_SERVER).toMatchSnapshot();
  });
});

describe("formatCommandHint", () => {
  it("returns slash syntax when all tools use slash commands", () => {
    expect(formatCommandHint(["cursor", "claude"], "project-spec")).toBe("/project-spec");
  });

  it("returns slash syntax for single slash-command tool", () => {
    expect(formatCommandHint(["claude"], "review")).toBe("/review");
  });

  it("returns single slash invocation when all 3 retained tools share / syntax", () => {
    expect(formatCommandHint(["cursor", "copilot", "claude"], "scan")).toBe("/scan");
  });

  it("returns no embedded newlines so it stays drop-in safe for box renderers", () => {
    const out = formatCommandHint(["cursor", "claude", "copilot"], "project-spec");
    expect(out).not.toContain("\n");
  });

  it("returns a generic phrasing on empty tools array", () => {
    expect(formatCommandHint([], "review")).toBe("the review command");
  });
});

describe("formatCommandHintByTool", () => {
  it("returns one entry per requested tool with the exact invocation string", () => {
    const out = formatCommandHintByTool(["claude", "cursor", "copilot"], "codebase-map");
    expect(out).toEqual({
      claude: "/codebase-map",
      cursor: "/codebase-map",
      copilot: "/codebase-map",
    });
  });

  it("returns an empty object when no tools are provided", () => {
    expect(formatCommandHintByTool([], "anything")).toEqual({});
  });

  it("handles a single tool", () => {
    expect(formatCommandHintByTool(["claude"], "review")).toEqual({ claude: "/review" });
  });
});

describe("TOOL_COMMAND_SYNTAX", () => {
  it("has an entry for every tool in TOOL_DISPLAY_NAMES", () => {
    for (const tool of Object.keys(TOOL_DISPLAY_NAMES)) {
      expect(TOOL_COMMAND_SYNTAX).toHaveProperty(tool);
    }
  });
});

describe("TOOL_SECRET_NOTES", () => {
  it("provides notes for common tools", () => {
    expect(TOOL_SECRET_NOTES.cursor).toBeDefined();
    expect(TOOL_SECRET_NOTES.claude).toBeDefined();
    expect(TOOL_SECRET_NOTES.copilot).toBeDefined();
  });

  it("most notes mention .env.mcp or sourcing", () => {
    for (const note of Object.values(TOOL_SECRET_NOTES)) {
      if (note) expect(note).toMatch(/\.env\.mcp|sourcing|settings/);
    }
  });
});
