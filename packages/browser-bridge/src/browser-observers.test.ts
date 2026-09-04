// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeConsole } from "./browser-observers.js";

describe("Browser observers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redacts credential-like console values and reports uncaught errors", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const entries: Array<{ level: string; message: string }> = [];
    const stop = observeConsole((level, message) =>
      entries.push({ level, message }),
    );

    console.info("Authorization: Bearer very-secret-token");
    console.info("Authorization Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
    console.warn("token another-secret-value");
    window.dispatchEvent(
      new ErrorEvent("error", { message: "Unhandled failure" }),
    );
    stop();

    expect(
      entries.filter(
        (entry) =>
          entry.level === "info" &&
          entry.message === "Authorization=[REDACTED]",
      ),
    ).toHaveLength(2);
    expect(entries).toContainEqual({
      level: "info",
      message: "Authorization=[REDACTED]",
    });
    expect(entries).toContainEqual({
      level: "warn",
      message: "token=[REDACTED]",
    });
    expect(entries).toContainEqual({
      level: "error",
      message: "Unhandled failure",
    });
  });
});
