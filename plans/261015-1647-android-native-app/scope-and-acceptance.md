# First Android Release — Scope and Acceptance Ledger

Authority: [user decisions](./research/decision-context.md), [proposed architecture](../../docs/architecture/android-native-client.md). Baseline server0.13.2 / workbenchProtocol2 / authProtocol2; exact supported build/schema matrix frozen in Phase01. This ledger is a planned contract, not passed acceptance.

## Included behavior

| ID | Feature / required behavior | Owning phase | Observable acceptance |
| --- | --- | --- | --- |
| A01 | Per-server profiles, endpoint/account edits, independent connection state and secure credentials | 03–04 | Two equal-name servers stay isolated through reconnect/profile replacement/logout |
| A02 | Registration-disabled notice, password login, TOTP setup/verify, step-up/rotation, expiry/revocation | 04 | Real authenticated flows and denial codes; no signing-secret login or synthetic refresh API |
| C01 | TERMINAL-only Traditional shell, project/global workspace discovery/known registry/init/switch, commands/profiles | 06 | No IDE/Runtime mode or mode switchers; correct target labels and remote PTY lifetime |
| NAV01 | One top panel-button row below server/project header; icon + short text; single-line horizontal scroll; always visible with IME; one selected content area on all sizes; no floating buttons | 06,17–18 | Reach every panel without wrapping, More menu or secondary navigation; panel selection retains terminal/controllers but only active content accepts input; no wide-screen terminal/panel docking |
| C02 | Project config/global config/defaults/UI preferences; separate settings target and preference source | 06,17 | Change selected owner only; server validation/conflicts visible |
| T01 | List/create/rename/kill/remove terminal sessions, process restart and command lifecycle | 07 | Actual remote PTY; identity/incarnation retained; uncertain create/input not replayed |
| T02 | Attach/replay/reset/truncated tail, lag recovery, grid resize, search/scroll/select/copy/paste | 05,07 | UTF8-byte continuity and TUI/input/rotation/lifecycle proof; no duplicate PTY or keystrokes |
| T03 | Agent roster/status filters, exact session activation, integration settings/status/install/uninstall | 07 | Server-authoritative epochs/leases; silence never success; no private ingress from Android |
| F01 | Lazy file tree, CRUD/move/rename, exact-owner subscriptions/overflow/invalidation | 08 | Mutations/watch events never reach wrong profile or root; original-owner cleanup |
| F02 | Filename/content search, federated results, current replace semantics and navigation | 08–09 | Qualified results, 500-match aggregation cap, visible truncation; safe target-bound edits |
| E01 | Native code editor/languages, undo/redo, selection/find/replace, folding/minimap/gutters, zoom and view state | 05,09 | Current behavioral inventory reproduced; native IME and JSON/TS service proof |
| E02 | Dirty/stale/unavailable tabs, mtime save conflict/reload/explicit overwrite, metadata-only persistence | 09 | Concurrent remote changes cannot silently overwrite local edits or another target |
| E03 | Editable inline/side-by-side diff, hunk navigation/revert, three-way conflict acceptance/resolution | 10 | Actual Git files change as intended; read-only/history and mutation gates preserved |
| E04 | Dirty-buffer blame/cache, line-change gutters, current-version commit reveal | 10 | Correct EOL/uncommitted mapping; stale result/reveal rejected; exact root/OID shown |
| X01 | OPAQUE encrypted save/upload, binary/plain transfer contracts, bounded progress/cancellation | 05,11 | Native/current-server interop, mismatch/tamper rejection, no plaintext downgrade |
| M01 | Native Markdown/GFM, image/video preview/download, binary view and range large-file viewer | 09,11 | Ticket purpose/cookie/owner cleanup, seek/range/errors, size-tier boundaries |
| G01 | Roots/branches/history/literal search/commit details, stage/unstage/discard/commit/fetch/pull/normal push | 12 | Real disposable Git repositories; dirty/active-target/read-only guards and progress |
| G02 | Branch mutations/worktrees, edit/squash/drop/cherry-pick/revert/reset/undo and file variants | 06,12 | Server CAS/active-vs-inactive/foreign-worktree protection and signature warnings preserved |
| G03 | Separate leased rewrite publication | 12 | Preview exact expected OIDs; stale remote rejects; never force-push fallback |
| W01 | Manual plan/phase/task workflow, sessions/links/notes/events/history purge | 13 | Strict request identity/CAS; terminal incarnation validation; no inferred completion |
| W02 | Folder-first project plans, overview/timeline and read-only linked documents/watch state | 13 | Declared status not execution evidence; strict bounded reads; explicit unsupported Mermaid render |
| S01 | Agent Store catalog/content/matrix/health/scan/ship/unship/absorb/bulk operations | 14 | Captured server catalog/project distribution only; correct partial failures |
| S02 | Agent import remote/local scans and confirmation; memory templates/read/write/apply | 14 | Server-local scan meaning; preview/selection owner isolation; safe memory saves |
| H01 | Fleet snapshots/detail metrics/alerts/SSE and REST fallback | 15 | Epoch and exact revision pairing; admission, staleness and visibility-lifecycle tests |
| U01 | Aggregate usage/session views, setup/settings/health, retention and confirmed deletion | 15 | Scoped cursors, no raw prompts/commands, real delete barrier and explicit confirmation |
| P01 | Detected ports; server Cloudflared install/create/list/stop/reminders | 16 | Origin/PTy loss does not auto-stop tunnel; reconnect REST catch-up and exposure warning |
| H02 | Idle-suspend status/timing/force/consent; host-action capability presentation | 16 | Live-socket capability and revisions; no automatic suspend retry or privileged fallback |
| C03 | Remote SSH key/agent/credential status/load/forget; diagnostics/cache/reset/TOML import-export | 16–17 | Server-local actions and target-labelled confirmations; no private-key/body logging |
| N01 | Server-observed notifications, sound/vibration preferences and exact-target navigation | 07,17 | Permission denied/offline/stale target safe; privacy-safe lock-screen payloads |
| V01 | Cognito mask/input isolation, font/theme/shortcuts, accessibility, process recreation | 17–18 | Terminal/editor/IME cannot receive input under mask; app font independent of terminal/editor font |

