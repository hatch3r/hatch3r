import { spawnSync } from "node:child_process";

export interface ClipboardResolver {
  /**
   * Returns the absolute path of `command` if found on PATH, or null otherwise.
   * Injectable so tests can simulate platforms with/without each tool.
   */
  which(command: string): string | null;
  /**
   * Spawns `command argv` synchronously, piping `input` to stdin. Returns true
   * on exit code 0, false otherwise. Injectable for the same reason.
   */
  run(command: string, argv: readonly string[], input: string): boolean;
}

const defaultResolver: ClipboardResolver = {
  which(command: string): string | null {
    const probe = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (probe.status !== 0) return null;
    const out = probe.stdout?.toString().trim();
    return out ? out.split(/\r?\n/)[0] : null;
  },
  run(command: string, argv: readonly string[], input: string): boolean {
    const result = spawnSync(command, argv, {
      input,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return result.status === 0;
  },
};

interface ClipboardCandidate {
  command: string;
  argv: readonly string[];
}

function candidatesForPlatform(platform: NodeJS.Platform): ClipboardCandidate[] {
  if (platform === "darwin") return [{ command: "pbcopy", argv: [] }];
  if (platform === "win32") return [{ command: "clip.exe", argv: [] }, { command: "clip", argv: [] }];
  return [
    { command: "wl-copy", argv: [] },
    { command: "xclip", argv: ["-selection", "clipboard"] },
    { command: "xsel", argv: ["--clipboard", "--input"] },
  ];
}

/**
 * Copies `text` to the system clipboard using the first available platform tool.
 * Returns the tool name on success, or null if no tool was found / all failed.
 * Never throws — clipboard is best-effort UX, not load-bearing.
 */
export function copyToClipboard(
  text: string,
  resolver: ClipboardResolver = defaultResolver,
  platform: NodeJS.Platform = process.platform,
): string | null {
  for (const candidate of candidatesForPlatform(platform)) {
    if (!resolver.which(candidate.command)) continue;
    if (resolver.run(candidate.command, candidate.argv, text)) {
      return candidate.command;
    }
  }
  return null;
}
