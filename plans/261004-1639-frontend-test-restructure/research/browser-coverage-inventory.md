# Project-wide browser coverage inventory

Date: 2026-10-04. Static source inventory only; **no suites executed**. Scope: current checkout, not historical pass claims.

## Counts and runner scope
- `packages/ui/browser-tests`: 53 files, 259 declared test cases; 45 component harnesses, 7 browser utilities, 1 real-backend component harness.
- `packages/ui/e2e`: 3 files / 3 declared cases; all mount components, none navigates the complete application.
- Parent validation: 53 unique matrix rows, all 53 current suite filenames accounted for; row case totals sum to 259. Declarations are not runtime pass/coverage counts.
- General config: `packages/ui/vitest.browser.config.ts`, Chromium, port 15173, serial files; 52 browser suites + 3 E2E-labelled harnesses. Specialized config: `vitest.advisor-routing.browser.config.ts`, port 15174, advisor-routing only.
- Versions: Vitest and `@vitest/browser-playwright` 4.1.5; underlying Playwright 1.61.1 (`packages/ui/package.json`). No current dedicated Playwright Test app config.
- `test:browser` runs both configs. PR gate `.github/workflows/pr-quality-gate.yml` runs that command; `scripts/run-all-tests.sh` runs it under `CI=1` with process-group ownership.