Remaining current UI behaviors are enumerated against actual source in Phase01, not assumed absent because this table is grouped. A discovered included behavior gets a ledger row and phase owner; no silent feature narrowing.

## Explicit first-release exceptions

| ID | Excluded behavior | Approved treatment |
| --- | --- | --- |
| B01 | Embedded interactive HTML/CSS/JS browser preview | HTML source editable; no embedded browser, external-browser substitute or fake screenshot parity |
| B02 | Mermaid rendered through browser/DOM | Source/code fence and clear render-unavailable state; no hidden renderer/service |
| B03 | Browser debug, extension, DOM/postMessage selection bridge | No Android browser-debug product; existing web/extension unchanged |
| B04 | Local Android PTY/Git/agents/SSH forwarding/Linux runtime | Remote server performs execution; remote server SSH credential management remains included |
| B05 | Desktop host/installer, Play release, always-on push/foreground-service stack | Future decisions; no dummy modules or unsupported guarantees |
| B06 | New remote updater/restart/user-admin/LSP/privileged-executor APIs | Not invented as native parity; preserve available remote capabilities only |
| B07 | IDE workspace, Runtime terminal presentation and their mode selectors | TERMINAL + Traditional is the sole supported shell; included editor/management functions remain panels |
| B08 | Floating navigation/actions, FABs and draggable panel launchers | Inline controls in the sole panel row or active panel; no floating shortcut replacement |
| B09 | Additional panel-navigation rows, rail, drawer or overflow-only destinations | One horizontally scrollable button row exposes all included panel destinations |

## Hard gates

