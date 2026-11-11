# Phase 02 — Persistence and target lifecycle

Priority P2 · Pending · 12h (5h projection, 7h lifecycle). Owner: BrowserIntegrator. Depends on phase 01, especially verified identity and canonical tab model. No concurrent edits to persistence/window store from related plans.

## Context
[Design](design.md) sections 2–4 is normative. Existing `packages/ui/src/os/persistence.ts:56-62,193-247,633-720,786-842`, `window-store.ts:140-171`, API list/create/get/delete at `packages/ui/src/api/browser-host-client.ts:181-226`, `server/src/browser_host/session.rs:15,375-405,565-671`, typed close errors at `server/src/api/browser_host.rs:530-565` constrain this phase.

## project-browser-continuity
1. Create `browser/browser-persistence.ts`: explicit local/portable/recipe/remembered projections and legacy conversion; strict Browser schema validation; regenerate imported client IDs. Share the 1,048,576-byte Browser metadata/recovery bound from design; reject unsupported versions/oversized malformed data visibly without silently truncating pages. No exported local owner or session hints.
2. Delegate Browser branch in existing OS sanitizer to this module, **separate local persistence from portable export/import modes** at every public function. Preserve OS envelope/version and unrelated app sanitizers/corrupt-byte handling. Load known current local hints only, never URL-derived create intent. Legacy flat input converts once and drops unqualified IDs; next save only new shape.
3. Create `browser-recovery-store.ts` at `dam-hopper:browser:v1:recovery`. Use one origin-wide exclusive Web Locks key `dam-hopper:browser:v1:recovery-lock` for every recovery read/modify/write, marker stage/settlement, group consume, clear and suppression reset, across owners/documents. Reread/validate full durable document inside each callback; preserve unrelated owners/groups/unknown markers. No same-page-only or in-memory fallback; unavailable/failed locks block before durable lifecycle mutation/remote dispatch. Hold only over storage/local commit, never network; settlement reacquires and rereads. Reuse fail-closed Web Locks pattern from `recipes/launch-records.ts`, not launch journal's memory fallback.
4. Clear under the same lock: reread recovery, persist owner suppression first, then reread current OS bytes and strip owner's address metadata/groups without removing hints/unresolved operations or rewriting unrelated app state. A failed second write is visibly incomplete, suppression retained. Every Browser address-bearing OS save rereads suppression **under this lock immediately before projection/write**, even from another document with stale runtime addresses; notification timing cannot authorize write. Reset suppression only for explicit validated submit/supported URL launch under lock, never autosave/snapshot/settlement.
5. Migrate `loadOsSession`/`saveOsSession` to async results in `persistence.ts`; actual callers found in `OsShell.tsx` startup, debounce and beforeunload/pagehide flush plus `persistence.test.ts` must await/handle them, no synchronous shim. First hydration reads recovery/suppression and projects OS state under lock before Browser addresses publish or autosave/snapshot projection runs; retire obsolete startup completions. On lock/read failure withhold stored Browser URLs/groups, block durable writes and report continuity error; validated exact hints may GET reconnect. Keep unrelated OS last-writer behavior, no new merge/version system.
6. In `OsShell.tsx` wire recovery `storage` notifications to cache invalidation + locked reread of suppression/notices only (writer updates own cache after commit); no unrelated OS rehydration. Notifications are not atomic/ordered exclusion; writes always reread. Flush while live/on visibility hidden, await where possible; pagehide/beforeunload best effort only, no unlocked synchronous fallback or guaranteed unload durability.
7. Tests cover import authority injection, both exports, owner/dev isolation, popup exclusion, query/hash/userinfo, blocked get/set/remove/locks, malformed recovery, active remap and async callers/hydration. Two real same-origin documents in phase 05 interleave pending/unknown markers, unrelated settlement, clear, consume and delayed stale autosave with notification processing held back; assert no lost unrelated marker/suppression and single group consumption.

