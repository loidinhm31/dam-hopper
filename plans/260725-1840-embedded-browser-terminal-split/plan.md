# Embedded browser beside terminal

Status: in progress · Priority: high · Date: 2026-07-25

## Goal

In wide Terminal and IDE mode, render the Browser as a user-resizable right-hand sibling of the active terminal surface. Use the current working terminal automatically for the browser artifact workflow, without a terminal chooser. Keep the iframe alive when terminal focus changes, expose trusted browser navigation, and synchronize the address bar with the current path.

## Preflight contract

- Output: a resizable terminal/browser split and automatic active-terminal artifact handoff.
- Acceptance: no chooser/radio controls; a ready active terminal is used at preparation; prepared artifacts remain bound to their original target; switching tabs does not reload the iframe; closed/unready terminals fail safely.
- Scope: `@dam-hopper/ui` wide Terminal and IDE modes. Compact Browser remains a separate surface.
- Non-goals: server/API/auth/config changes, new visual assets, redesigning terminal docking.
- Risk/public contracts: iframe lifecycle, xterm fitting after width changes, artifact expiry/cleanup, target liveness.
- Affected: terminal shell, browser handoff, workspace wiring, unit/browser tests, frontend component docs.
- Testing: UI build, focused Vitest units, project browser tests, manual wide-screen resize and terminal-switch check.
- Open questions: none.

## Design decision

Reuse `react-resizable-panels`, already used by terminal docking, rather than adding a bespoke drag/width persistence mechanism. The Browser remains a singleton keep-alive surface; only its visible viewport moves into the split.

## Phases

| Phase | Status | Detail |
| --- | --- | --- |
| 01 | in progress | [Terminal/browser split and active-target handoff](phase-01-terminal-browser-split.md) |

## Side-effect review

- Auth/session/permissions: unchanged; existing authenticated artifact endpoints remain used.
- API/client compatibility: no endpoint or payload change.
- Data/migrations: none.
- Business semantics: artifact receives the active ready terminal at preparation and retains that target through review/insertion.
- Security/privacy: retain origin validation, selection bounds, untrusted-data warning, review confirmation, expiry, and artifact cleanup.
- Performance/concurrency: preserve singleton iframe; resize terminal fitting; avoid target changes cancelling prepared artifacts.
- Docs/config/deploy: update `docs/frontend-components.md`; no configuration/deployment changes.
