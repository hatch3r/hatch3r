import chalk from "chalk";
import { info } from "../shared/ui.js";
import { beginCommand, finishCommand } from "../shared/commandOutput.js";
import { planPackInstall, applyPackInstall } from "../../install/packInstall.js";

/**
 * CL-2 U12 (D5-SA5.3-09, Cycle 12): `hatch3r add <pack>` wired from roadmap
 * stub to the v1 pack installer (spec:
 * .audit-workspace/content-specs/add-pack-wiring.spec.md). Two source tiers —
 * local directory and already-installed npm package (resolved from
 * node_modules/, hatch3r never fetches) — with every static trust gate run
 * BEFORE any write: manifest field validation, signing declaration (or the
 * explicit --allow-untrusted override, recorded in the install ledger),
 * SHA-256 integrity map, lifecycle-script ban, deny-pattern body scan,
 * capability/footprint/declared-tools checks, path-traversal guards.
 * Materialization is atomic per file (safeWriteFile) with whole-batch
 * rollback; the install record lands at .hatch3r/packs/<pack_id>.json.
 *
 * Preserved repaired semantics (C8-D1-M8 + D1-SA1.3-F2, sources re-verified
 * 2026-04-20: tldp.org/LDP/abs/html/exitcodes.html — exit 2 = Bash misuse;
 * man.freebsd.org sysexits — EX_OK = 0):
 *   - a bare `hatch3r add` (no pack argument) is a valid probe invocation,
 *     NOT user misuse: it prints an informational usage notice and exits 0,
 *     so feature-probing CI pipelines keep seeing a clean exit;
 *   - real usage errors (an invalid --format value) exit 2 via
 *     parseFormatOption inside beginCommand;
 *   - no `--force` option exists (D1-20): the retired integrity-manifest
 *     override is not re-introduced — collisions with files this pack does
 *     not own refuse install (exit 64), and the unsigned-pack override is
 *     the separate, explicit `--allow-untrusted`;
 *   - drift-class refusals (unsigned pack, SHA-256 mismatch) exit 73
 *     (INTEGRITY_ERROR), the same class `verify` uses for
 *     regeneration-mismatch blocks.
 *
 * F15.4-H3 closure: the trust-model gates this file previously documented as
 * NOT executing (its stub-era comment block) now run in
 * `src/install/packInstall.ts::planPackInstall` before any byte is written.
 */

export interface AddCommandOptions {
  format?: string;
  quiet?: boolean;
  dryRun?: boolean;
  allowUntrusted?: boolean;
}

export async function addCommand(pack?: string, opts: AddCommandOptions = {}): Promise<void> {
  const startMs = Date.now();
  const format = beginCommand(opts, { banner: "compact" });

  if (pack === undefined || pack.trim() === "") {
    // C8-D1-M8 probe contract: informational, exit 0.
    if (format === "human") {
      console.log();
      info("Install a community pack: hatch3r add <./local-path | npm-package-name>");
      console.log(chalk.dim("  Local packs:  a directory containing pack-manifest.json"));
      console.log(chalk.dim("  npm packs:    already installed under node_modules/ (hatch3r never runs npm install)"));
      console.log(chalk.dim("  Preview:      hatch3r add <pack> --dry-run"));
      console.log();
      return;
    }
    finishCommand(format, {
      command: "add",
      title: "hatch3r add",
      style: "info",
      lines: [],
      json: {
        installed: false,
        usage: "hatch3r add <./local-path | npm-package-name> [--dry-run] [--allow-untrusted]",
      },
    });
    return;
  }

  const plan = await planPackInstall(process.cwd(), pack, {
    allowUntrusted: opts.allowUntrusted === true,
  });
  const gateLines = Object.entries(plan.gates).map(
    ([gate, outcome]) => `${gate}: ${outcome}`,
  );

  if (opts.dryRun === true) {
    finishCommand(format, {
      command: "add",
      title: `Dry run — pack ${plan.manifest.pack_id}@${plan.manifest.version}`,
      style: "info",
      lines: [
        `Source: ${plan.source.kind} (${plan.source.reference})`,
        `All trust gates passed (${gateLines.join(", ")})`,
        `Write set (${plan.writeSet.length} file${plan.writeSet.length === 1 ? "" : "s"}, nothing written):`,
        ...plan.writeSet.map((e) => `  ${e.action === "create" ? "+" : "~"} ${e.path}`),
      ],
      nextSteps: [`Run \`hatch3r add ${pack}\` without --dry-run to install`],
      startMs,
      json: {
        dryRun: true,
        pack: plan.manifest.pack_id,
        version: plan.manifest.version,
        source: plan.source.kind,
        gates: plan.gates,
        files: plan.writeSet,
      },
    });
    return;
  }

  const applied = await applyPackInstall(process.cwd(), plan);
  finishCommand(format, {
    command: "add",
    title: `Pack installed: ${plan.manifest.pack_id}@${plan.manifest.version}`,
    lines: [
      `Source: ${plan.source.kind} (${plan.source.reference})`,
      `Trust gates: ${gateLines.join(", ")}`,
      ...(plan.allowUntrusted
        ? [chalk.yellow("Installed with --allow-untrusted (no signing declaration) — recorded in the ledger")]
        : []),
      `Files written (${applied.results.length}):`,
      ...plan.writeSet.map((e) => `  ${e.action === "create" ? "+" : "~"} ${e.path}`),
      `Install record: ${applied.ledgerRelPath}`,
    ],
    style: "success",
    nextSteps: [
      "Run `hatch3r sync` to fold the new overrides into your adapter outputs",
      "Run `hatch3r validate` to check the installed content",
    ],
    startMs,
    json: {
      dryRun: false,
      pack: plan.manifest.pack_id,
      version: plan.manifest.version,
      source: plan.source.kind,
      allowUntrusted: plan.allowUntrusted,
      gates: plan.gates,
      files: plan.writeSet,
      ledger: applied.ledgerRelPath,
    },
  });
}
