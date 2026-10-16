# Code Standards

These standards describe the current Rust backend, shared React UI, and profile-aware transport model. The retired plugin platform is not normative; see the [roadmap](./project-roadmap.md) and [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md) for retirement status.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `server/src/api/` | Axum route registration, handlers, auth, and WebSocket/API transport |
| `server/src/{auth,config,crypto,fs,git,pty,workflow,agent_status}/` | Backend domain boundaries and services |
| `server/src/state.rs` | Shared server `AppState` and service ownership |
| `packages/ui/src/api/` | Owner-bound API clients, connections, DTOs, transports, and query keys |
| `packages/ui/src/components/`, `hooks/`, `stores/`, `lib/` | Shared React UI and client-side domain behavior |
| `apps/web/`, `apps/native/` | Vite browser and Tauri desktop hosts |
| `server/tests/`, colocated Rust tests, `packages/ui/browser-tests/` | Backend and browser-level behavioral coverage |
| `native-app/` | Android native client root (KMP + Jetpack Compose, Phase 01 baseline, planned Phase 02+ implementation) |

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

### UI Selection Contrast & Adaptive Typography Invariants

- **Selection System (`.workbench-selection`):** Active row/list items must use the high-contrast semantic selection tokens (`--color-selection`, `--color-selection-border`, `--color-selection-text`, `--color-selection-hover`) via the shared `.workbench-selection` utility. Left indicators use inset box-shadow (`box-shadow: inset 3px 0 0 var(--color-selection-border)`) to prevent layout shifts. Keyboard focus (`:focus-visible`) uses an outline (`2px solid var(--color-selection-border)`) to coexist with the inset left indicator.
- **Adaptive Typography (`--app-font-size`):** The "System font size" user setting (`systemFontSize`) updates `--app-font-size` on `:root`. All semantic typography tokens (`--text-2xs` through `--text-2xl`) in Tailwind `@theme` are derived from `--app-font-size` with unitless companion line heights.
- **Root Font & Layout Invariance:** `html` font size is never dynamically altered; layout `rem` dimensions (spacing, padding, container widths, hit target heights) remain stable. App zoom (`--app-zoom`) operates independently.
- **Editor & Terminal Font Independence:** Monaco code editor (`editorFontSize`) and xterm terminal (`terminalFontSize`) maintain independent font size configurations and must never be driven by `--app-font-size`.
- **Virtualized Trees (`FileTree`):** Uniform item row heights in Arborist are computed dynamically using `getFileTreeRowHeight(systemFontSize)` from `@/lib/workbench-typography.js` to ensure content never clips across the supported 10–32px range without resetting scroll or unmounting trees.

### Kotlin Multiplatform and Android Native Client (`native-app`)

