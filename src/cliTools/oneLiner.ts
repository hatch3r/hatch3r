import type { InstallPlan } from "./install.js";

/**
 * Package managers verified to accept multiple packages in one `install`
 * invocation. `winget` and `snap` take one pkg per call; `npm`/`curl` carry
 * flags or pipes, so they stay standalone.
 */
const GROUPABLE_MANAGERS: ReadonlySet<string> = new Set([
  "brew",
  "apt",
  "apt-get",
  "dnf",
  "yum",
  "pacman",
  "scoop",
  "cargo",
]);

const JOIN = " \\\n  && ";

interface ParsedInstall {
  prefix: string;
  pkg: string;
}

/**
 * Parse `command` into `{ prefix, pkg }` if it matches
 * `^(sudo\s+)?<manager>\s+install\s+<pkg>$` AND `<manager>` is groupable
 * AND matches `plan.manager`. Commands containing `&&`, `|`, `;` are
 * rejected so multi-step recipes (playwright npm+install, az-devops
 * extension-add) stay verbatim.
 */
function parseGroupable(command: string, manager: string | undefined): ParsedInstall | null {
  if (!manager || !GROUPABLE_MANAGERS.has(manager)) return null;
  if (command.includes("&&") || command.includes("|") || command.includes(";")) return null;
  const re = new RegExp(`^(sudo\\s+)?${manager}\\s+install\\s+(\\S+)$`);
  const match = command.match(re);
  if (!match) return null;
  const sudo = match[1] ?? "";
  const pkg = match[2];
  return { prefix: `${sudo}${manager} install`, pkg };
}

export function buildOneLiner(plans: readonly InstallPlan[]): string {
  if (plans.length === 0) return "";

  const groupOrder: string[] = [];
  const groups = new Map<string, string[]>();
  const standalones: string[] = [];

  for (const plan of plans) {
    if (!plan.command) {
      standalones.push(`# install ${plan.id} manually: see ${plan.homepage}`);
      continue;
    }
    const parsed = parseGroupable(plan.command, plan.manager);
    if (!parsed) {
      standalones.push(plan.command);
      continue;
    }
    const existing = groups.get(parsed.prefix);
    if (existing) {
      existing.push(parsed.pkg);
    } else {
      groupOrder.push(parsed.prefix);
      groups.set(parsed.prefix, [parsed.pkg]);
    }
  }

  const chunks: string[] = [];
  for (const prefix of groupOrder) {
    const pkgs = groups.get(prefix);
    if (!pkgs) continue;
    chunks.push(`${prefix} ${pkgs.join(" ")}`);
  }
  for (const cmd of standalones) {
    chunks.push(cmd);
  }

  if (chunks.length === 0) return "";
  return chunks.join(JOIN);
}
