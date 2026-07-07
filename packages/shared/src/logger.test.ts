import { afterEach, describe, expect, it } from "vitest";
import {
  addLoggerSink,
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

  it("fans out one redacted entry to the primary and diagnostics sinks", () => {
    const primaryEntries: LogEntry[] = [];
    const diagnosticsEntries: LogEntry[] = [];
    configureLogger({
      level: "debug",
      sink: (entry) => primaryEntries.push(entry),
    });
    const removeSink = addLoggerSink((entry) => diagnosticsEntries.push(entry));

    logger.warn("fanout", "first", { token: "secret" });
    removeSink();
    logger.warn("fanout", "second");

    expect(primaryEntries.map((entry) => entry.message)).toEqual(["first", "second"]);
    expect(primaryEntries[0].metadata).toEqual({ token: "[REDACTED]" });
    expect(diagnosticsEntries).toHaveLength(1);
    expect(diagnosticsEntries[0].metadata).toEqual({ token: "[REDACTED]" });
  });

  it("continues delivering logs when one sink throws", () => {
    const primaryEntries: LogEntry[] = [];
    const diagnosticsEntries: LogEntry[] = [];
    configureLogger({
      level: "debug",
      sink: () => {
        throw new Error("sink failed");
      },
    });
    const removeSink = addLoggerSink((entry) => diagnosticsEntries.push(entry));

    logger.error("fanout", "survived");
    removeSink();

    configureLogger({
      level: "debug",
      sink: (entry) => primaryEntries.push(entry),
    });
    logger.error("fanout", "after remove");

    expect(diagnosticsEntries.map((entry) => entry.message)).toEqual([
      "survived",
    ]);
    expect(primaryEntries.map((entry) => entry.message)).toEqual([
      "after remove",
    ]);
  });

  it("resolves known log levels and falls back for invalid values", () => {
    expect(resolveLogLevel("debug", "warn")).toBe("debug");
    expect(resolveLogLevel("silent", "warn")).toBe("silent");
    expect(resolveLogLevel("verbose", "warn")).toBe("warn");
    expect(resolveLogLevel(undefined, "error")).toBe("error");
  });
});