- **Ownership & Connection Scoping:** Mirror React/web invariants; asynchronous operations must capture `ConnectionRef = { profileId, generation }` and recheck upon resume. Never route through ambient fallback.
- **Strict Boundary Constraints:** No WebView, embedded browser engine, local PTY, local Git, or local AI execution in `native-app/`. Remote Rust backend owns PTY, Git, agent, and remote workbench operations, while UI rendering, Android Keystore credential storage, and client cryptography execute locally. Embedded interactive HTML preview and rendered Mermaid diagrams are the sole deferred preview exceptions; native Markdown, media, and large binary file viewing remain in scope.
- **Presentation Invariants:** Strict TERMINAL mode (`workspaceMode = "terminal"`) and Traditional terminal presentation (`terminalUsageMode = "traditional"`). Single top horizontally scrollable panel-navigation row; zero floating action buttons (FABs) or draggable triggers.
- **Module Separation:** Kotlin Multiplatform `commonMain` (`native-app/shared/`) owns domain models, networking, DTOs, and Compose UI; platform adapters in `androidApp/`. Never leak Android platform types into `commonMain`.
- **Wire Projection:** Wire requests omit client-only `profileId`; backend authenticates and authorizes project/worktree paths.
- **Filesystem Wire Invariants:** File, directory, stat, read, and mutation operations pass the explicit `ProjectTargetRef`; write operations use chunked streaming with expected mtime compare-and-swap (CAS).
- **Watcher Registration & Invalidation:** Directory watcher subscriptions must register event listeners before dispatching subscription requests to prevent race windows, and reconcile snapshot/event ordering cleanly without relying on unbounded buffering.
- **Search & Replace Constraints:** Enforce literal non-regex replacement without wildcard interpolation; cap federated search at 500 aggregate matches; batch replace must re-verify match presence and use read-to-write CAS; require explicit dirty buffer checks before writing.
- **Encrypted Transfers & Envelope Parity:** Encrypted writes and uploads must assemble payloads into the server-compatible envelope format (`iv(12) || ciphertext + tag(16)`) using AES-256-GCM. Metadata JSON (`FileBlobMetadata`/`TextBlobMetadata`) must not exceed 4,096 bytes and must be separated from binary payload by a single `0x00` byte. Enforce a 100 MiB envelope limit where applicable; plaintext capacity is bounded by 100 MiB minus metadata and crypto envelope overhead. Never fall back to plaintext on encryption failure or missing cryptographic session (`encryptedRequested` must fail closed).
- **Cryptographic Session Lifecycle & Zeroization:** Derived 32-byte AES keys must be held in generation-fenced, `AutoCloseable` session containers (`CryptoSession`) that overwrite key arrays with zeroes upon closure (`keyBytes.fill(0)`). Note JVM garbage collection limitations regarding byte array zeroization. Connection and session validity must be revalidated across all asynchronous boundaries throughout multi-step transfers.
- **Chunked Transfer State Machines:** Binary chunk transfers over WebSocket must use atomic header and binary frame pairs (`sendAtomicPair`), a 64 KiB default chunk size, monotonic request IDs, and pre-registered chunk acknowledgement listeners. In-flight commit timeouts must report `UnknownOutcome` to mandate server state verification before retry.
- **Android SAF Storage Scoping:** Document storage on Android must utilize Storage Access Framework (SAF) scoped content URIs (`DocumentStorage`, `AndroidDocumentStorage`) rather than requiring broad external storage permissions. Filenames must be sanitized, and reads/writes must stream in bounded chunks rather than buffering entire files in memory.
- **Media Streaming & Cookie Isolation:** Native media streaming must follow the [Media Isolation and Encryption Architecture](./architecture/media-isolation-and-encryption.md), adapting browser cookie contracts to native HTTP/player stacks. Requests must enforce canonical UUIDv4 `mediaClientId`, namespaced session cookies (`damhopper-media-session-<uuidv4>`), fail-closed cookie verification, redirect rejection (`followRedirects(false)`, `followSslRedirects(false)`), strict same-origin checks, and closed `purpose` capability segregation (`PLAYBACK` vs `DOWNLOAD`).
## Domain-specific invariants

### Git history changes

- A local rewrite is a separate user action from remote publication. Capture branch and HEAD, validate an exact operation range, and use compare-and-swap when updating refs.
- Squash only a unique contiguous oldest-first parent chain reaching the captured tip; reject stale snapshots and unsafe merge/range shapes.
- Publish rewritten history only with an explicit confirmation and exact expected-OID lease. Ordinary push remains fast-forward-only.
- Preserve final tree/index/working tree and required signature-loss consent. Never publish automatically after editing or squashing commits.

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