## Screenshot contamination and CI gaps
- `browser-tests/advisor-routing.browser.tsx:153-157` writes an isolated AdvisorPanel capture to the canonical advisor E2E screenshot using an absolute workstation path. The advisor E2E-labelled source itself does not capture. Current image shows isolated Advisor; original image run/revision provenance not established. **Do not call it fresh app evidence.**
- `e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx:139-144` captures the injected 320px component, not application navigation/layout, with another absolute path.
- Both use `!import.meta.env.CI`; neither config maps CI into browser environment. [INFERENCE] These guards cannot reliably implement Node CI policy; runtime CI behavior was not exercised in this inventory.
- Both configs omit `browser.screenshotFailures`; [Vitest v4 default](https://v4.vitest.dev/config/browser/screenshotfailures) enables screenshots when headless tests fail. Apply shared Node capture policy, retain assertions.
- `e2e/e2e-capture-helper.ts` has intended local-on / CI-off precedence but no callers among these captures. Retire arbitrary buffer API in favor of genuine app captures; component output never overwrites app evidence.

## Current suite matrix
Paths relative to `packages/ui/browser-tests/`. “Component” includes mocked APIs/stores and MemoryRouter harnesses; “utility” uses browser/xterm/iframe APIs without the complete app. Disposition: retain useful behavior in Vitest; remove only incidental/redundant touched assertions and cross-scope screenshot writes.

| Suite | Observable behavior/workflow | Setup | Declared cases | Disposition |
|---|---|---|---|---|
| `terminal-fit-ownership.browser.ts` | Terminal initial attachment fit scheduler, canvas/WebGL renderer selection, and geometry retention while hidden. | Browser utility | 1 | Retain |
| `terminal-replay-integrity.browser.ts` | xterm buffer replay and stream gate state machine: prompt replacement, cursor preservation, delta replay. | Browser utility | 4 | Retain |
| `terminal-cursor-geometry-adapter.browser.ts` | Cursor geometry normalization under CSS zoom/transforms, debounce coalescing, detachment cleanup. | Browser utility | 5 | Retain |
| `terminal-floating-panels.browser.tsx` | Floating tool panel activation on focus/pointer hit-test, tool ownership across Git/Ports/Fleet switches. | Component | 3 | Retain |
| `terminal-history-list.browser.tsx` | Terminal command history modal: item selection, multi-line command insertion rejection, Escape close. | Component | 3 | Retain |
| `terminal-notification-ui.browser.tsx` | Notification center drawer: unread list, mark-all-read, item selection, focus return on Escape. | Component | 9 | Retain |
| `terminal-panel-replay-notifications.browser.tsx` | TerminalPanel lifecycle: chunk queueing during replay, newline semantics, bell notification trigger. | Component | 13 | Retain |
| `terminal-pin-persistence.browser.tsx` | Tab pin protection across remount, pin toggle, preventing accidental closure of pinned tab. | Component | 1 | Retain |
| `terminal-scroll-buttons.browser.tsx` | Scroll overlay rail buttons: continuous scroll, click outside dismissal, Escape handling. | Component | 6 | Retain |
| `terminal-title-ordinals.browser.tsx` | Terminal tab ordinal numbers (`#1`, `#2`): truncation preservation, per-project ordinal renumbering. | Component | 5 | Retain |
| `terminal-traditional-projects.browser.tsx` | Multi-terminal split layout: scoped project status, split tab restoration, plus-action routing. | Component | 9 | Retain |
| `terminal-zoom-production.browser.tsx` | xterm production split layout under browser zoom: cell visibility, non-scrollable wrappers, mouse selection alignment. | Component | 2 | Retain |
| `pane-terminal-accessory.browser.tsx` | Pane accessory placement in terminal area, retargeting active session, search focus retention. | Component | 2 | Retain |
| `terminal-commit-status.browser.tsx` | Latest git commit status chip in terminal header: toggle persistence and active session tracking. | Component | 1 | Retain |
| `git-history-dialog.browser.tsx` | Git commit edit dialog: terminal input handoff, replacing commit row on save, restoring input on cancel. | Component | 2 | Retain |
| `git-history-search-persistence.browser.tsx` | Git log search toolbar: query persistence, clear button, Escape dismiss, IME composition handling. | Component | 6 | Retain |
| `git-squash-dialog.browser.tsx` | Interactive git squash modal: checkbox selection, dismissing blocks while pending, terminal input unlock on commit. | Component | 4 | Retain |
| `ssh-forward-availability.browser.tsx` | Host capability gating: TopNav SSH Forwarding route hidden in web/mobile, visible only in desktop native host. | Component | 2 | Retain |
| `ssh-forward-credential-dialog.browser.tsx` | Passphrase modal: username/password vs private key input modes, form validation, submit handoff. | Component | 1 | Retain |
| `ssh-forward-multi-connection.browser.tsx` | Explicit connect flow: host trust approval, independent active connection management, port forwarding toggles. | Component | 3 | Retain |
| `ssh-forward-route-gating.browser.tsx` | DamHopperApp route guard: route non-match and suppressed API calls for unauthorized hosts. | Component | 3 | Retain |
| `host-resource-monitoring.browser.tsx` | Fleet overview & diagnostics modal: keyboard dismissal, metric fallback on snapshot failure, threshold alerts. | Component | 19 | Retain |
| `host-resource-sse-cutover.browser.tsx` | SSE stream cutover in HostResourcePopover: seamless metric update without flicker, multi-profile fleet card. | Component | 4 | Retain |
| `idle-suspend-settings-status.browser.tsx` | Idle suspend timing settings & status card: bounded validation, form submission, force-suspend confirmation dialog. | Component | 16 | Retain |
| `browser-bridge.browser.ts` | Browser bridge communication: iframe MessageEvent protocol, hostile text payload safety, origin whitelist rejection. | Browser utility | 4 | Retain |
| `browser-debug-keep-alive.browser.tsx` | Embedded debug iframe persistence: retaining DOM instance across viewport resize and active terminal switch. | Component | 2 | Retain |
| `browser-debug-panel.browser.tsx` | Browser debug panel: custom viewport dimension commits, capture controls, mobile emulation preset selection. | Component | 7 | Retain |
| `script-interaction.browser.tsx` | HtmlPreview sandboxed iframe: script execution, DOM counter manipulation, form submission under sandbox policies. | Component | 4 | Retain |
| `explorer-image-preview.browser.tsx` | Image preview modal: native raster fixture rendering via opaque tickets, zoom controls, pan bounds. | Component | 7 | Retain |
| `explorer-video-playback-download.browser.tsx` | Video preview modal: VP8 webm fixture playback via time-bound tickets, play/pause controls, download action. | Component | 6 | Retain |
| `file-tree-language-navigation.browser.tsx` | Language file tree explorer: scan metadata rendering, deterministic tree sorting, keyboard navigation. | Component | 5 | Retain |
| `mobile-terminal-accessory-bar.browser.tsx` | Mobile accessory bar: 44px touch targets, raised terminal keyboard alignment, overflow actions. | Component | 10 | Retain |
| `mobile-workspace-shell.browser.tsx` | Mobile shell responsive viewport: floating menu trigger positioning, short terminal viewport accommodation. | Component | 5 | Retain |
| `workspace-advisor.browser.tsx` | Persistent workspace advisor placement: DOM preservation across IDE/Terminal/compact shell transitions. | Component | 2 | Retain |
| `workspace-page-notification-navigation.browser.tsx` | Workspace notification popup: agent notification click navigating to and focusing target xterm instance. | Component | 3 | Retain |
| `workspace-workflow-terminal-continuity.browser.tsx` | Session continuity: maintaining single xterm session and workflow state across layout transitions. | Component | 1 | Retain |
| `workflow-context-surface.browser.tsx` | Workflow context deck & sheet: Plan creation, note/session history recording, compact breakpoint adaptation. | Component | 3 | Retain |
| `android-chrome-input-policy.browser.ts` | Virtual keyboard input policy: DOM input lock/restore on blur/unmount, user-agent desktop bypass. | Browser utility | 4 | Retain |
| `app-zoom.browser.tsx` | Global layout zoom: root CSS zoom application, portal scaling, persistence, compact workspace boundary crossing. | Component | 4 | Retain |
| `cognito-mode.browser.tsx` | Cognito privacy mode regressions: shortcut toggle, overlay focus trapping, inert document root, style variant changes. | Component | 10 | Retain |
| `consumer-context-menu.browser.tsx` | Consumer context menus: touch long-press detection, editor tab context menu, nested submenu focus. | Component | 10 | Retain |
| `global-native-context-menu-suppression.browser.tsx` | Window contextmenu handler: suppressing native browser right-click menu except on configured editable elements. | Browser utility | 1 | Retain |
| `viewport-context-menu.browser.tsx` | Radix context menu portal positioning: viewport boundary clamping, coordinate alignment outside parent CSS transforms. | Browser utility | 6 | Retain |
| `project-target-selector.browser.tsx` | Target selector dropdown: radio keyboard navigation, disabled unavailable worktrees. | Component | 2 | Retain |
| `project-worktree-target.browser.tsx` | Workspace worktree target switching: switching active project root and launching target terminal. | Component | 1 | Retain |
| `search-panel-focus.browser.tsx` | Global search panel: input focus retention across desktop and compact workspace layout transitions. | Component | 2 | Retain |
| `advisor-routing.browser.tsx` | Loopback server-backed advisor routing: active policy fetch, duplicate route validation, cancel, persistence readback. | Backend-backed component | 5 | Retain (component regression; remove screenshot to e2e/) |
| `settings-usage-insights.browser.tsx` | Usage insights settings: enabling/disabling Codex usage telemetry, secret redaction, live setup action. | Component | 9 | Retain |
| `usage-page.browser.tsx` | Usage metrics page: URL filter persistence, keyboard filter controls, aggregated cost/token display. | Component | 8 | Retain |
| `usage-session-audit.browser.tsx` | Usage audit list: token usage breakdown, degraded fact indicators without tree control leaks. | Component | 6 | Retain |
| `agent-status-bridge.browser.tsx` | Agent status badge & toast: inactive route badge isolation, silent reconnect, notification permission denial handling. | Component | 2 | Retain |
| `markdown-preview.browser.tsx` | Markdown rendering: inline/fenced code separation, Mermaid diagram SVG rendering with syntax error fallback. | Component | 3 | Retain |
| `markdown-view-mode-persistence.browser.tsx` | Markdown view mode (preview/raw/split): persistence across file switches and workspace reloads. | Component | 3 | Retain |

## Three E2E-labelled cases: only planned migrations
| Current folder | Existing setup and missing integration | Planned actual-app journey |
|---|---|---|
| `privacy-heavy-blur` | Fake header/sidebar/content + CognitoModeOverlay; direct store toggle; exact-style assertions; no capture in source | Real connected Workspace/file, Settings privacy choice, keyboard activation/input isolation/dismissal; full masked app evidence |
| `advisor-model-dropdown-theme` | RouteFieldset + injected catalog/draft/vi.fn; class/style assertions; no capture in source | Enable/open Workspace Advisor → Configuration → Edit Routing → save; independent policy API/file readback + reload |
| `counsel-evaluations-responsive` | EvaluationsView + injected AppState in 320px container; text/count checks, absolute capture | Actual Advisor Evaluations, seeded on-disk docs, inspect/compare; resize legal dock width in complete app; geometry/overflow proof |

Do not blindly relocate three old files as browser components. Existing cognito/advisor component suites already cover useful behavior; keep only genuinely distinct browser regressions, discard incidental exact-class/style/text assertions in touched cases.

## Coverage outside UI
| Path / runner | Actual scope | Disposition / limitation |
|---|---|---|
| `apps/native/scripts/smoke-browser-debug.mjs` | Built-asset/runtime preflight and validation of externally supplied native evidence (10 evidence checks); Windows WebView2 probe | Retain; an evidence validator is **not** autonomous UI interaction or fresh app capture |
| `apps/native/scripts/smoke-ssh-forward.mjs`, `src/smoke-ssh-forward.test.ts` | Native artifact/schema/14-check evidence validation | Retain; validation does not itself execute human/native UI workflows |
| `apps/native/src-tauri/tests/ssh_forward_e2e.rs` | Real Windows ssh.exe/sshd.exe forwarding and TCP closure; opt-in `RUN_NATIVE_E2E=1` | Retain native infrastructure E2E; not web routing/layout |
| `apps/native/src` host unit files | Host capability/preferences/smoke validator tests | Retain unit scope; no native visual qualification inferred |
| `packages/browser-bridge/src/{bridge-channel,extension-presence,parent-origin,protocol,browser-observers}.test.ts` | Five jsdom/Node unit files; protocol/origin/observer safety | Retain; real browser iframe utility coverage in UI browser-bridge suite |
| `apps/browser-extension/` | No package-local automated test discovered; web staging + indirect bridge checks | Record real extension install/handshake workflow gap |
| `scripts/qualify-phase09-workbench.mjs` | Two real backend processes; HTTP/WS qualification plus two Vitest workflow/terminal harnesses | Retain integration qualification; not current full-app Playwright coverage |
| `tests/deploy/linux-release-web-contract.sh` | Built assets/runtime-config/health contract assertions | Retain distribution contract, not app user journeys |

## Additional integrated workflow gaps (ranked)
These are gaps in a **current actual-app runner**, not claims that low-level behavior lacks tests. Retained component/utility/backend/manual qualification still valuable.
| Priority | Workflow | Existing targeted coverage | Missing integrated acceptance |
|---|---|---|---|
| P1 | Docked/split/mobile layout | floating/traditional terminal, mobile shell, zoom, advisor placement | Real editor+terminal+Advisor bounds, resize/refit and short/narrow viewport interaction; initial evaluations case closes one slice |
| P1 | Profile/project/worktree switching | target/worktree/host/SSH/notification owner harnesses, backend qualification | Switch owner with active files/PTYS; no stale response/credential/data crossover across shell navigation |
| P1 | Persistent Settings + policy | usage/cognito settings, real-backend advisor component | UI save → production store/file readback → reload; initial Advisor case closes routing only; login/MFA/preferences still gaps |
| P1 | Privacy/dialog isolation | cognito guard, context menus, modal focus, terminal harnesses | Actual Monaco/xterm/portals under app guard with real input; initial privacy case closes selected app surface only |
| P1 | Terminal/workflow/notification continuity | replay, pinning, workflow continuity, notification navigation | Real PTY/WS reconnect, route change and background notification target navigation without duplicate sessions |
| P2 | Files/edit/search + Git publication | language/search focus/markdown/target and Git dialogs; backend tests | App edit/save/reload/replace target ownership; real repository mutations, CAS/leased push and conflict dialogs |
| P2 | Media session + logout | native image/video ticket fixture tests | Real server capability issuance/download/logout/reconnect across profile generations |
| P2 | Usage/host/Browser/extension/native host | usage/host/SSE/bridge/debug harnesses and external native evidence validators | Actual route data refresh/permission/reconnect; extension install/handshake; native WebView/child lifecycle visual workflows |

## Decisions / unresolved questions
Confirmed: dedicated `test:e2e` with Playwright Test; retain Vitest components; replace only three misleading cases. Parent selected production server + isolated Mongo/AuthStore, deterministic preauthenticated session setup, shared Node capture policy. No design question for user; fresh human review remains implementation-time acceptance. Full source and decision details: sibling phase files and acceptance matrix.
