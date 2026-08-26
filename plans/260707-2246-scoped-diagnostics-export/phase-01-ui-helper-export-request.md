# Phase 01 - UI Helper + Export Request

Date: 2026-07-07
Priority: high
Status: complete

## Key Insights

- Backend already supports `windowMinutes`, `includeTerminalOutput`, `terminalTailBytes`, and `terminalIds`.
- Frontend snapshot currently exports the full local diagnostics ring.
- A shared control avoids duplicated export handlers across pages.

## Requirements

- Add short windows: 2m, 5m, 10m, 30m, 60m.
- Include final export scope metadata in the frontend payload.
- Filter frontend logs and browser errors by time and page scope.

## Implementation Steps

- Extend `diagnostics-export.ts` with scoped request options.
- Add `DiagnosticsExportButton`.
- Keep default Settings behavior equivalent except configurable window.

## Success Criteria

- Export JSON `scope.windowMinutes` matches selected filter.
- Export JSON `frontend.exportScope` identifies page/project/terminals when provided.
- Frontend logs are filtered before download.

## Result

- Added scoped export options and frontend snapshot filtering.
- Added reusable diagnostics export button with 2m, 5m, 10m, 30m, 60m windows.