- Derive actor identity and role from validated server authentication state; never trust request-body actor or role claims, and never treat the server's `server-token` JWT signing secret as a client bearer credential.
- Keep MongoDB as the default authentication store (`DAM_HOPPER_LITE_MODE` unset, empty, `false`, or `0`) and select SQLite lite mode strictly via `DAM_HOPPER_LITE_MODE` (`true` or `1`, trim/case-insensitive) with optional `DAM_HOPPER_AUTH_SQLITE_PATH` (default `auth.db` in global config; production uses absolute local storage). Enforce one server process per local SQLite auth file, forbid network/shared filesystems, never auto-detect or fall back between backends, and fail startup on invalid `DAM_HOPPER_LITE_MODE` values or SQLite initialization failure. Production authenticated mode requires a valid dedicated 32-byte owner-only `DAM_HOPPER_MFA_KEY_FILE`.
- Keep `POST /api/auth/register` disabled by default (`user` role, `auth_version = 0`) with no automatic first-user `admin` rights or public promotion endpoint; unapproved login returns `401 ACCOUNT_DISABLED` until an operator approves and, when intended, promotes the account via the canonical [Operator Account Approval and Role Promotion Runbook](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook).
- Use exact allowed origins for credentialed browser requests. Keep auth/session cookies, bearer credentials, tickets, and encryption material out of URLs and logs.
- Bind one-shot media/file capabilities to actor, profile client namespace, target, purpose, and revision/incarnation; revalidate after asynchronous work.
- OPAQUE/AES encrypted writes must use one captured owner transport for authentication, encryption flow, and final write. Do not downgrade stale operations to plaintext or another profile.
- Development `--no-auth` must be bound to loopback, is never SQLite lite mode, and must never be described as a production option.

## Testing and delivery

- Place tests next to small domain units; use `server/tests/` for cross-module server behavior, `packages/ui/src/**/*.test.ts(x)` for headless unit tests, `packages/ui/browser-tests/` for real-browser component integration, and `packages/ui/e2e/` for application journeys.
- Test success and denial paths, stale generations, cancellation, unavailable owners, limits, and failure cleanup where those contracts apply.
- Distinguish mocked component tests from real HTTP/browser/deployment qualification. Record platform/version limitations; do not turn prior test counts into a claim of current release qualification.
- Run repository-supported commands from `package.json` and package manifests. `pnpm test` runs server tests, `pnpm test:all` runs the repository test script, `pnpm lint` covers `apps/` and `packages/`, and `pnpm check` is the broad root gate.
- **4-Tier Runner Boundaries (see [Testing guide](./testing.md)):**
  - **Tier 1 — Rust Backend Tests (`cargo test`):** Unit and integration suites against real filesystems and repositories; avoid mocks for Git CAS, PTY, and SQLite persistence.
  - **Tier 2 — Frontend Unit Tests (Vitest jsdom):** Headless execution of stores, reducers, hooks, and data utilities under `packages/ui/src/**/*.test.{ts,tsx}`.
  - **Tier 3 — Browser Component Regressions (Vitest Browser Mode):** Headless Chromium suites under `packages/ui/browser-tests/**/*.browser.{ts,tsx}` on ports 15173 and 15174 for focused DOM/xterm component verification.
  - **Tier 4 — Application E2E Journeys (`@playwright/test`):** Full end-to-end user journeys under `packages/ui/e2e/**/*.spec.ts` against built web SPAs and production server containers with real MongoDB instances or isolated SQLite lite mode (`authBackend: "sqlite"`, starting no MongoDB container).
- **Deterministic Auth Seeding:** Application E2E tests bootstrap sessions using the canonical `application_e2e_seed` tool (supporting both MongoDB and `--sqlite-path` / `DAM_HOPPER_AUTH_SQLITE_PATH`) and browser `storageState`, preventing test coupling to login UI flows. `--no-auth` must not be used for authenticated application journeys.
- **Visual Evidence Capture Policy (`capture-policy.ts`):** E2E evidence must capture the complete viewport (1440x900 default, 320px narrow dock), validate PNG IHDR dimensions, and colocate machine-readable `evidence.json` and human `review.md` records in `packages/ui/e2e/<case>/`. Visual capture is disabled by default in CI (`CI=true` / `E2E_CAPTURE=0`) for functional parity without artifact bloat. Green automation does not bypass mandatory human visual review.
- **Version Alignment (13-File Invariant):** Repository version bumps require synchronizing 13 distinct version files across Cargo manifests, npm manifests, Tauri configs, and installer metadata. Localized utilities like `apps/native/scripts/bump-version.js` update only 4 native files and must always be validated against `node deploy/release/check-version-alignment.mjs`.

## Retired plugin documentation

The D00–D05 trusted plugin platform, runner, SDK, plugin endpoints, and host bridges are retired. Agent Store distribution is a separate current feature and is not the retired plugin host. Former specifications are consolidated in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md); do not use retired contracts to design current code.