## own-browser-target-lifecycle
1. Create `browser-create-lifecycle.ts` for root-owned in-flight map + explicit intent dispatcher. Capture owner/generation/window/tab/action token, immutable URL/viewport/key once. Under origin-wide recovery lock reread/persist pending marker before POST; release before network and recheck owner/generation after lock wait. No creation from host mount, stale disk URL, background tab or reconnect. Known rejection yields useful placeholder; only explicit retry dispatches again. Preserve typed `429/browserBusy` versus viewer failure.
2. Promise/operation ownership survives React body lifetime. Exact late response cannot update replacement tab/owner; if original tab closing/gone, queue exact-ID cleanup after original-owner and cross-profile native-reference/runtime checks. Key/request memory-only. Crash/reload leaves unknown marker, not replay request. Associate pending creates with staged close-group under locked fresh read; exact settlement reacquires lock and removes only proven-settled record, preserving others.
3. Create `browser-close-lifecycle.ts`: census all retained same-client tabs/windows by native key `(normalized endpoint, verified principal, prod/dev, sessionId)` **across profile IDs**, including hidden/minimized/deferred. Use this same key for final-reference lock and closing-target attach gate, with incarnation/profile epoch checks where available; unknown runtime evidence conservatively retains references. First shared release zero DELETE; final concurrent releases one DELETE. Each request uses initiating view's captured owner, never another profile's credentials, rechecking owner/generation/runtime after lock waits and network awaits. Different endpoint/principal/namespace or changed runtime cannot authorize I/O. 200 DELETE/exact 404/closed settles; running/initializing/closing/network/502 stays unknown; Check/Retry same ID only. Keep gate during unknown, serialize new attach against final release. No cross-client census.
4. Replace only Browser branch of `window-store.closeWindow`: stage durable group/markers; mark tabs/window closing and suppress viewers; asynchronous coordinator removes via pure window close only after settlement. Public close request may stay synchronous/void; state reports pending/unknown, not fake success. Do not alter terminal lifecycle. Closing last tab resets to one blank tab. Unknown window can be left only via explicit duplicate-risk acknowledgment, keeping durable owner notice and affected group blocked for automatic restore.
5. Create `browser-session-inventory.ts` for explicit profile-owner-qualified list/selected-ID GET + attach/reveal or selected-ID close. Use native-key closing gate across profiles for admission and closure, with current runtime verified where available and request authority always initiating owner. Never infer create match from URL/title/delta/empty inventory; forbid closing/lost attachment. Selection is user decision, not settlement of original POST.
6. User acknowledgment creates a **new explicit intent**, never retries old key; unresolved record persists through locked updates. Block only automatic affected-group restore, not independent New Window/explicit tabs. No generic loops/polling/bulk delete/new API/registry. Recovery-lock callbacks never await native-target locks; native close gate can stage/settle via short recovery callbacks without holding storage exclusion over network.
7. Deferred tests cover submit/remount, close during create, owner/generation/tab replacement, exact late cleanup and unknown reload/inventory/acknowledgment. Add two local profile IDs on identical endpoint/principal/namespace explicitly sharing exact target, hidden/deferred references, simultaneous final closes and racing attach: first close zero DELETE, final close exactly one. Changed endpoint/principal/namespace/runtime denies I/O; never substitute other profile authority. Assert storage/lock failure blocks dispatch and settlement cannot erase another document's unknown marker.

## Interfaces, security, failure and rollback
New modules listed literally below, each <200 LOC; existing huge persistence/window/OsShell files get focused branches, not rewrites. Runtime ownership remains module-local maps plus window state, not another registry/task engine. Recovery never grants server authority. Profile scope remains metadata/auth routing; native-key sharing affects destructive census/gate only. Lock/storage failure blocks durable lifecycle mutation but permits known-ID GET reconnect/drafts. Unrelated OS last-writer semantics unchanged; async unload persistence best effort. Keep unresolved notices discoverable after acknowledgment. Rollback preserves blockers/portable addresses; never clear unknown marker to unblock rollout.

## Success and next dependency
A04/A05/A08–A12/A15 executable cases authored, canonical schema services available to host/UX. Phase 03 depends on `own-browser-target-lifecycle`; no tests/builds executed here.

