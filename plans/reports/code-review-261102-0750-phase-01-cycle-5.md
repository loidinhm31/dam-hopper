# Cycle 5 Code Review — Phase 01: Lifecycle prototype first

## Score: 5/10 — changes required; lifecycle gate not established

### Scope / overall assessment

Focused review of C1/C2 fixes, H4 docking and H5 slot-marker alignment; security, performance, architecture, YAGNI/KISS/DRY. Reviewed current source against Phase 01 requirements and Cycle 4 findings. Read README, relevant PDR/code standards, published development rules and `code-review/SKILL.md` directly.

Real improvements: editor buffers now enter `useEditorStore`, content subscription is reactive, editor resources are deduplicated by tab key, window generations derive from their own profile, terminal merge includes profile identity, cross-desktop docking repairs source focus. However, encrypted-save policy is still bypassable, owner retirement can still enter ambient terminal transport, stale docking targets still orphan windows, and H5's selector remains unchanged.

Report only: no source/plan/task-state edits. No executable product verification run by reviewer; existing Cycle 5 tester results attributed below. Source-derived outcomes explicitly marked `[INFERENCE]`, not runtime reproductions.

## Requested fix disposition

| Item | Disposition | Current evidence |
|---|---|---|
| C1 — buffer creation / dirty tracking | **Partially addressed.** Tab inserted into store, reactive selector feeds Monaco, `setContent` now has a real tab to update. File loading and safe target initialization still missing. | `MonacoKeepAliveHost.tsx:113–148,199–208`; `stores/editor.ts:878–885` |
| C1 — encrypted save policy | **Not resolved.** New provider shadows host policy; policy lookup omits owner; completion is unfenced. | Critical C1 below |
| C2 — selected-profile generation leak | **Addressed structurally.** No generation prop remains in Shell/Canvas/provider; provider subscribes strictly to `window.ctx.profileId`. | `OsShell.tsx:25–27,214–219`; `DesktopCanvas.tsx:9–17,45–50`; `window-context.tsx:23–55` |
| C2 — qualified terminal deduplication | **Addressed for ordinary equal raw IDs across profiles.** Merge key includes profile and backend ID. Prefer canonical tuple helper for collision-free keys. | `OsResourceHost.tsx:210–223`; suggestion S1 |
| C2 — profile fail-closed | **Partial, not resolved.** Initial unknown non-default profiles skipped; retirement is not observed by host and `default` bypass remains. | Critical C2 below |
| C2 — disconnected indicator | **Present, cosmetic only.** Banner reads owner status; it does not gate attachment/input or pin concrete identity. | `TerminalsApp.tsx:40–61,83–100` |
| H4 — cross-desktop source focus | **Addressed structurally for a valid target.** Reconciles focused source placement and uses a boolean pane lookup. No targeted regression inspected. | `window-ops.ts:478–501`; `window-ops.test.ts:143–195` |
| H4 — valid target lookup | **Partial.** Missing desktop now no-op; missing pane in nonempty destination tree remains destructive. | Warning H4 below |
| H5 — slot marker alignment | **Not fixed.** Handler still queries `data-os-window-body`, renderer emits `data-os-window-slot`. | Warning H5 below |

## Critical issues — MUST FIX

### C1 — Encryption policy still bypassed; successful encrypted save can falsely clear newer edits

**Evidence:** `packages/ui/src/os/OsShell.tsx:18,108–109,223–224`; `os/MonacoKeepAliveHost.tsx:110–111,163–185`; `contexts/EncryptContext.tsx:52–65,176–206`; `embed/dam-hopper-app.tsx:334–335,454`; `stores/editor.ts:1318–1332`; `hooks/use-encrypted-write.ts:283–351`.

