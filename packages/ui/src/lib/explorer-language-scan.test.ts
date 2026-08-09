import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { LanguageFilesResponse } from "@/api/fs-types.js";
import {
  beginExplorerLanguageScan,
  commitExplorerLanguageScan,
  getExplorerLanguageScanCache,
  markExplorerLanguageScanStale,
  removeExplorerLanguageScanCaches,
} from "./explorer-language-scan.js";
import { scanExplorerLanguageFiles } from "@/api/queries.js";

const result: LanguageFilesResponse = {
  files: [
    {
      path: "src/main.rs",
      size: 12,
      mtime: 10,
      language: "rust",
    },
  ],
  truncated: false,
  limit: 20_000,
};

describe("explorer language scan cache", () => {
  it("isolates project entries and only creates cache on explicit scan start", () => {
    const queryClient = new QueryClient();

    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toBeUndefined();
    expect(getExplorerLanguageScanCache(queryClient, "beta")).toBeUndefined();
    markExplorerLanguageScanStale(queryClient, "alpha");
    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toBeUndefined();

    const scanToken = beginExplorerLanguageScan(queryClient, "alpha");
    expect(scanToken).toMatchObject({
      generation: 0,
      workspaceEpoch: 0,
      requestId: 1,
    });
    commitExplorerLanguageScan(queryClient, "alpha", scanToken, result, 100);

    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toEqual({
      result,
      generation: 0,
      stale: false,
      scannedAt: 100,
    });
    expect(getExplorerLanguageScanCache(queryClient, "beta")).toBeUndefined();
  });

  it("keeps a completed scan stale when an event arrives during the scan", () => {
    const queryClient = new QueryClient();
    const scanToken = beginExplorerLanguageScan(queryClient, "alpha");

    markExplorerLanguageScanStale(queryClient, "alpha");
    commitExplorerLanguageScan(
      queryClient,
      "alpha",
      scanToken,
      result,
      200,
    );

    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toEqual({
      result,
      generation: 1,
      stale: true,
      scannedAt: 200,
    });
  });

  it("preserves the usable result when a rescan fails", async () => {
    const queryClient = new QueryClient();
    const initialToken = beginExplorerLanguageScan(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", initialToken, result, 100);
    const before = getExplorerLanguageScanCache(queryClient, "alpha");

    await expect(
      scanExplorerLanguageFiles(queryClient, "alpha", async () => {
        throw new Error("scan failed");
      }),
    ).rejects.toThrow("scan failed");

    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toEqual(before);
  });

  it("does not recreate removed project scans after workspace cleanup", () => {
    const queryClient = new QueryClient();
    const oldToken = beginExplorerLanguageScan(queryClient, "alpha");
    removeExplorerLanguageScanCaches(queryClient);
    const currentToken = beginExplorerLanguageScan(queryClient, "alpha");

    commitExplorerLanguageScan(queryClient, "alpha", oldToken, result, 100);
    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.result).toBeNull();

    commitExplorerLanguageScan(queryClient, "alpha", currentToken, result, 100);
    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.result).toEqual(
      result,
    );
  });

  it("ignores late events from the previous workspace epoch", () => {
    const queryClient = new QueryClient();
    const oldEpoch = beginExplorerLanguageScan(queryClient, "alpha").workspaceEpoch;
    removeExplorerLanguageScanCaches(queryClient);
    const currentToken = beginExplorerLanguageScan(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", currentToken, result, 100);

    markExplorerLanguageScanStale(queryClient, "alpha", oldEpoch);

    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.stale).toBe(false);
  });

  it("commits only the latest concurrent rescan", async () => {
    const queryClient = new QueryClient();
    let resolveFirst: ((value: LanguageFilesResponse) => void) | undefined;
    let resolveSecond: ((value: LanguageFilesResponse) => void) | undefined;
    const firstResult = { ...result, files: [] };
    const secondResult = { ...result, truncated: true };

    const first = scanExplorerLanguageFiles(
      queryClient,
      "alpha",
      () =>
        new Promise<LanguageFilesResponse>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const second = scanExplorerLanguageFiles(
      queryClient,
      "alpha",
      () =>
        new Promise<LanguageFilesResponse>((resolve) => {
          resolveSecond = resolve;
        }),
    );

    resolveSecond?.(secondResult);
    await second;
    resolveFirst?.(firstResult);
    await first;

    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.result).toEqual(
      secondResult,
    );
  });
});
