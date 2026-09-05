import { describe, expect, it } from "vitest";
import { DiagnosticsClient } from "./diagnostics-client.js";

class MemoryStorage {
  private values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

class MemoryWindow {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  public addEventListener(
    type: string,
    listener: (event: Event) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(
    type: string,
    listener: (event: Event) => void,
  ): void {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      this.listeners.delete(type);
    }
  }

  public dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("DiagnosticsClient", () => {
  it("persists entries and restores them after reload", () => {
    const storage = new MemoryStorage();
    const first = new DiagnosticsClient({
      storage,
      browserWindow: null,
      now: () => 1_000,
    });

    first.record("custom", "test", "before reload", { token: "secret" });
    const second = new DiagnosticsClient({
      storage,
      browserWindow: null,
      now: () => 2_000,
    });

    expect(second.snapshot().logs).toMatchObject([
      {
        type: "custom",
        scope: "test",
        message: "before reload",
        metadata: { token: "[REDACTED]" },
      },
    ]);
  });

  it("drops entries outside the retention window", () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const client = new DiagnosticsClient({
      storage,
      browserWindow: null,
      now: () => now,
      retentionMs: 1_000,
    });

    client.record("custom", "test", "old");
    now = 2_500;
    client.record("custom", "test", "new");

    expect(client.snapshot().logs.map((entry) => entry.message)).toEqual([
      "new",
    ]);
  });

  it("caps entries by count", () => {
    let now = 1_000;
    const client = new DiagnosticsClient({
      storage: new MemoryStorage(),
      browserWindow: null,
      now: () => now++,
      maxEntries: 2,
    });

    client.record("custom", "test", "first");
    client.record("custom", "test", "second");
    client.record("custom", "test", "third");

    expect(client.snapshot().logs.map((entry) => entry.message)).toEqual([
      "second",
      "third",
    ]);
  });

  it("trims the oldest entries to stay within the storage byte budget", () => {
    const client = new DiagnosticsClient({
      storage: new MemoryStorage(),
      browserWindow: null,
      now: () => 1_000,
      maxEntries: 10,
      maxStorageBytes: 250,
    });

    client.record("custom", "test", "first", { note: "x".repeat(80) });
    client.record("custom", "test", "second", { note: "y".repeat(80) });
    client.record("custom", "test", "third", { note: "z".repeat(80) });

    const messages = client.snapshot().logs.map((entry) => entry.message);
    expect(messages.length).toBeLessThan(3);
    expect(messages).not.toContain("first");
    expect(messages.at(-1)).toBe("third");
  });

  it("falls back to an empty ring when stored data is malformed", () => {
    const storage = new MemoryStorage();
    storage.setItem("damhopper_diagnostics_frontend_v1", "{bad json");

    const client = new DiagnosticsClient({
      storage,
      browserWindow: null,
      now: () => 1_000,
    });

    expect(client.snapshot().logs).toEqual([]);
  });

  it("redacts sensitive route and metadata values", () => {
    const client = new DiagnosticsClient({
      storage: new MemoryStorage(),
      browserWindow: null,
      now: () => 1_000,
    });

    client.recordRoute({
      path: "/workspace",
      search: "?token=abc123&project=demo",
      hash: "",
      href: "/workspace?token=abc123&project=demo",
    });
    client.record("custom", "test", "metadata", {
      nested: { password: "hunter2" },
      url: "https://example.test/?api_key=raw",
    });

    const snapshot = client.snapshot();
    expect(snapshot.currentRoute).toMatchObject({
      search: "?token=[REDACTED]&project=demo",
      href: "/workspace?token=[REDACTED]&project=demo",
    });
    expect(snapshot.logs.at(-1)?.metadata).toEqual({
      nested: { password: "[REDACTED]" },
      url: "https://example.test/?api_key=[REDACTED]",
    });
  });

  it("keeps browser errors in the browserErrors snapshot section", () => {
    const client = new DiagnosticsClient({
      storage: new MemoryStorage(),
      browserWindow: null,
      now: () => 1_000,
    });

    client.record("browser.error", "window", "boom", {
      error: new Error("bad secret=value"),
    });

    expect(client.snapshot().browserErrors).toHaveLength(1);
    expect(client.snapshot().browserErrors[0].metadata).toMatchObject({
      error: {
        message: "bad secret=[REDACTED]",
      },
    });
  });

  it("captures browser error and rejection events through initialize()", () => {
    const browserWindow = new MemoryWindow();
    const client = new DiagnosticsClient({
      storage: new MemoryStorage(),
      browserWindow,
      now: () => 1_000,
    });

    client.initialize();
    browserWindow.dispatch("error", {
      message: "render failed",
      filename: "app.tsx",
      lineno: 10,
      colno: 4,
      error: new Error("password=hunter2"),
    } as Event);
    browserWindow.dispatch("unhandledrejection", {
      reason: new Error("password=hunter2"),
    } as Event);
    client.dispose();
    browserWindow.dispatch("error", {
      message: "should be ignored",
    } as Event);

    const snapshot = client.snapshot();
    expect(snapshot.browserErrors).toHaveLength(2);
    expect(snapshot.browserErrors.map((entry) => entry.type)).toEqual([
      "browser.error",
      "browser.unhandledrejection",
    ]);
    expect(snapshot.browserErrors[0].metadata).toMatchObject({
      error: {
        message: "password=[REDACTED]",
      },
    });
    expect(snapshot.browserErrors[1].metadata).toMatchObject({
      reason: {
        message: "password=[REDACTED]",
      },
    });
  });
});
