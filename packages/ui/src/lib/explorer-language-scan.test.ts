import { describe, expect, it, vi } from "vitest";
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
      resultVersion: 1,
      stale: false,
      scannedAt: 100,
    });
    expect(getExplorerLanguageScanCache(queryClient, "beta")).toBeUndefined();
  });

  it("keeps a completed scan stale when an event arrives during the scan", () => {
    const queryClient = new QueryClient();
    const scanToken = beginExplorerLanguageScan(queryClient, "alpha");

    markExplorerLanguageScanStale(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", scanToken, result, 200);

    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toEqual({
      result,
      generation: 1,
      resultVersion: 1,
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

  it("increments the result version for a same-generation rescan", () => {
    const queryClient = new QueryClient();
    const first = beginExplorerLanguageScan(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", first, result, 100);
    const second = beginExplorerLanguageScan(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", second, result, 200);

    expect(getExplorerLanguageScanCache(queryClient, "alpha")).toMatchObject({
      generation: 0,
      resultVersion: 2,
      stale: false,
      scannedAt: 200,
    });
  });

  it("does not recreate removed project scans after workspace cleanup", async () => {
    const queryClient = new QueryClient();
    const oldToken = beginExplorerLanguageScan(queryClient, "alpha");
    await removeExplorerLanguageScanCaches(queryClient);
    const currentToken = beginExplorerLanguageScan(queryClient, "alpha");

    commitExplorerLanguageScan(queryClient, "alpha", oldToken, result, 100);
    expect(
      getExplorerLanguageScanCache(queryClient, "alpha")?.result,
    ).toBeNull();

    commitExplorerLanguageScan(queryClient, "alpha", currentToken, result, 100);
    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.result).toEqual(
      result,
    );
  });

  it("reports a discarded response after workspace cleanup", async () => {
    const queryClient = new QueryClient();
    let resolveScan: ((value: LanguageFilesResponse) => void) | undefined;
    const scan = scanExplorerLanguageFiles(
      queryClient,
      "alpha",
      () =>
        new Promise<LanguageFilesResponse>((resolve) => {
          resolveScan = resolve;
        }),
    );

    await removeExplorerLanguageScanCaches(queryClient);
    resolveScan?.(result);

    await expect(scan).resolves.toEqual({
      committed: false,
      cache: undefined,
    });
  });

  it("does not remove a scan started while workspace cleanup is pending", async () => {
    const queryClient = new QueryClient();
    let resolveReset!: () => void;
    const removeQueries = vi.spyOn(queryClient, "removeQueries");
    vi.spyOn(queryClient, "resetQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );

    const cleanup = removeExplorerLanguageScanCaches(queryClient);
    const scanToken = beginExplorerLanguageScan(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", scanToken, result, 100);

    resolveReset();
    await cleanup;

    expect(removeQueries).not.toHaveBeenCalled();
    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.result).toEqual(
      result,
    );
  });

  it("ignores late events from the previous workspace epoch", async () => {
    const queryClient = new QueryClient();
    const oldEpoch = beginExplorerLanguageScan(
      queryClient,
      "alpha",
    ).workspaceEpoch;
    await removeExplorerLanguageScanCaches(queryClient);
    const currentToken = beginExplorerLanguageScan(queryClient, "alpha");
    commitExplorerLanguageScan(queryClient, "alpha", currentToken, result, 100);

    markExplorerLanguageScanStale(queryClient, "alpha", oldEpoch);

    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.stale).toBe(
      false,
    );
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
    const secondRun = await second;
    resolveFirst?.(firstResult);
    const firstRun = await first;

    expect(secondRun).toMatchObject({
      committed: true,
      cache: { result: secondResult, resultVersion: 1 },
    });
    expect(firstRun).toMatchObject({
      committed: false,
      cache: { result: secondResult, resultVersion: 1 },
    });
    expect(getExplorerLanguageScanCache(queryClient, "alpha")?.result).toEqual(
      secondResult,
    );
  });
});
