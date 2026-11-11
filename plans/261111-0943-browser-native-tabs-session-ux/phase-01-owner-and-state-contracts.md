# Phase 01 — Owner and state contracts

Priority P2 · DONE (`completed`, 2026-11-11) · 8h (3h architecture, 5h model). Owner: BrowserIntegrator; maintained-document Gate 1 edits executed via docs owner. Dependencies: none; Gate 1 publication and Phase 01 owner/state contracts completed and verified.

## Context and requirement
Read [design](design.md) sections 1–3 and 8, [decisions](reports/coordinator-decisions.md). Source anchors: `api/auth-client.ts:454-466`, `api/connections.ts:91-119,169-184,449-489,604-651`; `api/server-config.ts:123-130`; `os/apps/BrowserApp.tsx:183-267`. All source paths in this phase under `packages/ui/src/` unless full path shown.

## publish-browser-architecture
1. Docs owner updates existing root resource/Browser app sections in system architecture, detailed browser client lifecycle/PCM section and design guidelines tab/chrome/accessibility section. Reflect the proposed design before code; keep current/runtime status explicit until qualified.
2. Include local versus portable schemas; origin-wide recovery lock, locked suppression/read-write/hydration and fail-closed unavailable locks; profile metadata/auth isolation versus cross-profile native-target reference census/gate; close/default reopen versus restart; exact ordinary query/hash retention/popup exclusion; uncertainty/manual acknowledgment; tuple identity/active-only viewers; colocated capture and mandatory actual-human visual receipt. No new Mermaid diagrams required.
3. Coordinator records Gate 1 publication/disposition before implementation begins. Existing docs authoritative invariants preserved, not weakened to match shortcuts.

## bind-browser-owner-model
1. Modify connection entry/snapshot/freezing and state-transition paths to expose `verifiedBrowserIdentity`. Populate from successful current-generation auth status and publish only connected; clear on reconnect, disconnect, logout-driven invalidation, unsupported/MFA/login/offline and endpoint/token/profile replacement. Existing auth status parser unchanged.
2. Create `browser-tab-types.ts` for exact design runtime/disk/recovery types. Create `browser-owner-scope.ts` for verified profile scope capture/equality and separate native target key `(normalized endpoint, principal, prod/dev, sessionId)` excluding profileId; reuse `normalizeServerUrl` from `api/server-config.ts`. Runtime compatibility checks use incarnation/profile epoch where available, never infer missing evidence means no shared reference. Scope remains metadata/auth authority; native key grants none. No username trust or identity library.
3. Create pure `browser-tab-state.ts`: initialize blank/runtime tab group, select/add/remove, nearest active fallback, immutable tab patch and unambiguous `(windowId,tabId)` viewer key. Draft state belongs to tab, not mounted address input. Keep root controllers in host, not state objects.
4. Add tests for unknown identity, dev isolation, reconnect, endpoint/principal mismatch, stale auth, ordinary tab order/active fallback/last-tab blank/drafts/tuple collision. Two profiles on identical endpoint/principal/namespace produce different owner scopes but the same native target key for the same session; changed endpoint/principal/namespace differs, available runtime mismatch rejects acting on a replacement. No producer cutover yet; downstream phases migrate all producers before integrated verification.

## Files and interfaces
- Modify existing three docs and `api/connections.ts`/test.
- Create exactly three Browser model/helper modules and two tests listed below; no other modules authorized.
- No deletes, package/config/backend edits. New interface names/schema must match design; callers migrate in phases 02–04. Do not create a second canonical app state.

## Failure, security and rollback
Unknown identity => generic blocked state, no metadata reveal/I/O. Connection-level identity does not replace server authorization. If existing auth path cannot expose nonempty verified identity, stop that owner rather than infer one. Before execution serialize overlap with host-remediation/login/audio writers. Rollback model additions only before dependent code/data migration; after cutover use design rollback, not flat aliases.

## Success and next dependency
A08 model contract and A02/A04 pure owner/state unit tests executed and passing (64/64 across 7 targeted files; UI `tsc` build exit 0); Gate 1 publication completed in `docs/system-architecture.md`, `docs/architecture/host-browser-cdp-streaming.md`, and `docs/design-guidelines.md`. Phase 02 depends on `bind-browser-owner-model` and is unblocked.

