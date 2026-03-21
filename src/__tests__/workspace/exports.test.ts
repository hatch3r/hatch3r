/**
 * Workspace Public Exports Tests (D3-6)
 *
 * Verifies that workspace/index.ts re-exports all expected public API
 * and that workspace/types.ts constants are correct.
 */
import { describe, it, expect } from "vitest";
import * as workspaceExports from "../../workspace/index.js";
import {
  WORKSPACE_MANIFEST_FILE,
  WORKSPACE_MANIFEST_VERSION,
} from "../../workspace/types.js";

describe("workspace index.ts public exports", () => {
  // ── Constants ──

  it("exports WORKSPACE_MANIFEST_FILE", () => {
    expect(workspaceExports.WORKSPACE_MANIFEST_FILE).toBe("workspace.json");
  });

  it("exports WORKSPACE_MANIFEST_VERSION", () => {
    expect(workspaceExports.WORKSPACE_MANIFEST_VERSION).toBe("1.0.0");
  });

  // ── Manifest functions ──

  it("exports readWorkspaceManifest as a function", () => {
    expect(typeof workspaceExports.readWorkspaceManifest).toBe("function");
  });

  it("exports writeWorkspaceManifest as a function", () => {
    expect(typeof workspaceExports.writeWorkspaceManifest).toBe("function");
  });

  it("exports createWorkspaceManifest as a function", () => {
    expect(typeof workspaceExports.createWorkspaceManifest).toBe("function");
  });

  // ── Detect functions ──

  it("exports detectSubRepos as a function", () => {
    expect(typeof workspaceExports.detectSubRepos).toBe("function");
  });

  it("exports detectWorkspaceContext as a function", () => {
    expect(typeof workspaceExports.detectWorkspaceContext).toBe("function");
  });

  it("exports shouldSuggestWorkspace as a function", () => {
    expect(typeof workspaceExports.shouldSuggestWorkspace).toBe("function");
  });

  it("exports isWorkspaceRoot as a function", () => {
    expect(typeof workspaceExports.isWorkspaceRoot).toBe("function");
  });

  // ── Resolve functions ──

  it("exports resolveRepoConfig as a function", () => {
    expect(typeof workspaceExports.resolveRepoConfig).toBe("function");
  });

  it("exports buildSelectionFromIds as a function", () => {
    expect(typeof workspaceExports.buildSelectionFromIds).toBe("function");
  });

  // ── Sync function ──

  it("exports syncWorkspaceRepos as a function", () => {
    expect(typeof workspaceExports.syncWorkspaceRepos).toBe("function");
  });

  // ── Git functions ──

  it("exports parseGitRemote as a function", () => {
    expect(typeof workspaceExports.parseGitRemote).toBe("function");
  });

  it("exports parseGitDefaultBranch as a function", () => {
    expect(typeof workspaceExports.parseGitDefaultBranch).toBe("function");
  });

  it("exports getGitRemoteUrl as a function", () => {
    expect(typeof workspaceExports.getGitRemoteUrl).toBe("function");
  });

  it("exports detectPlatformFromRemote as a function", () => {
    expect(typeof workspaceExports.detectPlatformFromRemote).toBe("function");
  });

  it("exports detectRepoGitIdentity as a function", () => {
    expect(typeof workspaceExports.detectRepoGitIdentity).toBe("function");
  });

  // ── Completeness check ──

  it("has the expected number of public exports", () => {
    const exportNames = Object.keys(workspaceExports);
    // 2 constants + 3 manifest + 4 detect + 2 resolve + 1 sync + 5 git = 17
    expect(exportNames.length).toBe(17);
  });
});

describe("workspace types.ts constants", () => {
  it("WORKSPACE_MANIFEST_FILE is workspace.json", () => {
    expect(WORKSPACE_MANIFEST_FILE).toBe("workspace.json");
  });

  it("WORKSPACE_MANIFEST_VERSION is a valid semver string", () => {
    expect(WORKSPACE_MANIFEST_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("constants from types.ts match re-exports from index.ts", () => {
    expect(WORKSPACE_MANIFEST_FILE).toBe(workspaceExports.WORKSPACE_MANIFEST_FILE);
    expect(WORKSPACE_MANIFEST_VERSION).toBe(workspaceExports.WORKSPACE_MANIFEST_VERSION);
  });
});