- Shell adds a fresh `EncryptProvider`, although the application host already owns one. Each provider starts with an empty map and encryption disabled. No OS control enables encryption. On intended host integration, OS therefore shadows the existing policy/session instead of consuming it.
- `isEncryptEnabled(project)` and `getPassphrase(project)` address `ambient:<project>`, not the window's `{profileId,generation}` key. Even with provider shadowing removed, an owner-qualified enabled policy is missed and code calls ordinary `useEditorStore.save` / `fsWriteFile`. **[INFERENCE] A previously encryption-enabled file can be saved via the plaintext path.** Merely adding a `saveText` branch does not enforce policy.
- Encrypted branch lacks tab request-generation/current-owner checks after `await`, does not exclude unavailable/saving/clean tabs, and substitutes an empty passphrase without the existing prompt/session flow. `saveText` checks owner freshness before upload, but not after the final upload response.
- On success, `markSaved` records **current** `t.content` and clears dirty unconditionally. **[INFERENCE] Type B while A is uploading: backend stores A; completion declares B saved.** Close/reopen or reconnect can likewise receive stale completion. This is newly wired OS behavior over a pre-existing helper; the helper alone is not an edit-revision fence.

**Correction:** consume the existing host provider; capture the exact window owner and use it consistently for policy, session/passphrase and write calls. Reuse/extract the established save flow rather than duplicate a partial policy. Fence completion by connection, tab request identity and saved content/edit revision; newer text must remain dirty. Prompt/cancel and display failures explicitly. Never downgrade to plaintext because an owner/policy is unavailable.

**Confidence:** high for provider/key/completion wiring; plaintext/data-loss consequences source-derived, not executed.

### C2 — Initial snapshot filter does not prevent ambient routing after profile retirement

**Evidence:** `packages/ui/src/os/OsResourceHost.tsx:184–208`; `os/apps/TerminalsApp.tsx:22–61,90–96`; `api/connections.ts:339–344,762–790`; `components/organisms/TerminalPanel.tsx:415–438,1095–1116`; `lib/terminal-incarnation-state.ts:44–54,78–85`.

- Host calls `getConnectionSnapshot` inside a memo dependent only on `sessionWindows`; it does not subscribe to connection availability. Removing a known profile leaves its parked `TerminalPanel` in the memoized list even as the window-level provider shows disconnected.
- Removal deletes the snapshot and notifies connection listeners. Existing `TerminalPanel.syncConnection` then chooses `ambient:<generation>` when a qualified profile snapshot disappears; `bindConnection` calls ambient `getTransport()` and enables stdin. **[INFERENCE] Retiring profile A while B remains available can attach A's raw terminal ID through B's ambient transport.** An initial render filter cannot guard this later callback.
- Unknown literal `default` is explicitly allowed through the same ambient-capable path. Imported sessions accept arbitrary nonempty profile IDs; that spelling is not proof of verified ownership.
- Disconnected banner does not prevent slot attachment or input. Incarnation is still the mutable latest observation, not a pinned verified target; TerminalPanel accepts newer incarnations (`549–568,664–695`). The required changed-incarnation unavailable/recovery contract remains absent.

**Correction:** enforce qualified-owner fail-closed at the transport binding boundary, including owner removal and every reconnect; do not route missing qualified owners through ambient transport. Preserve parked xterm/scrollback while disabling input and subscriptions. Observe owner lifecycle without destroying resources on ordinary generation changes. Pin/revalidate concrete target/incarnation separately before reattachment; unknown/default owners need explicit validated handling, not a string exception.

**Confidence:** high for missing subscription and fallback control flow; cross-profile network/input outcome not runtime reproduced.

## Warnings — SHOULD FIX

### W1 — Creating a store tab is not opening/loading the requested file

**Evidence:** `os/MonacoKeepAliveHost.tsx:113–144,199–206,232–241`; `stores/editor.ts:151,575–663,891–923`; `os/apps/EditorApp.tsx:22–30`; `os/OsShell.tsx:60–69`.

Host directly appends a `Tab` with empty content, `loading:false`, `targetAvailable:true`, tier `normal`, and `mtime:Date.now()`; no stat/read occurs. Store documents mtime in Unix seconds, unlike this millisecond value. Imported or newly opened real paths display empty content instead of loading their bytes; ordinary saves use fabricated CAS metadata. Missing project still becomes `global`, missing path `untitled.ts`.