```evcrate-tasks
[
  {
    "id": "project-browser-continuity",
    "title": "Implement canonical persistence and remembered-page metadata",
    "blocked_by": [
      "bind-browser-owner-model"
    ],
    "allowed_files": [
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/browser/browser-persistence.ts",
      "packages/ui/src/os/browser/browser-persistence.test.ts",
      "packages/ui/src/os/browser/browser-recovery-store.ts",
      "packages/ui/src/os/browser/browser-recovery-store.test.ts"
    ],
    "constraints": [
      "One Browser parser/projector reused by local load/save, portable import/export, recipes and close groups; no perpetual aliases.",
      "Recovery markers are reconciliation hints only; no runtime authority, create requests, popup URLs, drafts, cookies or credential export.",
      "All recovery mutations and Browser address-bearing OS writes use origin-wide exclusive dam-hopper:browser:v1:recovery-lock and fresh durable reads; no memory fallback or unrelated OS merge redesign.",
      "Migrate async loadOsSession/saveOsSession callers in OsShell and persistence tests; initial hydration gates autosave, notification rereads never replace write-time exclusion, unload flush best effort."
    ],
    "acceptance": [
      "Local ordinary tabs keep exact session hints only within owner scope; imported/legacy records cannot auto-attach or auto-create.",
      "Ordinary HTTP(S) query/hash retained; userinfo/non-HTTP addresses omitted; popup entries excluded; active fallback deterministic.",
      "Origin-wide locked staging/settlement/clear/consume preserve unrelated owners/groups and unknown markers; unavailable locking/storage blocks durable lifecycle mutation; malformed or >1,048,576-byte recovery rejected visibly, not reset.",
      "Clear suppression survives first hydration and another open document's stale snapshot/autosave via locked reread; multi-key failure is not success, exact session hints/native pages remain.",
      "Async startup/debounce/flush callers handle results and retire stale hydration; Browser addresses cannot publish/save before suppression observation; storage events trigger locked refresh, never implicit cross-document OS merge."
    ],
    "verification": [
      "Author projection/privacy/async-caller/storage-and-lock fault tests plus independent-document interleavings for marker preservation, settlement, clear, stale autosave and consume; execute integrated phase 05 only."
    ]
  },
  {
    "id": "own-browser-target-lifecycle",
    "title": "Own single-flight target creation and reference-aware closure",
    "blocked_by": [
      "project-browser-continuity"
    ],
    "allowed_files": [
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/browser/browser-create-lifecycle.ts",
      "packages/ui/src/os/browser/browser-close-lifecycle.ts",
      "packages/ui/src/os/browser/browser-session-inventory.ts",
      "packages/ui/src/os/browser/browser-create-lifecycle.test.ts",
      "packages/ui/src/os/browser/browser-close-lifecycle.test.ts",
      "packages/ui/src/os/browser/browser-session-inventory.test.ts",
      "packages/ui/src/os/browser/browser-window-lifecycle.test.ts"
    ],
    "constraints": [
      "No backend changes/new registry/retry framework. Body abort/unmount is not remote cancellation.",
      "Before create/close dispatch acquire origin-wide recovery lock, reread and durably stage pending intent; lock/storage failure blocks dispatch. Settlement reacquires/rereads; never replay unknown POST or infer target/settlement from URL/empty list.",
      "Count all same-client native-key references across profile IDs; final-reference lock/closing attach gate use endpoint/principal/namespace/sessionId, not profile scope. Runtime checked where available; initiating owner credentials never shared.",
      "No cross-client census or budget change. Browser close defers pure removal until settlement or explicit unknown departure; storage callbacks never wait for native locks or network."
    ],
    "acceptance": [
      "Repeated submit/remount cannot duplicate a single create; immutable key/request held by root lifecycle owner until exact settlement.",
      "Late exact creates are adopted only by original valid tab or enter reference-checked cleanup; owner change withholds delivery/cleanup until original scope returns.",
      "Two profiles with identical normalized endpoint/principal/namespace share exact selected target: first view close zero DELETE, final close one, including hidden/deferred views; simultaneous close and attach gate races cannot delete a retained target.",
      "Changed initiating endpoint/principal/namespace/runtime denies I/O; same-native identity never transfers credentials. DELETE failure/502/unknown preserves recovery state and affected group blocker.",
      "Window close stages committed ordinary order/active index under shared recovery lock; last tab blank; unknown affected group cannot auto-create.",
      "Inventory admission and late-create cleanup use cross-profile native-key census/gate with original owner authority; risk acknowledgment permits new explicit intent without erasing unresolved notice."
    ],
    "verification": [
      "Add deferred/native-reference race and storage-lock fault cases for A04/A05/A08/A09/A10/A15, including two-profile hidden shared target and owner mismatch; executions deferred to phase 05."
    ]
  }
]
```

- [ ] <!-- evcrate-task:project-browser-continuity --> Implement canonical persistence and remembered-page metadata
- [ ] <!-- evcrate-task:own-browser-target-lifecycle --> Own single-flight target creation and reference-aware closure
