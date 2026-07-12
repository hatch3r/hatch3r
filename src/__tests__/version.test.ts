import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { HATCH3R_VERSION, readPackageVersion } from "../version.js";

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
const pkgVersion = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;

describe("version resolution (D1-SA1.4-09)", () => {
  it("readPackageVersion() reads the real version from package.json under ESM", () => {
    // Regression guard: the prior require()-based fallback threw "require is not
    // defined" under this package's "type":"module" and returned the
    // "0.0.0-dev" sentinel on every tsx run. The ESM read must resolve the real
    // package version instead.
    const v = readPackageVersion();
    expect(v).toBe(pkgVersion);
    expect(v).not.toBe("0.0.0-dev");
  });

  it("HATCH3R_VERSION resolves to the package version, never the dev sentinel", () => {
    // Under vitest the tsup/vitest `__VERSION__` define supplies the version;
    // under tsx the ESM fallback does. Either way it equals package.json and is
    // never the sentinel.
    expect(HATCH3R_VERSION).toBe(pkgVersion);
    expect(HATCH3R_VERSION).not.toBe("0.0.0-dev");
  });
});
