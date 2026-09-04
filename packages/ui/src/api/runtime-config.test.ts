// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchRuntimeConfig,
  validateAndNormalizeApiUrl,
  validateRuntimeConfig,
} from "./runtime-config.js";

describe("runtime-config validation", () => {
  it("validates a well-formed runtime configuration", () => {
    const valid = {
      schemaVersion: 1,
      releaseVersion: "0.1.0",
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      apiUrl: "http://127.0.0.1:4801",
    };
    const result = validateRuntimeConfig(valid);
    expect(result).toEqual({
      schemaVersion: 1,
      releaseVersion: "0.1.0",
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      apiUrl: "http://127.0.0.1:4801",
    });
  });
  it("accepts a runtime config without an API URL", () => {
    expect(
      validateRuntimeConfig({
        schemaVersion: 1,
        releaseVersion: "0.1.0",
        profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      }),
    ).toEqual({
      schemaVersion: 1,
      releaseVersion: "0.1.0",
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
    });
  });

  it("rejects unknown runtime config fields", () => {
    expect(
      validateRuntimeConfig({
        schemaVersion: 1,
        releaseVersion: "0.1.0",
        profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
        unexpected: true,
      }),
    ).toBeNull();
  });

  it("rejects invalid schema version", () => {
    expect(
      validateRuntimeConfig({
        schemaVersion: 2,
        releaseVersion: "0.1.0",
        profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
        apiUrl: "http://127.0.0.1:4801",
      }),
    ).toBeNull();
  });

  it("rejects invalid profileId", () => {
    expect(
      validateRuntimeConfig({
        schemaVersion: 1,
        releaseVersion: "0.1.0",
        profileId: "not-a-uuid",
        apiUrl: "http://127.0.0.1:4801",
      }),
    ).toBeNull();
  });

  it("rejects invalid releaseVersion", () => {
    expect(
      validateRuntimeConfig({
        schemaVersion: 1,
        releaseVersion: "   ",
        profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
        apiUrl: "http://127.0.0.1:4801",
      }),
    ).toBeNull();
  });

  it("normalizes API URLs and rejects credentials, query, and fragments", () => {
    expect(validateAndNormalizeApiUrl("http://127.0.0.1:4801/")).toBe(
      "http://127.0.0.1:4801",
    );
    expect(validateAndNormalizeApiUrl("https://api.example.com")).toBe(
      "https://api.example.com",
    );

    // Rejections
    expect(validateAndNormalizeApiUrl("ws://127.0.0.1:4801")).toBeNull();
    expect(validateAndNormalizeApiUrl("http://user:pass@127.0.0.1")).toBeNull();
    expect(
      validateAndNormalizeApiUrl("http://127.0.0.1:4801?query=1"),
    ).toBeNull();
    expect(validateAndNormalizeApiUrl("http://127.0.0.1:4801#frag")).toBeNull();
    expect(
      validateAndNormalizeApiUrl("http://127.0.0.1:4801/subpath"),
    ).toBeNull();
  });

  it("rejects non-object and array inputs", () => {
    expect(validateRuntimeConfig(null)).toBeNull();
    expect(validateRuntimeConfig(undefined)).toBeNull();
    expect(validateRuntimeConfig("string")).toBeNull();
    expect(validateRuntimeConfig(123)).toBeNull();
    expect(validateRuntimeConfig([])).toBeNull();
  });

  it("normalizes IPv6 API URLs and rejects non-http schemes", () => {
    expect(validateAndNormalizeApiUrl("http://[::1]:4801/")).toBe(
      "http://[::1]:4801",
    );
    expect(validateAndNormalizeApiUrl("javascript:alert(1)")).toBeNull();
    expect(
      validateAndNormalizeApiUrl("data:text/plain;base64,SGVsbG8="),
    ).toBeNull();
    expect(validateAndNormalizeApiUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("fetchRuntimeConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and validates runtime config with cache: no-store", async () => {
    const mockData = {
      schemaVersion: 1,
      releaseVersion: "0.1.0",
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      apiUrl: "http://127.0.0.1:4801",
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "120" }),
      text: () => Promise.resolve(JSON.stringify(mockData)),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchRuntimeConfig(
      "/__dam-hopper/runtime-config.json",
    );
    expect(result).toEqual(mockData);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/__dam-hopper/runtime-config.json",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("returns null on 404 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const result = await fetchRuntimeConfig();
    expect(result).toBeNull();
  });

  it("returns null on network error or timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure")),
    );

    const result = await fetchRuntimeConfig();
    expect(result).toBeNull();
  });

  it("returns null when payload exceeds 4 KiB", async () => {
    const largeData = {
      schemaVersion: 1,
      releaseVersion: "0.1.0",
      profileId: "c7325e68-07e1-4e44-8d96-b333a4658cf9",
      apiUrl: "http://127.0.0.1:4801",
      extra: "x".repeat(5000),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "5200" }),
        text: () => Promise.resolve(JSON.stringify(largeData)),
      }),
    );

    const result = await fetchRuntimeConfig();
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "20" }),
        text: () => Promise.resolve("{ malformed json"),
      }),
    );

    const result = await fetchRuntimeConfig();
    expect(result).toBeNull();
  });

  it("returns null on HTML error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-length": "50" }),
        text: () =>
          Promise.resolve(
            "<!doctype html><html><body>502 Bad Gateway</body></html>",
          ),
      }),
    );

    const result = await fetchRuntimeConfig();
    expect(result).toBeNull();
  });
});
