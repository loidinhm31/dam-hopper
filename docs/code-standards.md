# Code Standards

These standards describe the current Rust backend, shared React UI, and profile-aware transport model. The retired plugin platform is not normative; see the [roadmap](./project-roadmap.md) and [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md) for retirement status and the [Native Advisor architecture](./architecture/native-advisor.md) for its native replacement.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `server/src/api/` | Axum route registration, handlers, auth, and WebSocket/API transport |
| `server/src/{auth,config,crypto,fs,git,pty,workflow,advisor,agent_status}/` | Backend domain boundaries and services |
| `server/src/state.rs` | Shared server `AppState` and service ownership |
| `packages/ui/src/api/` | Owner-bound API clients, connections, DTOs, transports, and query keys |
| `packages/ui/src/components/`, `hooks/`, `stores/`, `lib/` | Shared React UI and client-side domain behavior |
| `apps/web/`, `apps/native/` | Vite browser and Tauri desktop hosts |
| `server/tests/`, colocated Rust tests, `packages/ui/browser-tests/` | Backend and browser-level behavioral coverage |

## Cross-cutting rules

### Ownership and asynchronous work

- Capture `{ profileId, generation }` before an asynchronous operation. Route it through that owner's `ApiClient`/transport and owner-qualified query keys.
- Recheck captured ownership after every `await` before publishing a result, changing state, or cleaning up a remote resource.
- Never route a failed or unavailable qualified target through an ambient client, first-connected profile, another transport, or project root fallback.
- Bind subscriptions, events, cancellation, and unsubscribe to the transport that created them. Retire state by the exact owner/resource key.
- Keep project selection, Settings target, preferences source, and Browser target as distinct selections.

### Rust backend

- Keep HTTP parsing/authentication in API handlers and domain behavior in the owning service/module. Share bounded DTOs and typed errors rather than duplicating policy in handlers.
- Use typed error enums with `thiserror` at domain boundaries; map them to stable, non-sensitive HTTP/WebSocket responses at the API boundary.
- Validate request size, identifiers, limits, and authorization before expensive work or state mutation. Use checked arithmetic and explicit limits for files, scans, pages, channels, and queues.
- Do not hold synchronous locks across `.await`; keep blocking I/O and external process work outside hot locks. Revalidate state before publishing work completed outside a lock.
- Treat persistence and filesystem replacement as transactions: validate the target, use atomic publication where required, preserve unrelated data, and fail closed on stale revisions or unsafe paths.
- Keep secrets, authentication material, prompt text, terminal content, and private paths out of logs. Reuse the shared redacting logger and bounded diagnostics.

### React and TypeScript

- Use shared components from `packages/ui/`; keep web/native hosts thin and avoid duplicate application state.
- Keep server state in owner-qualified TanStack Query keys and local interaction state in the narrowest appropriate component/store. A single ordinary QueryClient per host is not a substitute for owner-qualified query keys.
- Use typed API methods and DTO decoders at transport boundaries. Normalize once at the boundary; avoid loosely typed response branches in components.
- Cancel superseded requests when supported and discard late results when request ID, provider, target, or owner generation has changed.
- Keep effects and listeners paired with deterministic cleanup. Browser APIs and terminal input must not bypass current mode/owner guards.
- Present disconnected, unsupported, loading, unknown, and error states explicitly; do not fabricate success or silently select another profile.
- **React 19 Radix UI Patch Invariant:** Maintain the pnpm patch `patches/@radix-ui__react-compose-refs@1.1.2.patch`. This patch stabilizes `useComposedRefs` via `useRef` to eliminate infinite ref callback loops under React 19. Do not assume or introduce unverified patches (such as react-slot).
## Domain-specific invariants

### Git history changes

- A local rewrite is a separate user action from remote publication. Capture branch and HEAD, validate an exact operation range, and use compare-and-swap when updating refs.
- Squash only a unique contiguous oldest-first parent chain reaching the captured tip; reject stale snapshots and unsafe merge/range shapes.
- Publish rewritten history only with an explicit confirmation and exact expected-OID lease. Ordinary push remains fast-forward-only.
- Preserve final tree/index/working tree and required signature-loss consent. Never publish automatically after editing or squashing commits.

### Native Advisor

- Advisor belongs to the server's native `advisor` service and direct React panel. Do not reintroduce plugin SDK, runner, iframe, nested React root, or MessagePort bridge.
- Keep it per-server and default-off; data operations require ordinary session authentication and the current administrator role. No-auth is explicitly denied.
- Keep history and evaluation sources read-only. Persist only the server feature toggle and supported routing changes; route updates use strict revision CAS and atomic owner-only replacement.
- Bound model discovery and fall back to normalized static catalogs when discovery cannot produce a usable catalog. Reject credential-like policy fields; preserve unrelated valid policy values.
- Bind client/provider work to the selected profile/generation and abort/discard superseded requests.

