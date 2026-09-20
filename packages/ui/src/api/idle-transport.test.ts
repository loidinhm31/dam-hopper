import { describe, expect, it } from "vitest";
import { IdleTransport } from "./idle-transport.js";

describe("IdleTransport", () => {
  it("implements callable FS methods with safe no-op or rejection behavior", async () => {
    const idle = new IdleTransport();

    // onFsEvent returns no-op unsubscribe function
    const unsub = idle.onFsEvent();
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();

    // fsUnsubscribeTree is a safe no-op
    expect(() => idle.fsUnsubscribeTree(42)).not.toThrow();

    // fsSubscribeTree rejects with stable error
    await expect(idle.fsSubscribeTree()).rejects.toThrow(
      "Server profile required",
    );

    // fsOp rejects with stable error
    await expect(idle.fsOp()).rejects.toThrow("Server profile required");
  });
});
