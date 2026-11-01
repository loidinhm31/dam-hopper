# Integration Smoke Test Report: Session Changes Review

Date: 2026-10-30
Scope: Host integration, lifecycle protocol verification, and Monaco read-only review surface.

## Summary of Executed Smoke Checks

| Component | Target / Test | Status | Evidence |
| :--- | :--- | :--- | :--- |
| Server Protocol Barrier | `server/tests/session_changes_protocol.rs` | PASS | `test_full_protocol_barrier_and_lifecycle` passed in 0.01s |
| Private Control Endpoints | `server/tests/session_changes_controls.rs` | PASS | `test_private_controls_http_lifecycle` passed in 0.02s |
| Public REST API Endpoints | `server/tests/session_changes_api.rs` | PASS | Status, files, file detail, refresh, and fromNow passed in 0.27s |
| PTY & Session Lifecycle | `server/tests/session_changes_lifecycle.rs` | PASS | Incarnation fencing and terminal retention passed in 0.05s |
| Browser Host Isolation | `packages/ui/browser-tests/session-changes-host.browser.tsx` | PASS | Capture-phase key isolation, modal lifecycle passed in 74ms |
| Monaco Review Panel | `packages/ui/browser-tests/session-changes-panel.browser.tsx` | PASS | Files list, status chip, diff viewer integration passed |
| Readonly Diff Viewer | `packages/ui/browser-tests/session-changes-viewer.browser.tsx` | PASS | Diff navigation, side-by-side / inline toggle passed |
| Client Channels & Queries | `packages/ui/src/api/session-changes-*.test.*` | PASS | Transport queries, error decoding, and cache invalidation passed |
| E2E Typecheck | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | PASS | Specs and fixtures compile without TypeScript diagnostics |

## Observable Protocol Ordering

1. **Terminal Target Binding**: PTY manager binds launch directory and canonical project root during session creation.
2. **OMP Extension Preparation**: Extension sends `POST /prepare` with registration ID, session ID, and root. Server captures baseline and returns `baselineId` + `activationNonce`.
3. **Activation & Acknowledgment Barrier**: Extension calls `POST /activate`, receives `ActivationReceipt` with `activated: true`, and confirms with `POST /receipt`. Public status transitions to `ready`.
4. **Turn Settling & Deduplication**: Model tool turns submit `POST /settled` with turn IDs. First submission returns `duplicate: false`; repeated calls return `duplicate: true`.
5. **Read-Only Browser Review**: User clicks "Review session changes" in TabBar or header, opening `SessionChangesHost` in a modal dialog with full capture-phase keyboard isolation from underlying xterm.js terminals.
