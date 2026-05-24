import { afterEach, describe, expect, it } from "vitest";
import {
  configureLogger,
  getLoggerConfig,
  logger,
  resolveLogLevel,
  type LogEntry,
} from "./logger.js";

const defaultSink = getLoggerConfig().sink;

afterEach(() => {
  configureLogger({
    level: "warn",
    redactSensitiveData: true,
    sink: defaultSink,
  });
});

describe("logger", () => {
  it("filters messages below the configured level", () => {
    const entries: LogEntry[] = [];
    configureLogger({ level: "warn", sink: (entry) => entries.push(entry) });

    logger.debug("test", "debug message");
    logger.info("test", "info message");
    logger.warn("test", "warn message");
    logger.error("test", "error message");

    expect(entries.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("redacts sensitive metadata before invoking the sink", () => {
    const entries: LogEntry[] = [];
    configureLogger({ level: "debug", sink: (entry) => entries.push(entry) });

    logger.error("auth", "failed", {
      token: "abc123",
      headers: { Authorization: "Bearer super-secret-token" },
      nested: {
        password: "hunter2",
        apiKey: "key-123",
        note: "safe",
      },
      url: "https://example.test/ws?token=raw-token&project=demo",
      errors: [new Error("bad password=secret")],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toEqual({
      token: "[REDACTED]",
      headers: { Authorization: "[REDACTED]" },
      nested: {
        password: "[REDACTED]",
        apiKey: "[REDACTED]",
        note: "safe",
      },
      url: "https://example.test/ws?token=[REDACTED]&project=demo",
      errors: [
        {
          name: "Error",
          message: "bad password=[REDACTED]",
          stack: expect.any(String),
        },
      ],
    });
  });

  it("can disable metadata redaction for local diagnostics", () => {
    const entries: LogEntry[] = [];
    configureLogger({
      level: "debug",
      redactSensitiveData: false,
      sink: (entry) => entries.push(entry),
    });

    logger.info("debug", "raw metadata", { token: "abc123" });

    expect(entries[0].metadata).toEqual({ token: "abc123" });
  });

  it("resolves known log levels and falls back for invalid values", () => {
    expect(resolveLogLevel("debug", "warn")).toBe("debug");
    expect(resolveLogLevel("silent", "warn")).toBe("silent");
    expect(resolveLogLevel("verbose", "warn")).toBe("warn");
    expect(resolveLogLevel(undefined, "error")).toBe("error");
  });
});
