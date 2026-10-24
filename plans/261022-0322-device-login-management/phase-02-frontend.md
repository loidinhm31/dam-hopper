# Phase 02 — Saved-profile Login devices UI

## Overview
- Status: complete. Priority: P2. Owner: frontend agent, exclusively `packages/ui/**`.
- Dependency: frozen [contract](./contracts.md) and [overview](./plan.md); concurrent with 01 using the frozen DTO, not backend availability.
- Context: `agent://ScoutUiDevices`; [profile guide](../../docs/user-guide-multi-server-profiles.md), [code standards](../../docs/code-standards.md), [testing](../../docs/testing.md).
- Existing `ServerSettingsDialog` is the entry point; `TopNav` already passes a selected profile. Keep the surface there, not a second settings page.

## Files and actions
| Action | Existing file / new path | Work |
| --- | --- | --- |
| Modify | `packages/ui/src/api/auth-types.ts` | Session/list DTOs and unavailable error code |
| Modify | `packages/ui/src/api/auth-client.ts` | Explicit target list/revoke helpers, DTO validation, abort and error propagation |
| Modify | `packages/ui/src/api/auth-client.test.ts` | Request authority, malformed DTO, cursor, DELETE acknowledgement and errors |
| Modify | `packages/ui/src/components/organisms/ServerSettingsDialog.tsx` | Mount section using persisted selected profile, not editable URL/token draft |
| Create | `packages/ui/src/components/organisms/login-devices-section.tsx` | Focused list, confirmation, pagination/mutations and owned lifecycle |
| Create | `packages/ui/src/components/organisms/login-devices-section.test.tsx` | Consumer state/race/ownership regressions |
| Modify | `packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx` | Saved authority, legacy selected profile, unavailable new-profile behavior |
| Modify only if needed | `packages/ui/src/api/connections.ts`, `packages/ui/src/api/connections.test.ts`, `packages/ui/src/api/connections-mfa.test.tsx` | Reuse or narrowly add exact-captured-owner self-revoke cleanup |
| Create | `packages/ui/browser-tests/login-devices.browser.tsx` | Focused dialog confirmation, focus, narrow scrolling/wrapping |
| Create | `packages/ui/e2e/device-login-management/device-login-management.spec.ts` | Actual-app authenticated journey; authored now, executed only after join |

Read/reuse `packages/ui/src/api/{server-config,ownership,query-client}.ts`, `packages/ui/src/components/ui/ConfirmDialog.tsx`, `packages/ui/src/components/organisms/ServerSettingsDialogMfa.test.tsx`, `packages/ui/e2e/fixtures/{application-fixture,application-services,capture-evidence}.ts` and `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`. No new auth state registry or general transport rewrite. New files follow kebab-case; preserve existing file naming.

