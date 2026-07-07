import type {
  DiagnosticExportRequest,
  DiagnosticExportResponse,
} from "@/api/client.js";
import {
  getClientDiagnosticsSnapshot,
  type ClientDiagnosticEntry,
  type ClientDiagnosticsSnapshot,
} from "./diagnostics-client.js";
import { downloadJson } from "./download-json.js";

export const DIAGNOSTICS_WINDOW_OPTIONS = [2, 5, 10, 30, 60] as const;

export const DEFAULT_DIAGNOSTICS_EXPORT_REQUEST: Required<
  Pick<
    DiagnosticExportRequest,
    "windowMinutes" | "includeTerminalOutput" | "terminalTailBytes"
  >
> = {
  windowMinutes: 60,
  includeTerminalOutput: true,
  terminalTailBytes: 65_536,
};

export interface DiagnosticsExportScopeContext {
  page: string;
  route?: string;
  project?: string | null;
  terminalIds?: string[];
  frontendScopes?: string[];
}

export interface DiagnosticsExportOptions {
  windowMinutes?: number;
  includeTerminalOutput?: boolean;
  terminalTailBytes?: number;
  terminalIds?: string[];
  scope?: DiagnosticsExportScopeContext;
}

function filterEntryByScope(
  entry: ClientDiagnosticEntry,
  scopes: string[] | undefined,
) {
  if (!scopes || scopes.length === 0) return true;
  if (
    entry.type === "browser.error" ||
    entry.type === "browser.unhandledrejection" ||
    entry.type === "react.error" ||
    entry.type === "route"
  ) {
    return true;
  }
  return scopes.some((scope) => entry.scope.includes(scope));
}

export function filterClientDiagnosticsSnapshot(
  snapshot: ClientDiagnosticsSnapshot,
  options: DiagnosticsExportOptions = {},
  now = Date.now(),
): ClientDiagnosticsSnapshot & {
  exportScope?: DiagnosticsExportScopeContext;
} {
  const windowMinutes =
    options.windowMinutes ??
    DEFAULT_DIAGNOSTICS_EXPORT_REQUEST.windowMinutes;
  const cutoff = now - windowMinutes * 60_000;
  const sourceLogs = Array.isArray(snapshot.logs) ? snapshot.logs : [];
  const logs = sourceLogs.filter(
    (entry) =>
      entry.timestampMs >= cutoff &&
      filterEntryByScope(entry, options.scope?.frontendScopes),
  );

  const filtered = {
    ...snapshot,
    manifest: {
      ...snapshot.manifest,
      entryCount: logs.length,
    },
    logs,
    browserErrors: logs.filter(
      (entry) =>
        entry.type === "browser.error" ||
        entry.type === "browser.unhandledrejection" ||
        entry.type === "react.error",
    ),
  };
  return options.scope
    ? {
        ...filtered,
        exportScope: options.scope,
      }
    : filtered;
}

export function buildDiagnosticsExportRequest(
  options: DiagnosticsExportOptions = {},
): DiagnosticExportRequest {
  const windowMinutes =
    options.windowMinutes ??
    DEFAULT_DIAGNOSTICS_EXPORT_REQUEST.windowMinutes;
  const terminalIds = options.terminalIds ?? options.scope?.terminalIds;
  return {
    ...DEFAULT_DIAGNOSTICS_EXPORT_REQUEST,
    windowMinutes,
    includeTerminalOutput:
      options.includeTerminalOutput ??
      DEFAULT_DIAGNOSTICS_EXPORT_REQUEST.includeTerminalOutput,
    terminalTailBytes:
      options.terminalTailBytes ??
      DEFAULT_DIAGNOSTICS_EXPORT_REQUEST.terminalTailBytes,
    ...(terminalIds !== undefined ? { terminalIds } : {}),
    frontend: filterClientDiagnosticsSnapshot(
      getClientDiagnosticsSnapshot(),
      {
        ...options,
        windowMinutes,
      },
    ),
  };
}

export async function exportDiagnosticsBundle(
  exporter: (
    request: DiagnosticExportRequest,
  ) => Promise<DiagnosticExportResponse>,
  options: DiagnosticsExportOptions = {},
): Promise<string> {
  const bundle = await exporter(buildDiagnosticsExportRequest(options));
  return downloadJson(bundle, {
    filePrefix: "dam-hopper-diagnostics",
  });
}