**Impact:** dirty tracking now exists, but file ownership/loading/type/mtime semantics remain unverified; **[INFERENCE]** saves can conflict unnecessarily or, on an overwrite-capable path, replace an existing file with the blank-based draft.

**Correction:** use the owner-bound file open/load flow and actual metadata before enabling editing; model a genuine new buffer explicitly instead of impersonating an existing loaded file. Missing/unknown project/path must be explicit, non-writable state. Add load, unavailable-owner, real save and dirty-close regressions.

**Confidence:** high; source-only.

### H4 — Missing destination pane still removes the source window

**Evidence:** `os/window-ops.ts:473–535`; `lib/tile-tree.ts:267–322`; `os/window-ops.test.ts:143–165`.

Desktop existence is checked, pane existence is not. With a nonempty target tree, dock a floating/cross-desktop window to a stale `paneId`: source membership is removed, window becomes tiled on destination, generic insertion finds no pane and adds nothing. Same-desktop tiled docking can also remove its source item before failing insertion. **[INFERENCE]** Window becomes unplaced and session fails exactly-one-placement validation.

**Correction:** validate destination pane and source descriptor before any mutation; invalid/stale target returns the original session unchanged. Preserve the intentional empty-desktop creation behavior. Add same-desktop float/tile and cross-desktop stale-pane tests, plus valid cross-desktop focus tests; assert `validateOsSession(result).valid` after each operation.

**Confidence:** high, deterministic control-flow evidence.

### H5 — Frame/app focus selector still mismatched

**Evidence:** `os/WindowFrame.tsx:151–162,218–224,327–332`; `os/input-arbiter.ts:72–83`.

Handler queries `[data-os-window-body]`; actual body is `[data-os-window-slot]`. App keystrokes therefore classify as frame focus. Handler also ignores `frame-focused-handled`; no shortcut-capture exemption exists. Fixing the marker is necessary but does not by itself establish complete input precedence or iframe chord interception.

**Correction:** derive body membership from the real slot marker, e.g. `Boolean(targetEl?.closest?.("[data-os-window-slot]"))`; honor the disposition/capture contract. Test events originating inside the real rendered slot versus toolbar, not just standalone arbiter arguments.

**Confidence:** high; exact selector mismatch remains in current source.

### W2 — Monaco deduplication improved, unsafe DOM ownership remains

**Evidence:** `os/MonacoKeepAliveHost.tsx:39–44,67–92,150–161,187–218,225–245,274–280`; `os/apps/EditorApp.tsx:50–69`.

One host per tab key now removes the prior duplicate-resource construction. However, attachment still reparents the React-owned outer div into a disposable slot; last-window close removes that keyed child while React expects it under the parking parent. **[INFERENCE]** Close can raise `removeChild`/NotFoundError or dispose the wrong lifecycle boundary. Registration cleanup also deletes by key without checking entry identity.

**Correction:** preserve a stable React-owned parent or use an imperatively owned attachment boundary; identity-check unregister. Prove real Monaco close/StrictMode/undo and inactive-desktop transitions. Do not infer safety from DOM-node parking alone.

**Confidence:** high structural concern; browser exception not reproduced.

### W3 — Live resource integrations and qualification remain incomplete

**Evidence:** `os/OsResourceHost.tsx:153–173,193–205`; `os/OsShell.tsx:51–69`; `os/apps/BrowserApp.tsx:22–55`; `browser-tests/os-lifecycle.browser.tsx:56–95,218–299,301–334`; Phase 01 plan `:245–275`.