See the [Native Advisor guide](./architecture/native-advisor.md) and [Advisor configuration](./configuration/advisor.md).

### Agent Status

- Correlate terminal ID with PTY incarnation and fence updates with reporter epochs and leases.
- Keep semantic agent state separate from process state, workflow completion, and idle-suspend activity.
- Never infer successful completion from silence, disconnect, stale report, or turn end. Do not transmit prompts, transcript text, commands, or native session paths.
- Keep OMP on its private loopback WebSocket collector and native Codex/Claude ingress on the protected Unix socket with peer-credential verification.

See the [Agent Status contract](./architecture/agent-status.md).

### Cognito Mode

- Keep activation ephemeral; persist only the user preference fields supported by configuration. Treat the overlay as a visual in-app mask, not authorization, content redaction, or an OS capture boundary.
- Maintain input isolation through event capture, the app-content inert/hidden boundary, and a usable keyboard dismissal path. Restore focus and listeners on deactivation/unmount.
- Current checked-in Heavy Blur CSS is `blur(16px) saturate(180%)` over `rgba(148, 163, 184, 0.12)` when backdrop-filter is available. Unsupported and reduced-transparency modes use opaque black. Do not copy older values from historical notes without checking `packages/ui/src/index.css`.

## Git, auth, and transport security

- Derive actor identity and role from validated server authentication state; never trust request-body actor or role claims.
- Use exact allowed origins for credentialed browser requests. Keep auth/session cookies, bearer credentials, tickets, and encryption material out of URLs and logs.
- Bind one-shot media/file capabilities to actor, profile client namespace, target, purpose, and revision/incarnation; revalidate after asynchronous work.
- OPAQUE/AES encrypted writes must use one captured owner transport for authentication, encryption flow, and final write. Do not downgrade stale operations to plaintext or another profile.
- Development `--no-auth` must be bound to loopback and must never be described as a production option. Native Advisor remains forbidden under this mode.

## Testing and delivery

- Place tests next to small domain units; use `server/tests/` for cross-module server behavior, `packages/ui/src/**/*.test.ts(x)` for headless unit tests, `packages/ui/browser-tests/` for real-browser component integration, and `packages/ui/e2e/` for application journeys.
- Test success and denial paths, stale generations, cancellation, unavailable owners, limits, and failure cleanup where those contracts apply.
- Distinguish mocked component tests from real HTTP/browser/deployment qualification. Record platform/version limitations; do not turn prior test counts into a claim of current release qualification.
- Run repository-supported commands from `package.json` and package manifests. `pnpm test` runs server tests, `pnpm test:all` runs the repository test script, `pnpm lint` covers `apps/` and `packages/`, and `pnpm check` is the broad root gate.
- **4-Tier Runner Boundaries (see [Testing guide](./testing.md)):**
  - **Tier 1 — Rust Backend Tests (`cargo test`):** Unit and integration suites against real filesystems and repositories; avoid mocks for Git CAS, PTY, and SQLite persistence.
  - **Tier 2 — Frontend Unit Tests (Vitest jsdom):** Headless execution of stores, reducers, hooks, and data utilities under `packages/ui/src/**/*.test.{ts,tsx}`.
  - **Tier 3 — Browser Component Regressions (Vitest Browser Mode):** Headless Chromium suites under `packages/ui/browser-tests/**/*.browser.{ts,tsx}` on ports 15173 and 15174 for focused DOM/xterm/advisor component verification.
  - **Tier 4 — Application E2E Journeys (`@playwright/test`):** Full end-to-end user journeys under `packages/ui/e2e/**/*.spec.ts` against built web SPAs, production server containers, and real MongoDB instances.
- **Deterministic Auth Seeding:** Application E2E tests bootstrap sessions using the canonical `application_e2e_seed` tool and browser `storageState`, preventing test coupling to login UI flows. `--no-auth` must not be used for authenticated application journeys.
- **Visual Evidence Capture Policy (`capture-policy.ts`):** E2E evidence must capture the complete viewport (1440x900 default, 320px narrow dock), validate PNG IHDR dimensions, and colocate machine-readable `evidence.json` and human `review.md` records in `packages/ui/e2e/<case>/`. Visual capture is disabled by default in CI (`CI=true` / `E2E_CAPTURE=0`) for functional parity without artifact bloat. Green automation does not bypass mandatory human visual review.
- **Version Alignment (13-File Invariant):** Repository version bumps require synchronizing 13 distinct version files across Cargo manifests, npm manifests, Tauri configs, and installer metadata. Localized utilities like `apps/native/scripts/bump-version.js` update only 4 native files and must always be validated against `node deploy/release/check-version-alignment.mjs`.

## Retired plugin documentation

The D00–D05 trusted plugin platform, runner, SDK, plugin endpoints, and host bridges are retired. Agent Store distribution is a separate current feature and is not the retired plugin host. Former specifications are consolidated in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md); do not use retired contracts to design current code.