```evcrate-tasks
[
  {
    "id": "publish-browser-architecture",
    "title": "Publish intended Browser architecture Gate 1",
    "blocked_by": [],
    "allowed_files": [
      "docs/system-architecture.md",
      "docs/architecture/host-browser-cdp-streaming.md",
      "docs/design-guidelines.md"
    ],
    "constraints": [
      "Docs owner only; publication precedes all product edits. Plans-only authoring has not executed this task.",
      "Preserve existing backend/audio/security contracts; label proposed versus implemented accurately."
    ],
    "acceptance": [
      "Maintained docs describe design.md sections 2–7: owner versus native-target identity, origin-wide recovery/suppression exclusion, async hydration/saves, unknown outcomes, active-only viewers and colocated human visual gate before coding.",
      "No false claim of deployed tabs, measured continuity or completed audio qualification."
    ],
    "verification": [
      "Coordinator reviews maintained-document publication against design.md and records Gate 1 disposition before starting dependent tasks."
    ]
  },
  {
    "id": "bind-browser-owner-model",
    "title": "Bind verified identity and define canonical tab state",
    "blocked_by": [
      "publish-browser-architecture"
    ],
    "allowed_files": [
      "packages/ui/src/api/connections.ts",
      "packages/ui/src/api/connections.test.ts",
      "packages/ui/src/os/browser/browser-tab-types.ts",
      "packages/ui/src/os/browser/browser-tab-state.ts",
      "packages/ui/src/os/browser/browser-owner-scope.ts",
      "packages/ui/src/os/browser/browser-tab-state.test.ts",
      "packages/ui/src/os/browser/browser-owner-scope.test.ts"
    ],
    "constraints": [
      "Use existing auth-client AuthStatusSuccess.user and dev_mode/devMode; no JWT decoding, username guess, backend/auth API or ambient fallback.",
      "New modules each <200 LOC; no top-level url/sessionId aliases; generation is ephemeral and all new u64 fence fields decimal strings."
    ],
    "acceptance": [
      "Connection exposes verified principal/namespace only while current connected; every retirement/nonconnected path withholds it and late auth cannot revive it.",
      "Pure tab operations enforce stable unique IDs, ordered tabs, valid active tab, last-tab blank fallback, per-tab draft and tuple viewer identity.",
      "Scope equality includes profileId/normalized endpoint/exact principal/prod-dev; separate native target identity excludes profileId for cross-profile reference census/gate only, with runtime compatibility checked where available and no credential transfer."
    ],
    "verification": [
      "Plan targeted connection/owner/state cases including two distinct profiles sharing one native key and changed endpoint/principal/runtime denial; execute once with phase 05 integrated commands."
    ]
  }
]
```

- [x] <!-- evcrate-task:publish-browser-architecture --> Publish intended Browser architecture Gate 1
- [x] <!-- evcrate-task:bind-browser-owner-model --> Bind verified identity and define canonical tab state

### Progress note (2026-11-11)
- Phase 01 status: **DONE (`completed`, 2026-11-11)**. Both tasks (`publish-browser-architecture`, `bind-browser-owner-model`) completed and verified; Phase 02 unblocked.
- Code review: Final review scored **9/10 (approved by user)** with 0 critical issues and 0 outstanding warnings (Cycle 3 `handleDrop` captured-auth currency guard and `resetConnections` per-profile IPC listener cleanup resolved and regression-tested).
- Validation (`Phase01FinalTester`):
  - `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`): exit 0.
  - `pnpm --filter @dam-hopper/ui test src/api/connections.test.ts src/api/connections-mfa.test.tsx src/api/browser-host-client.test.ts src/os/browser/browser-owner-scope.test.ts src/os/browser/browser-tab-state.test.ts src/components/organisms/HostSleepConsentHost.test.tsx src/components/organisms/login-devices-connections.test.tsx`: exit 0 — **7/7 files, 64/64 passed, 0 failed, 0 skipped** (`connections.test.ts` 21/21, `connections-mfa.test.tsx` 4/4, `browser-host-client.test.ts` 8/8, `browser-owner-scope.test.ts` 5/5, `browser-tab-state.test.ts` 6/6, `HostSleepConsentHost.test.tsx` 5/5, `login-devices-connections.test.tsx` 15/15).
- Boundary: Phases 02–05 runtime persistence/lifecycle/viewer/chrome integration, full UI/server test suites, Chromium browser/E2E runs, and mandatory colocated human visual acceptance (`tabs-visual/`) remain pending.