- Terminal root still invents `<profile>:default` with empty command; no manager discovery/selection/creation path in inspected OS adapters. Disconnected indicator does not make launch a live terminal integration.
- Browser remains a per-window raw iframe path rather than the specified controller/keep-alive integration; claims do not deduplicate underlying iframe creation. Geometry observes size/scroll, not pure drag position; fixed overlay z-index 20 conflicts with focused float 30/maximized 50 (`OsResourceHost.tsx:86–147`; `WindowFrame.tsx:195–211`). These Cycle 4 issues remain visible in current source.
- Browser test's “JavaScript state” assertion sets `iframe.dataset.domMarker`, not in-document JS state. No real PTY identity/attach/replay/reset, Monaco save/undo, two-profile retirement, encrypted policy or physical input evidence in inspected tests. No `packages/ui/e2e/os-lifecycle` journey found.

**Correction:** finish the specified existing-controller integrations and add focused regressions for C1/C2/H4/H5, then perform the coherent `/os` lifecycle gate. Keep implementation, route and qualification tasks open. Passing component/unit commands are not lifecycle acceptance.

**Confidence:** high for inspected wiring/assertions; rendering consequences source-derived.

### W4 — Imported app state remains insufficiently validated

**Evidence:** `os/persistence.ts:209–281,468,542–553`; `os/app-registry.ts:13–20`; `os/MonacoKeepAliveHost.tsx:234–241`; `os/OsResourceHost.tsx:168–171,193–195`.

Validator checks app ID/context shape but does not enforce editor minimum project context or validate app-specific `filePath`/`sessionId`/`url` types before returning the input as `OsSessionV1`. Consumers use casts/defaults; e.g. numeric `filePath` reaches `.split()` during buffer creation.

**Correction:** validate/project the allowed stable app state and required manifest context before atomic import; reject malformed targets rather than constructing defaults. This is a carried Phase 01 contract, not a request for a generic schema/plugin framework.

**Confidence:** high; source-only.

## Suggestions — NICE TO HAVE

1. **S1 — Reuse canonical terminal identity.** Replace `${pId}::${sId}` (`OsResourceHost.tsx:214–216`) with existing `terminalKey({profileId:pId,id:sId})` (`api/ownership.ts:126–129`). Avoids delimiter collisions for arbitrary imported strings and another identity convention.
2. Keep one buffer/save-policy authority. Direct `Tab` assembly duplicates store defaults and bypasses load/request/binding invariants; extracting only the genuinely shared policy is simpler than maintaining a parallel editor implementation.
3. Stabilize per-resource target objects. `editorEntries` rebuilds all entry targets whenever windows change; each target change retriggers every buffer-initialization effect (`MonacoKeepAliveHost.tsx:113–144,225–248`). Resource-key-based initialization should not scan/reinitialize on unrelated placement drags. No performance benchmark executed.
4. Preserve the valid improvements: own-profile subscription, reactive content, tab-key deduplication, source-focus repair, initial unknown-owner rejection. Add narrow regressions instead of extra fallback IDs or a broader framework.

## Reviewed files

Primary implementation/test ranges:
- `packages/ui/src/os/MonacoKeepAliveHost.tsx:1–287`
- `packages/ui/src/os/OsResourceHost.tsx:1–231`
- `packages/ui/src/os/window-context.tsx:1–75`
- `packages/ui/src/os/OsShell.tsx:1–226`
- `packages/ui/src/os/DesktopCanvas.tsx:1–119`
- `packages/ui/src/os/apps/TerminalsApp.tsx:1–103`
- `packages/ui/src/os/apps/EditorApp.tsx:1–103`
- `packages/ui/src/os/apps/BrowserApp.tsx:1–94`
- `packages/ui/src/os/WindowFrame.tsx:90–225,310–336`
- `packages/ui/src/os/window-ops.ts:1–165,430–555`
- `packages/ui/src/os/window-ops.test.ts:120–196`
- `packages/ui/src/os/input-arbiter.ts:1–84`
- `packages/ui/src/os/app-registry.ts:1–43`
- `packages/ui/src/os/persistence.ts:204–290,450–480,530–557`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx:1–130,210–334`

Supporting code:
- `packages/ui/src/stores/editor.ts:60–120,275–310,490–665,865–950,1314–1344,1583–1645`
- `packages/ui/src/contexts/EncryptContext.tsx:1–250`
- `packages/ui/src/hooks/use-encrypted-write.ts:1–368`
- `packages/ui/src/components/organisms/EditorTabs.tsx:85–185`
- `packages/ui/src/components/organisms/MonacoHost.tsx:102–150,418–469,483–553`; read-only/save searches
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx:1–100`
- `packages/ui/src/components/organisms/TerminalPanel.tsx:393–450,541–572,651–697,1084–1123`
- `packages/ui/src/api/connections.ts:326–352,754–791,818–832`
- `packages/ui/src/api/ownership.ts:1–150`
- `packages/ui/src/lib/terminal-incarnation-state.ts:1–105`
- `packages/ui/src/lib/tile-tree.ts:250–355`
- `packages/ui/src/hooks/use-terminal-layout.ts:1–38`
- `packages/ui/src/embed/dam-hopper-app.tsx` provider callsites located by search

