import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActiveProfile,
  getProfiles,
  migrateToProfiles,
  setServerUrl,
} from "./server-config.js";

function mockStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("server profile migration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    vi.stubGlobal("sessionStorage", mockStorage());
    vi.stubGlobal("crypto", { randomUUID: () => "profile-id" });
    vi.stubGlobal("location", {
      protocol: "http:",
      host: "127.0.0.1:4800",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:4800",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates a legacy cross-origin URL into the active profile", () => {
    setServerUrl("http://localhost:4800/");

    migrateToProfiles();

    expect(getProfiles()).toEqual([
      {
        id: "profile-id",
        name: "Default Server",
        url: "http://localhost:4800",
        authType: "basic",
        username: undefined,
        createdAt: expect.any(Number),
      },
    ]);
    expect(getActiveProfile()?.id).toBe("profile-id");
  });

  it("migrates a legacy same-origin URL instead of forcing setup", () => {
    setServerUrl("http://127.0.0.1:4800");

    migrateToProfiles();

    expect(getProfiles()).toHaveLength(1);
    expect(getActiveProfile()?.url).toBe("http://127.0.0.1:4800");
  });
});
