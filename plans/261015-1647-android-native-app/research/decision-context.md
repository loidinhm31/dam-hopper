# Planning Decision Context

## Provenance

- Prior brainstorm: original checkout `plans/reports/brainstorm-261015-0938-native-android-compose-feasibility.md` (untracked there; intentionally not moved or committed).
- This file carries the required context into the new worktree; implementation does not require reading an untracked file in another checkout.
- Current user instruction explicitly authorizes a detailed plan, new branch/worktree and root application directory `native-app/`; not implementation.

## User-approved decisions, 2026-10-15

| Decision | Binding choice |
| --- | --- |
| Execution | Existing remote Rust server; no Android-local PTY/Git/agent runtime |
| UI | Kotlin shared app/state + Compose; platform-native terminal/editor widgets |
| Forbidden runtime | Tauri, WebView and embedded browser engine |
| Workspace mode | TERMINAL only; no IDE shell or workspace-mode switcher |
| Terminal presentation | Traditional only; no Runtime presentation or usage-mode switcher |
| Panel navigation | One in-layout single-line button row for every included panel; horizontal overflow on narrow screens |
| Floating controls | No floating buttons/FABs/draggable launchers or second navigation bar/rail/drawer |
| Row docking | Top, below server/project header |
| Panel-button presentation | Icon + short text; horizontal scrolling, no wrapping or More menu |
| IME visibility | Panel row remains visible while software keyboard is open |
| Panel body | One content area on every screen size; selecting panel hides terminal visually but retains sessions/controllers; no wide-screen dock |
| Android floor | Android10+ / minSdk29 |
| Initial ABI proof | ARM64 physical device and x86_64 emulator; 16KiB-capable environment where applicable |
| Delivery | Signed private APK; Play publication not included |
| Scope | All current non-browser feature families, exposed as panels in the TERMINAL/Traditional shell |
| Editor | Retain current behavior except explicit first-release browser-preview exception |
| Preview exception | Embedded interactive HTML and rendered Mermaid browser previews deferred for FIRST Android release only; source editing/native Markdown remains |
| Desktop | Linux/Windows-compatible shared boundaries; no desktop host/package implementation now |
| Existing products | Web/Tauri left intact; no retirement or root-script cutover without planned explicit integration |

The first-release preview exception supersedes the brainstorm's otherwise blocking combination of full editor-area parity and no browser engine. It does NOT waive native editing, JSON/TS language behavior, safe saves/encryption, diff, merge, blame, range viewing, or native media.

Subsequent user restriction before validation interview: only TERMINAL + Traditional presentation, one row of panel buttons, no floating buttons. This reduces shell/layout scope, not the already approved non-browser feature inventory. Editors and management views remain panel destinations, not a separate IDE mode.

## Required feature inventory

Profiles/authentication/MFA/secure credentials; TERMINAL/Traditional shell and projects/worktrees/configuration; remote terminals, input/replay/session management and server agent status/integrations; file CRUD/watch/search/replace; native editing/languages/diff/merge/blame; encrypted writes/uploads and media; full current Git workflows and safe rewrites/publication; manual workflows and read-only project plans; Agent Store/import/memory; resources/fleet/usage; ports/server tunnels; remote SSH credential status/load; settings/preferences/import/export/diagnostics/cache/reset; server-capability-aware idle suspend/consent and host-action presentation; notifications/privacy/accessibility.

Explicit exclusions: IDE workspace/Runtime terminal presentation and their mode selectors; floating buttons/FABs/secondary panel-navigation surfaces; browser debugging/extension/DOM bridge, embedded browser previews, Android-local command execution, Android-local SSH forwarding, new updater/account administration/LSP APIs, desktop releases, automatic background push service, Doggo/Glean Hub task-sync/domain.

## Workspace

- Original checkout: `/home/loidinh/WS/dam-hopper`.
- New worktree: `/home/loidinh/WS/worktrees/dam-hopper-android-native-app`.
- Branch: `feat/android-native-app`.
- Base: `d897a91f76a07ec819a50ffc2756cb69327b2fe3` (`chore(release): bump version to 0.13.2`).
- Shared Git common directory verified: `/home/loidinh/WS/dam-hopper/.git`.
- Original dirty files left untouched; no stash/commit/cherry-pick of them.
- Reserved app directory empty at plan delivery; future module/source paths are proposals, not files created by this session.

## Planning command

Native `evc-cmd-plan-x-hard` wrapper executed through its installed `createCommand().execute` mechanism with enhanced scope and new-worktree context. Planning and mermaidjs-v11 skill instructions loaded. Parent retains architecture/plan synthesis; completed independent research slices supplied evidence.

Active-plan helper was run with this plan's absolute path; it reported missing `EVCRATE_SESSION_ID`, so session persistence was unavailable. Always pass the explicit plan path to later commands/agents. No global/session configuration was fabricated or changed to hide this limitation.

## Evidence limits

No Kotlin project, APK, dependency lock, device run, terminal integration, JNI artifact, language service or native test exists as an outcome of planning. All implementation phases must start pending. Performance numbers and schedules are not inferred from Doggo or upstream screenshots.

## Unresolved questions

Exact dependency pins, native language-service path, binary/license acceptance, reference-device performance budgets and real integration proof are implementation gates in the plan; scope itself is recorded above.
