import chalk from "chalk";
import { printBanner, info } from "../shared/ui.js";

export async function addCommand(): Promise<void> {
  printBanner(true);
  // Wave 7: the integrity-manifest preflight that previously gated `add` was
  // removed along with the integrity subsystem. The command is still a
  // placeholder advertising the community-pack roadmap; when the body is
  // wired up, drift gating should reuse `computeAdapterDrift` from
  // `status.ts` instead of the deleted `verifyIntegrity` helper.
  //
  // D1-SA1.3-F2 (Medium, P1): the `--force` option and the exit-1
  // "integrity drift blocked" help row were removed from the `add`
  // registration in program.ts in the same pass — the stub reads no options
  // and only exits 0, so advertising an integrity-override flag and a
  // drift-block exit code contradicted the body. Re-add the option + its
  // handling here when the pack installer lands.

  // C8-D1-M8 (D1-SA1.3.1, P1): `hatch3r add` is advertised in `--help` as a
  // community-pack installer that is not yet shipped. Exiting with code 2
  // (usage error per Bash/sysexits) misrepresents a valid invocation as user
  // misuse and trips CI pipelines that probe the subcommand. Return cleanly
  // (exit 0) with an informational notice plus a roadmap pointer — this
  // satisfies P1 actionable-error guidance (the user has an action: track
  // the repo's releases / discussions) without pretending the feature is
  // done.
  //
  // Sources re-verified 2026-04-20:
  //   - https://tldp.org/LDP/abs/html/exitcodes.html (exit 2 = Bash misuse)
  //   - https://man.freebsd.org/cgi/man.cgi?query=sysexits (EX_OK = 0)
  //
  // F15.4-H3 (Cycle 10 D15-SA15.4): governance/pack-trust-model.md §1
  // documents body-scan + lifecycle-script ban + capability validation
  // gates that this stub does NOT execute. The pack-trust-model.md §1
  // banner labels the document SPEC ONLY so end-users do not infer a
  // runtime safety net that is absent until this command is wired. When
  // implementing, replicate the §3 + §4 + §5 gates here BEFORE unpacking
  // pack content under `.hatch3r/overrides/`.
  console.log();
  info("Community pack installation is coming in a future hatch3r release.");
  console.log(chalk.dim("  Track progress: https://github.com/hatch3r/hatch3r/releases"));
  console.log(chalk.dim("  Discuss packs:  https://github.com/hatch3r/hatch3r/discussions"));
  console.log();
}