## Implementation steps
1. Add DTOs exactly matching contract and boundary decoding for every row, nullable metadata, boolean current marker, RFC3339 date strings and nullable nextCursor. Treat malformed success payload as typed protocol failure. Add helpers accepting explicit saved base URL/token and AbortSignal; encode cursor and ID safely, propagate non-2xx, and require server acknowledgement for mutation success.
2. Reuse selected-profile authentication policy and secure bearer rules. Explicit bearer-profile requests omit cookies (`credentials: "omit"`); never suppress a bearer on insecure transport then accidentally authorize using ambient same-origin cookies. Cookie-authorized DELETE is strictly unsupported and rejected by the server with 403 `BearerRequired`. Cross-origin/profile fallback is forbidden. Do not copy the legacy logout fetch's unconditional `credentials: include`.
3. Capture immutable `{profileId, normalized saved URL, credential, connection generation}` and request identity before network work. Resolve legacy dialog mode to the saved profile once, fail closed if none; `profile: null` creates no management authority. Keep these values separate from editable name/URL/token and selected ambient profile. Include credential identity in staleness checks, not in cache keys or persisted session data.
4. Integrate a focused `Login devices` section in the existing scrollable dialog body. Use owner-qualified Query keys if TanStack Query stores list state; include profile/generation, never bearer secrets. Cancel and retire state on dialog close, owner/URL/credential/generation change or profile deletion. Discard every stale async response, including errors/finally callbacks and pagination results.
5. Render loading, list error with Retry, empty, unavailable no-auth, refresh, Load more, pagination error and mutation error states. Merge pages without duplicate IDs; refresh resets the cursor chain. Show browser/client hint as plain untrusted text, `Unknown browser/client` fallback, login/expiry time, and `This session` from the flag rather than row position. Explain account-wide access on this server, not project/device identity.
6. Reuse ConfirmDialog for every revoke; current-row warning says it ends this login. Disable duplicate submission, preserve row while pending, remove only after acknowledged DELETE. Other-session revoke must not alter local token/connection. A failed mutation keeps the row and exposes an actionable error; never treat best-effort logout as acknowledgement of revoke.
7. On acknowledged self revoke, clean up only captured profile/credential/runtime still belonging to that operation; no global `clearAuthUsername`, active-profile fallback, unconditional page reload or clearing replacement login. Reuse exact connection APIs and media cleanup where appropriate. A 4401 WS close may already retire generation/clear old token before DELETE resolves: regard owned acknowledged revoke as complete without publishing into a replacement owner, reconnecting revoked credentials or reporting a spurious failure. Do not relax stale-generation guards globally.
8. Cover browser cookie effects separately from JS fences: explicit bearer fetch with `credentials: "omit"` ensures client requests do not rely on cookies and ignore any cookie headers on revocation. Cookie-authorized self-revoke is unsupported and fails closed (backend strictly enforces `BearerRequired`). Preserves full feature access through the saved profile's supported Bearer authentication path, verified in real-browser held-response tests.
9. Author unit/browser/E2E sources without running them. Full-app journey uses existing real application fixtures, SQLite authentication and multiple actual sessions/account identities; no route interception that fabricates success. Coordinate server seed needs through parent; backend owns all `server/**` seed changes. Return terminal report plus artifacts; no builds/tests/lint/formatters mid-flight.

## Regression source requirements
- Typed client transport: explicit URL/token, signal/cursor/ID, secure policy, no cookie mixing, 409 code, malformed rows/cursors, non-204/non-2xx handling.
- Consumer states: loading/empty/unsupported, list/pagination/mutation failure with retry, refresh, later-page current marker, legacy unknown hint, long malicious-looking plain-text hint.
- Confirmation cancellation makes no request; approved other revoke waits for acknowledgement and preserves current login; self warning and exact-profile cleanup.
- Deferred completion after profile switch, saved URL edit, profile deletion, credential replacement, generation retirement, close/reopen and refresh supersession cannot mutate new state.
- WS-before-DELETE race, existing cleared old credential, newer credential established before response, two profiles using the same server, and unsaved URL/token edits.
- Actual-browser 320px viewport: bounded scroll, long-hint word-wrap, visible confirmation actions, keyboard focus/accessibility, no horizontal overflow. Existing MFA dialog behavior remains intact.

## Risks and side effects
- `ServerSettingsDialog.handleLogout` currently performs global username clearing and conditionally reloads; it is not the self-revoke contract. Do not route new flow through it unchanged or expand into unrelated logout refactoring.
- `connections.handleDrop` increments generation before clearing expired/revoked credentials. Cleanup must distinguish an already-retired original login from a replacement login.
- Network/DOM mocks are fine for focused regression sources; only real authenticated backend plus actual full app meets runtime acceptance.

## Success criteria / handoff
- Saved selected target is sole authority; all contract states/confirmations/pagination implemented and no secrets enter UI cache keys or evidence.
- Scoped dialog draft protection (`credentialDraftScopeRef`) implemented and verified to prevent Save from re-storing revoked credentials or overwriting replacement logins.
- Code reviewed and APPROVED with zero blockers in [reports/review-frontend-final.md](./reports/review-frontend-final.md), with two nonblocking low residuals documented (URL-change Save race message and conservative mid-Save rejection).
- Full UI unit suite (339 files, 3131 tests) passing following fixture endpoint rebind fix.
## Unresolved questions
None requiring user input. Cookie authority/replacement overlap must be explicitly reviewed and qualified; insecure or ambiguous targets fail closed.
