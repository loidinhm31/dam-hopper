import { beforeEach, describe, expect, it } from "vitest";
import {
  filterNotificationsByOwner,
  MAX_NOTIFICATION_ENTRIES,
  redactNotification,
  useOsNotificationStore,
  type OsNotificationEntry,
} from "./notifications.js";

describe("OS Notifications Subsystem", () => {
  beforeEach(() => {
    useOsNotificationStore.getState().clearAll();
  });

  it("enforces bounded 50-entry in-memory FIFO log", () => {
    const store = useOsNotificationStore.getState();

    for (let i = 0; i < 65; i++) {
      store.addNotification({
        profileId: "p1",
        generation: 1,
        title: `Alert ${i}`,
        source: "agent",
        level: "info",
      });
    }

    const current = useOsNotificationStore.getState().entries;
    expect(current.length).toBe(MAX_NOTIFICATION_ENTRIES);
    // Newest is at index 0
    expect(current[0].title).toBe("Alert 64");
    // Oldest surviving is 64 - 49 = 15
    expect(current[49].title).toBe("Alert 15");
  });

  it("redacts sensitive fields immediately when Cognito mode is active", () => {
    const raw: OsNotificationEntry = {
      id: "notif-1",
      profileId: "prod-server-primary",
      generation: 1,
      title: "Agent OMP failed on file /secret/key.pem",
      body: "Bearer token leaked in output terminal-42",
      source: "agent",
      level: "warning",
      timestamp: Date.now(),
      read: false,
      targetProject: "confidential-client-work",
      targetTerminalId: "term-xyz",
    };

    // Redacted under Cognito
    const redacted = redactNotification(raw, true);
    expect(redacted.title).toBe("Notification (Protected)");
    expect(redacted.body).toBe("Details hidden in Cognito Privacy Mode");
    expect(redacted.profileId).toBe("protected");
    expect(redacted.targetProject).toBeUndefined();
    expect(redacted.targetTerminalId).toBeUndefined();

    // Normal when Cognito is inactive
    const unredacted = redactNotification(raw, false);
    expect(unredacted.title).toBe("Agent OMP failed on file /secret/key.pem");
    expect(unredacted.targetProject).toBe("confidential-client-work");
  });

  it("filters notifications strictly by owner connection generation", () => {
    const entries: OsNotificationEntry[] = [
      {
        id: "1",
        profileId: "prof-1",
        generation: 1,
        title: "Gen 1 Alert",
        source: "system",
        level: "info",
        timestamp: Date.now(),
        read: false,
      },
      {
        id: "2",
        profileId: "prof-1",
        generation: 2,
        title: "Gen 2 Alert",
        source: "system",
        level: "info",
        timestamp: Date.now(),
        read: false,
      },
      {
        id: "3",
        profileId: "prof-2",
        generation: 1,
        title: "Prof 2 Alert",
        source: "system",
        level: "info",
        timestamp: Date.now(),
        read: false,
      },
    ];

    const filtered = filterNotificationsByOwner(entries, {
      profileId: "prof-1",
      generation: 2,
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe("Gen 2 Alert");
  });
});