Requirements/evidence: `README.md:1–150`; `docs/project-overview-pdr.md:1–17,47–55`; `docs/code-standards.md:18–45`; Phase 01 plan `:1–275`; plan overview `:1–65`; Cycle 4 review; Cycle 5 tester report `:1–90`. Approximately 3,700 source/test lines inspected, excluding requirements/reports and search-only callsites.

## Validation commands / results

**Reviewer executed:** `git diff --stat && git status --short` — 5 tracked modified, 13 untracked entries; `date +%y%m%d` — `261102`; source/read/search inspection above. No reviewer build/test/lint commands, no source/plan modifications. Verification ownership remains with integration owner/tester; no duplicate command runs.

**Recorded tester evidence only:** `plans/reports/tester-261102-0745-phase-01-cycle-5-validation.md:5–8,19–31,48–81`. HEAD `d2b4b65d12753270d0533864062f229f17e84b4d`; reported post-run source fingerprint `f242a4ac832db9e1bbfed6a21611a49b04c89a2d94d6f982d624a61b18f5c2dc`. Not independently recomputed by reviewer; post-run snapshot does not prove each earlier command used precisely the same bytes.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/SplitLayout.test.ts src/os` | Exit 0; 7 files, 52 tests passed |
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 335 files, 3,128 tests passed |
| `pnpm --filter @dam-hopper/ui test:browser os-lifecycle.browser.tsx` | Exit 0; Chromium, 7 tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; `tsc -p tsconfig.json`, 0 compiler errors |

Tester retained two non-failing jsdom navigation diagnostics and React act-environment warnings. No lint result, numeric type/test coverage, web production bundle result or real lifecycle E2E result established by this review. Passing reported commands do not resolve the source findings.

## Recommended actions / plan completeness

1. Fix C1 policy ownership/save revision fencing and C2 owner-removal transport fallback before treating adapters as safe.
2. Finish H4 pane validation and H5 selector/real frame-event regressions; retain already-correct source-focus/generation changes.
3. Replace fabricated editor/terminal targets with real owner-bound resource flows; repair remaining Monaco/browser ownership boundaries.
4. Integration owner validates targeted regressions, UI tests, browser tests, TypeScript build and relevant lint after source settles; separately qualify live `/os` identity, input and reconnect behavior.
5. Phase 01 remains **in-progress**. Current implementation/route/qualification checkboxes are open (`phase-01-lifecycle-prototype.md:273–275`). `generalize-tile-tree` is checked complete, but terminal hook still imports separate docking implementation (`hooks/use-terminal-layout.ts:10–16`); coordinator should reconcile shared-docking acceptance. Plans intentionally unchanged under report-only ownership/no TODO tracking.

## Unresolved questions / evidence

No user clarification needed. Missing execution evidence: encrypted-save behavior with host/owner policy enabled; edits during upload and stale completion; owner removal with another profile connected and equal raw terminal IDs; changed-incarnation recovery; invalid-pane docking; rendered-slot keyboard precedence; real Monaco close/undo; live PTY and iframe-document lifecycle/counter baselines. No Phase 01 acceptance approval implied.
