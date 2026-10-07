import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissTunnelReminder,
  isTunnelReminderDismissed,
  resetTunnelReminderDismissals,
  type TunnelReminderDismissalStorage,
} from "./tunnel-reminder-dismissal.js";

describe("tunnel reminder dismissal", () => {
  let storage: TunnelReminderDismissalStorage;
  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
    resetTunnelReminderDismissals(storage);
  });

  it("isolates equal tunnel IDs between profiles", () => {
    dismissTunnelReminder("a", "same", storage);
    expect(isTunnelReminderDismissed("a", "same", storage)).toBe(true);
    expect(isTunnelReminderDismissed("b", "same", storage)).toBe(false);
    expect(isTunnelReminderDismissed("a", "other", storage)).toBe(false);
  });

  it("restores dismissal after a fresh module loads the same session storage", async () => {
    dismissTunnelReminder("a", "same", storage);
    vi.resetModules();
    // Fresh module state models page reload; a static import would reuse the cache.
    const reloaded = await import("./tunnel-reminder-dismissal.js");
    expect(reloaded.isTunnelReminderDismissed("a", "same", storage)).toBe(true);
    expect(reloaded.isTunnelReminderDismissed("b", "same", storage)).toBe(false);
  });

  it("retains dismissal in memory when session storage is denied", () => {
    const denied: TunnelReminderDismissalStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };
    resetTunnelReminderDismissals(denied);
    dismissTunnelReminder("a", "same", denied);
    expect(isTunnelReminderDismissed("a", "same", denied)).toBe(true);
    expect(isTunnelReminderDismissed("b", "same", denied)).toBe(false);
  });
});
