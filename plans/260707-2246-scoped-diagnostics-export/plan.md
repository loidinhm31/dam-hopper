# Scoped Diagnostics Export

Date: 2026-07-07
Status: complete

## Goal

Make `Export Diagnostics` available from each page, with page-local scope and a time-window filter so exported JSON has less noise.

## Phases

1. [UI helper + export request](./phase-01-ui-helper-export-request.md) - complete
2. [Page wiring](./phase-02-page-wiring.md) - complete
3. [Validation](./phase-03-validation.md) - complete

## Scope

- Reuse existing `POST /api/diagnostics/export`.
- Add frontend-side filtering for browser diagnostics logs.
- Pass backend-supported `windowMinutes` and `terminalIds` filters.
- Do not rewrite backend export unless frontend scope cannot meet requirements.
