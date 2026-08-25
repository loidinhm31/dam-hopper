// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadBrowserDebugAddressHistory,
  recordBrowserDebugAddress,
} from "./browser-debug-address-history.js";

const STORAGE_KEY = "dam-hopper:browser-debug-address-history";

describe("browser debug address history", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("stores trusted-looking HTTP addresses as unique recent suggestions", () => {
    recordBrowserDebugAddress("http://localhost:3000/projects");
    recordBrowserDebugAddress(
      "https://example.trycloudflare.com/logs?token=secret#access_token=secret",
    );
    recordBrowserDebugAddress("http://localhost:3000/projects");

    expect(loadBrowserDebugAddressHistory()).toEqual([
      "http://localhost:3000/projects",
      "https://example.trycloudflare.com/logs",
    ]);
  });

  it("ignores malformed, credentialed, and corrupt stored values", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: ["not a url", "https://user:secret@example.test", "https://ok.test/path"],
      }),
    );

    expect(loadBrowserDebugAddressHistory()).toEqual(["https://ok.test/path"]);
  });
});
