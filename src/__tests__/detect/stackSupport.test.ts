import { describe, it, expect } from "vitest";
import {
  FRAMEWORK_SUPPORT,
  LANGUAGE_SUPPORT,
  classifyFramework,
  classifyLanguage,
  classifyDetectedStacks,
} from "../../detect/stackSupport.js";
import type { Framework } from "../../types.js";

// D14-15 (D14-SA14.1-F4): tech-stack support-tier classification.
describe("stackSupport classification", () => {
  it("full-tier frameworks carry a dedicated rule id", () => {
    expect(classifyFramework("django")).toEqual({ tier: "full", rule: "hatch3r-python-patterns" });
    expect(classifyFramework("rails")).toEqual({ tier: "full", rule: "hatch3r-ruby-rails-patterns" });
    expect(classifyFramework("axum")).toEqual({ tier: "full", rule: "hatch3r-rust-patterns" });
    expect(classifyFramework("laravel")).toEqual({ tier: "full", rule: "hatch3r-php-laravel-patterns" });
  });

  it("JS/TS web frameworks are partial (cross-cutting rules only, no dedicated rule)", () => {
    for (const fw of ["next", "react", "vue", "svelte", "angular", "nuxt"] as Framework[]) {
      expect(classifyFramework(fw)).toEqual({ tier: "partial" });
    }
  });

  it("Spring and Phoenix are partial", () => {
    expect(classifyFramework("spring")).toEqual({ tier: "partial" });
    expect(classifyFramework("phoenix")).toEqual({ tier: "partial" });
  });

  it("full-tier languages carry a dedicated rule id", () => {
    expect(classifyLanguage("go")).toEqual({ tier: "full", rule: "hatch3r-go-patterns" });
    expect(classifyLanguage("csharp")).toEqual({ tier: "full", rule: "hatch3r-dotnet-patterns" });
    expect(classifyLanguage("kotlin")).toEqual({ tier: "full", rule: "hatch3r-android-patterns" });
  });

  it("unmapped languages fall through to partial", () => {
    expect(classifyLanguage("typescript")).toEqual({ tier: "partial" });
    expect(classifyLanguage("elixir")).toEqual({ tier: "partial" });
    expect(classifyLanguage("scala")).toEqual({ tier: "partial" });
  });

  it("FRAMEWORK_SUPPORT classifies every Framework union member (drift guard)", () => {
    // Each entry must have a valid tier; full entries must name a rule, partial/none must not.
    for (const [name, support] of Object.entries(FRAMEWORK_SUPPORT)) {
      expect(["full", "partial", "none"]).toContain(support.tier);
      if (support.tier === "full") {
        expect(support.rule, `${name} is full but has no rule`).toMatch(/^hatch3r-.*-patterns$/);
      } else {
        expect(support.rule, `${name} is ${support.tier} but names a rule`).toBeUndefined();
      }
    }
  });

  it("LANGUAGE_SUPPORT full entries all reference an existing *-patterns rule id", () => {
    for (const [name, support] of Object.entries(LANGUAGE_SUPPORT)) {
      expect(support.tier, `${name} listed in LANGUAGE_SUPPORT should be full`).toBe("full");
      expect(support.rule).toMatch(/^hatch3r-.*-patterns$/);
    }
  });

  it("java classifies as partial and is never routed to the Android mobile rule (D14-SA14.1-01)", () => {
    // Server-side Java (Spring Boot / Jakarta EE / Quarkus) is the dominant use
    // of Java; the Android Kotlin patterns rule (Compose / Room / Hilt) covers
    // none of it. java must stay partial so a bare-Java repo gets the honest
    // "no dedicated rule" pointer instead of a false "full → Android" claim.
    const java = classifyLanguage("java");
    expect(java.tier).toBe("partial");
    expect(java.rule).toBeUndefined();
    // Belt-and-suspenders: if java is ever re-added to LANGUAGE_SUPPORT, it must
    // never point at a mobile rule. `?? ""` keeps the guard green while java is
    // absent (its intended state) and red the moment it names an Android/mobile
    // rule again.
    expect(LANGUAGE_SUPPORT.java?.rule ?? "").not.toMatch(/android|flutter|swiftui/);
  });
});

describe("classifyDetectedStacks", () => {
  it("returns empty for a fully-supported stack (django + python)", () => {
    expect(classifyDetectedStacks(["django"], ["python"])).toEqual([]);
  });

  it("surfaces a partial framework (angular) with axis + tier", () => {
    const out = classifyDetectedStacks(["angular"], ["typescript"]);
    expect(out).toContainEqual({ name: "angular", axis: "framework", tier: "partial" });
  });

  it("surfaces both spring and java on a Java/Spring repo (neither has a dedicated rule)", () => {
    const out = classifyDetectedStacks(["spring"], ["java"]);
    // spring is partial on the framework axis and java is partial on the
    // language axis (server-side Java is not covered by the Android rule), so
    // both surface and the init pointer gives the honest "no dedicated rule"
    // signal for each (D14-SA14.1-01).
    expect(out.map((s) => s.name)).toEqual(["spring", "java"]);
    expect(out).toContainEqual({ name: "java", axis: "language", tier: "partial" });
  });

  it("drops the unknown language sentinel", () => {
    expect(classifyDetectedStacks([], ["unknown"])).toEqual([]);
  });

  it("de-duplicates and lists frameworks before languages", () => {
    const out = classifyDetectedStacks(["vue", "express"], ["typescript", "elixir"]);
    const names = out.map((s) => s.name);
    // frameworks first, then partial languages; no duplicates.
    expect(names).toEqual(["vue", "express", "typescript", "elixir"]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not re-report a language already covered by a full-tier framework", () => {
    // fastapi -> hatch3r-python-patterns (full); python must not appear as partial.
    const out = classifyDetectedStacks(["fastapi"], ["python"]);
    expect(out).toEqual([]);
  });
});
