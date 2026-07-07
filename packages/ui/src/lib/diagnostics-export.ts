import type {
  DiagnosticExportRequest,
  DiagnosticExportResponse,
} from "@/api/client.js";
import { getClientDiagnosticsSnapshot } from "./diagnostics-client.js";
import { downloadJson } from "./download-json.js";

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

export function buildDiagnosticsExportRequest(): DiagnosticExportRequest {
  return {
    ...DEFAULT_DIAGNOSTICS_EXPORT_REQUEST,
    frontend: getClientDiagnosticsSnapshot(),
  };
}

export async function exportDiagnosticsBundle(
  exporter: (
    request: DiagnosticExportRequest,
  ) => Promise<DiagnosticExportResponse>,
): Promise<string> {
  const bundle = await exporter(buildDiagnosticsExportRequest());
  return downloadJson(bundle, {
    filePrefix: "dam-hopper-diagnostics",
  });
}
