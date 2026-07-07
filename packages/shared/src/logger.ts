export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export type LogMetadata = Record<string, unknown>;

export interface LogEntry {
  level: Exclude<LogLevel, "silent">;
  scope: string;
  message: string;
  metadata?: unknown;
  timestamp: Date;
}

export type LoggerSink = (entry: LogEntry) => void;

export interface LoggerConfig {
  level: LogLevel;
  redactSensitiveData: boolean;
  sink: LoggerSink;
}

export type LoggerConfigInput = Partial<LoggerConfig>;

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const SENSITIVE_KEY_PATTERN =
  /token|authorization|password|passwd|passphrase|api[-_]?key|secret|credential|private[-_]?key/i;

const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 8;

function consoleSink(entry: LogEntry): void {
  const writer = console[entry.level] ?? console.log;
  const prefix = `[${entry.scope}] ${entry.message}`;
  if (entry.metadata === undefined) {
    writer(prefix);
    return;
  }
  writer(prefix, entry.metadata);
}

let config: LoggerConfig = {
  level: "warn",
  redactSensitiveData: true,
  sink: consoleSink,
};

let extraSinks: LoggerSink[] = [];

export function configureLogger(nextConfig: LoggerConfigInput): void {
  config = { ...config, ...nextConfig };
}

export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

export function addLoggerSink(sink: LoggerSink): () => void {
  extraSinks = [...extraSinks, sink];
  return () => {
    extraSinks = extraSinks.filter((candidate) => candidate !== sink);
  };
}

export function resolveLogLevel(
  value: string | undefined,
  fallback: LogLevel,
): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "silent"
  ) {
    return value;
  }
  return fallback;
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[config.level];
}

function redactString(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/([?&]token=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(
      /(password|passphrase|api[-_]?key|secret|credential)=([^&\s]+)/gi,
      `$1=${REDACTED}`,
    );
}

function redactValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return "[MaxDepth]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactValue(child, depth + 1, seen);
  }
  return redacted;
}

export function redactLogMetadata(metadata: unknown): unknown {
  return redactValue(metadata);
}

function deliverToSinks(entry: LogEntry): void {
  for (const sink of [config.sink, ...extraSinks]) {
    try {
      sink(entry);
    } catch {
      // Logging must never break the application path.
    }
  }
}

function emit(
  level: Exclude<LogLevel, "silent">,
  scope: string,
  message: string,
  metadata?: unknown,
): void {
  if (!shouldLog(level)) return;
  deliverToSinks({
    level,
    scope,
    message,
    metadata: config.redactSensitiveData
      ? redactLogMetadata(metadata)
      : metadata,
    timestamp: new Date(),
  });
}

export const logger = {
  debug(scope: string, message: string, metadata?: unknown): void {
    emit("debug", scope, message, metadata);
  },
  info(scope: string, message: string, metadata?: unknown): void {
    emit("info", scope, message, metadata);
  },
  warn(scope: string, message: string, metadata?: unknown): void {
    emit("warn", scope, message, metadata);
  },
  error(scope: string, message: string, metadata?: unknown): void {
    emit("error", scope, message, metadata);
  },
};