- **GATE-A (Phase01–02):** complete scope/behavior ledger, explicit compatible dependency/license/toolchain decisions, reproducible app launch.
- **GATE-B (Phase05):** real device native-terminal/input/replay, native editor/model/language-service path, exact OPAQUE ABI/interop proof. Failure blocks dependent feature implementation; new design or explicit scope approval required.
- **GATE-C (Phase18):** all included rows exercised on real server/native app; no unresolved consumer-visible parity/security issue masked by preview exceptions.
- **GATE-D (Phase19):** installed signed release APK + upgrade/security/license/docs evidence; public compatibility claims limited to tested matrix.

Only GATE-B subpaths that fail block their dependents; unrelated domain design may proceed, but the release cannot bypass the failed retained requirement. No phase completion by scaffold compilation alone.

## Acceptance evidence format

Record per row: requirement ID, source baseline, tested app/server versions, device/model/API/ABI/page size, auth mode/role, fixture targets, command/journey, expected and observed state, artifact references and limitations. Screenshots are redacted full-app captures; terminal/private content and credentials excluded. Human visual review uses explicit ACCEPTED/REJECTED; green CI never fabricates it.

## Open questions / defaults

- Dependency pins and editor service realization are gated work, not presumed facts.
- Freeze named hardware and latency/memory thresholds in Phase01 before performance results; no invented schedule.
- Server baseline starts at0.13.2/protocol2; older/newer builds need explicit compatibility proof.
- Private APK app version is independent (initial proposal0.1.0/versionCode1); existing13-file server/web/Tauri alignment remains intact. If release ownership later unifies versions, deliberately update the checker/invariant rather than silently adding an untracked version source.

## Phase 08 Acceptance Ledger Status (2026-10-16)

- **F01 (Lazy file tree, CRUD/move/rename, exact-owner subscriptions/overflow/invalidation):**
  - **Status:** Host implementation delivered; automated test suites passed (100%); user authorized proceeding to Phase 09 with recorded limitations. Technical code review: CHANGES REQUESTED (6/10). Physical device runtime acceptance pending Phase 18.
  - **Automated Verification:** 194 unit test executions passed (`:shared:jvmTest`, `:androidApp:testDebugUnitTest`, `:androidApp:testReleaseUnitTest`), 57 Phase 08 static assertions in `tests/test-phase-08-filesystem-watchers.sh`, 327 regression checks passed, `:androidApp:assembleDebug` clean.
  - **Documented Limitations:** Server watcher is non-recursive; live events cover root directory (`path=""`). Expanded subfolders rely on client re-fetch upon expand. Socket reconnect rebind requires identity trigger on `Connected(socketRef)`.
- **F02 (Filename/content search, federated results, current replace semantics and navigation):**
  - **Status:** Host implementation delivered; automated test suites passed (100%); user authorized proceeding to Phase 09 with recorded limitations. Technical code review: CHANGES REQUESTED (6/10). Downstream editor integration in Phase 09; full runtime acceptance pending Phase 18.
  - **Automated Verification:** Federated search coordinator, case/literal options, 500-result cap truncation, preview generation, and batch CAS replacement tested and passed.
  - **Documented Limitations:**
    - H1: Permissive UTF-8 decode in `FileRepository.readFile` past 8 KiB boundary risks lossy replace on non-UTF8 files; strict decode / binary handling required.
    - H3: `TimeoutCancellationException` treated as `CancellationException` in batch operations; requires isolating timeout failure from parent job cancellation.
    - H4: Multi-profile federated search resolves secondary profile targets by display name instead of active project/workspace target.
    - H5: Authoritative dirty-buffer provider interface pending Phase 09 native editor implementation; Replace All currently defaults to `isDirtyFile = { false }`.
    - H6: Outcome UI displays counts only; per-file failure/conflict breakdown and multi-server project badges to be surfaced.
    - H7: Mocked WebSocket event integration tests to be expanded in Phase 18 qualification.
