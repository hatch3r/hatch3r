import type { Tool } from "../types.js";
import type { Adapter } from "./base.js";
import { AiderAdapter } from "./aider.js";
import { AmpAdapter } from "./amp.js";
import { ClaudeAdapter } from "./claude.js";
import { ClineAdapter } from "./cline.js";
import { CodexAdapter } from "./codex.js";
import { CopilotAdapter } from "./copilot.js";
import { CursorAdapter } from "./cursor.js";
import { GeminiAdapter } from "./gemini.js";
import { GooseAdapter } from "./goose.js";
import { KiroAdapter } from "./kiro.js";
import { OpenCodeAdapter } from "./opencode.js";
import { WindsurfAdapter } from "./windsurf.js";
import { ZedAdapter } from "./zed.js";

const adapters: Record<Tool, Adapter> = {
  cursor: new CursorAdapter(),
  copilot: new CopilotAdapter(),
  claude: new ClaudeAdapter(),
  opencode: new OpenCodeAdapter(),
  windsurf: new WindsurfAdapter(),
  amp: new AmpAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  cline: new ClineAdapter(),
  aider: new AiderAdapter(),
  kiro: new KiroAdapter(),
  goose: new GooseAdapter(),
  zed: new ZedAdapter(),
};

export function getAdapter(tool: Tool): Adapter {
  const adapter = adapters[tool];
  if (!adapter) {
    throw new Error(`Unknown tool: ${tool}`);
  }
  return adapter;
}

export { AiderAdapter } from "./aider.js";
export { AmpAdapter } from "./amp.js";
export { ClaudeAdapter } from "./claude.js";
export { ClineAdapter } from "./cline.js";
export { CodexAdapter } from "./codex.js";
export { CopilotAdapter } from "./copilot.js";
export { CursorAdapter } from "./cursor.js";
export { GeminiAdapter } from "./gemini.js";
export { GooseAdapter } from "./goose.js";
export { KiroAdapter } from "./kiro.js";
export { OpenCodeAdapter } from "./opencode.js";
export { WindsurfAdapter } from "./windsurf.js";
export { ZedAdapter } from "./zed.js";
export type { Adapter } from "./base.js";
export { readCanonicalFiles } from "./canonical.js";
export type { CanonicalType } from "./canonical.js";
