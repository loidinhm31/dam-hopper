import { MAX_TEXT_LENGTH, type BrowserConsoleLevel } from "./protocol.js";

const CONSOLE_LEVELS = ["debug", "log", "info", "warn", "error"] as const;

function consolePreview(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return Object.prototype.toString.call(value);
}

function boundedMessage(args: unknown[]): string {
  const message = args
    .slice(0, 4)
    .map(consolePreview)
    .join(" ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(
      /\b(authorization|api[-_ ]?key|token|secret|password)\b\s*[:=]\s*(?:[^\s,;]+\s+)?[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(api[-_ ]?key|token|secret|password)\b\s+[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\bauthorization\b\s+[^\s,;]+(?:\s+[^\s,;]+)?/gi,
      "Authorization=[REDACTED]",
    )
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .trim();
  return (message || "(empty console message)").slice(0, MAX_TEXT_LENGTH);
}

/** Observes history changes in the target document without changing navigation. */
export function observeNavigation(onNavigate: (url: string) => void): () => void {
  const publish = () => onNavigate(window.location.href);
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const pushState: History["pushState"] = function (this: History, ...args) {
    const result = originalPushState.apply(this, args);
    publish();
    return result;
  };
  const replaceState: History["replaceState"] = function (
    this: History,
    ...args
  ) {
    const result = originalReplaceState.apply(this, args);
    publish();
    return result;
  };
  history.pushState = pushState;
  history.replaceState = replaceState;
  window.addEventListener("popstate", publish);
  window.addEventListener("hashchange", publish);
  return () => {
    if (history.pushState === pushState) history.pushState = originalPushState;
    if (history.replaceState === replaceState)
      history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", publish);
    window.removeEventListener("hashchange", publish);
  };
}

/** Mirrors bounded console previews for the user-visible local debug console. */
export function observeConsole(
  onEntry: (level: BrowserConsoleLevel, message: string) => void,
): () => void {
  const originals = new Map<
    BrowserConsoleLevel,
    (...args: unknown[]) => void
  >();
  const replacements = new Map<
    BrowserConsoleLevel,
    (...args: unknown[]) => void
  >();

  for (const level of CONSOLE_LEVELS) {
    const original = console[level] as (...args: unknown[]) => void;
    const replacement = (...args: unknown[]) => {
      original.apply(console, args);
      onEntry(level, boundedMessage(args));
    };
    originals.set(level, original);
    replacements.set(level, replacement);
    console[level] = replacement;
  }

  const onError = (event: ErrorEvent) =>
    onEntry("error", boundedMessage([event.message || event.error]));
  const onUnhandledRejection = (event: PromiseRejectionEvent) =>
    onEntry("error", boundedMessage([event.reason]));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    for (const level of CONSOLE_LEVELS) {
      const replacement = replacements.get(level);
      const original = originals.get(level);
      if (replacement && original && console[level] === replacement)
        console[level] = original;
    }
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
