# Browser tabs and session continuity — proposed design

**Proposed, not deployed. Planning only.** Authority: [settled decisions](reports/coordinator-decisions.md), plus coordinator's fail-closed unknown-create disposition below. Maintained architecture docs unchanged by this assignment. This design precedes phase authoring; Gate 1 publication remains a future prerequisite to code.

## 1. Outcome and existing boundaries

Native-style tabs within each OS Browser window; compact chrome; address continuity without replacing live native pages. Reuse Chromium, REST list/create/get/delete, existing control snapshots, root host, resource claims and OS actions. No backend changes, registry, dependencies, search provider, favicon fetches, background audio, target eviction, budget changes, history manager or new global shortcuts.

Evidence anchors (paths relative to repository):
- `packages/ui/src/os/apps/BrowserApp.tsx:162-365,675-905`: single-session chooser, draft overwrite, viewer-local claim and CAS toolbar.
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:57-123,359-440,745-1257,1490-1540`: window-only slots, popup swap, create/bootstrap and parked controllers.
- `packages/ui/src/os/browser-session-sync.ts:19-138`: snapshot/session fences; newly affected profile epochs must stay canonical decimal strings, not Number conversions.
- `packages/ui/src/os/window-store.ts:140-171`: current fire-and-forget close. Replace for Browser only; terminal behavior unchanged.
- `packages/ui/src/os/persistence.ts:56-62,193-247,633-720,786-842`: shared local/export sanitization currently preserves flat session hints.
- `packages/ui/src/os/action-executor.ts:347-381,515-543`; `OsShell.tsx:667-695`; `deep-links.ts:563-598`: distinct New Window, default open and URL launches.
- `packages/ui/src/os/recipes/schema.ts:293-299,431-436`; `recipes/recipe-engine.ts:250-254,397-477`: current URL-only recipe projection; execution currently handles terminals only, not app steps. Browser metadata migration does not repair that existing limitation.
- `packages/ui/src/api/connections.ts:91-119,169-184,449-489,604-651`; `api/auth-client.ts:454-466`: verified `user` and dev namespace exist in auth response, currently discarded.
- `packages/ui/src/api/browser-host-types.ts:66-120`; `api/browser-host-client.ts:181-226`: capabilities lack incarnation; list DTO lacks creation key; existing create is keyed.
- `server/src/browser_host/session.rs:15,375-405,565-671`: idempotency TTL 600 seconds; creation records expire even while a target remains running. No indefinite replay guarantee.
- `server/src/api/browser_host.rs:164-168,530-565`: capacity is `429/browserBusy`; ambiguous close can be `502/nativeCloseUnconfirmed`.
- `docs/architecture/host-browser-cdp-streaming.md:529-565`: hide closes BOTH sockets and flushes PCM; preserve privacy, input, selection and CAS invariants.

## 2. Identity and state model

IDs have separate purposes: OS `windowId`; client-generated UUID `tabId`; server `sessionId`; ephemeral `viewerId/subscriptionEpoch`. Never use URL or session ID as a React tab key. A tab may have no target. Use an unambiguous tuple encoding such as `JSON.stringify([windowId, tabId])` for viewer/resource/slot identity; no delimiter collisions.

Expose `verifiedBrowserIdentity?: { principal: string; namespace: "prod" | "dev" }` on `ConnectionSnapshot` and internal entry, from successful protocol-2 `checkAuthStatus` only. Principal is exact nonempty server `user`, not lowercased, JWT-decoded, profile label or editable username. Namespace uses verified `dev_mode/devMode`; no-auth identity still requires nonempty returned `user`. Clear/withhold on every connecting/disconnected/offline/login/MFA/unsupported/logout/replacement path; stale auth replies cannot publish it. No backend auth changes.

`BrowserOwnerScope = { profileId, endpoint: normalizeServerUrl(snapshot.serverUrl), principal, namespace }`. Require connected snapshot, current generation and nonempty normalized endpoint/principal before attachment, mutations, reading remembered groups or reconciliation. Generation is a runtime fence, not a durable scope component. Reconnect same scope may GET exact IDs; endpoint/principal/dev change fences old resources and withholds their titles, addresses, drafts and controls. Display generic owner-mismatch guidance; never silently rebind old tabs to the new owner. Return to original verified scope or explicitly discard old window and use a blank New Window. No ambient/default fallback.

Profile-qualified ownership remains the metadata/auth/request-routing boundary. Separately derive native target identity from captured verified owner: `(normalized endpoint, exact principal, prod/dev namespace, sessionId)`, **excluding profileId**. Reference census, final-reference serialization and closing-target admission gate use this identity across all same-client profile IDs; no endpoint-alias discovery. Compare server incarnation/profile epoch where available before acting; a runtime mismatch cannot authorize action on a replacement target, and missing runtime evidence cannot prove an existing reference absent. Captured owner/generation still gates each request: closing through profile A uses A's own authority, never B's credentials or authority, even if both reference the same native identity.

### Runtime (one canonical `BrowserWindowState` in Browser `appState`)

```ts
// Proposed contracts; type definitions belong in browser/browser-tab-types.ts.
type BrowserWindowState = {
  browserStateVersion: 1;
  ownerScope?: BrowserOwnerScope; // assigned only after verified capture
  tabs: BrowserTabRuntime[];       // ordered; always >= 1
  activeTabId: string;
  closing?: { operationId: string; status: "pending" | "unknown" };
  restoreGroupId?: string;        // consumed default-reopen intent, not authority
};
type BrowserTabRuntime = {
  tabId: string;
  kind: "ordinary" | "popup";
  committedUrl?: string;
  sessionId?: string;             // hint until live GET, never authority
  title?: string;                 // live only
  phase: "new-tab" | "deferred" | "connecting" | "live" |
    "unavailable" | "capacity" | "creating" | "create-unknown" |
    "closing" | "close-unknown";
  draft: { value: string; dirty: boolean }; // memory only
  actionSequence: number;         // local async retirement token
  createIntent?: { operationId: string; creationKey: string;
    request: CreateSessionRequest }; // immutable request, memory only
  parentTabId?: string;           // popup relationship, memory only
  popupAdmissionId?: string;      // dedupe and once-only activation, memory only
  snapshot?: BrowserSessionDto;   // epochs/revisions remain decimal strings
  // Viewer/control/dialog/selection/audio/pending/error details remain ephemeral.
};
```

Keep controller/canvas/proxy/PCM objects root-owned, not serialized into `appState`. Draft lives in tab runtime so body placement/remount and tab switching retain it. Store updates target `(windowId,tabId)` atomically; every async result also checks captured scope, generation, action sequence, expected session and runtime/subscription identity. Snapshot updates committed URL/title/status, never dirty draft. Same-runtime navigation/viewport revisions compare validated bigint strings; never round u64 fences. Existing lower-layer numeric interfaces retain their current safe-range rejection; do not expand into unrelated fence remediation.

### Disk schemas and trust boundary

OS envelope version remains 1; Browser nested schema becomes 1. One projection/parser module supplies local save/load, import/export, recipes and last-closed metadata; explicit modes prevent local hints leaking into portable exports.

```ts
type BrowserWindowDisk = {
  browserStateVersion: 1;
  ownerScope?: BrowserOwnerScope;
  tabs: { tabId: string; committedUrl?: string; sessionId?: string }[];
  activeTabId: string;
};
type RememberedBrowserGroup = {
  version: 1; groupId: string; ownerScope: BrowserOwnerScope;
  addresses: string[]; activeIndex: number;
};
type BrowserRecoveryDisk = {
  version: 1;
  groups: RememberedBrowserGroup[]; // <= 1 most-recent closed group per owner scope
  addressSuppressedScopes: BrowserOwnerScope[]; // clear action survives reload/autosave
  operations: { operationId: string; ownerScope: BrowserOwnerScope;
    kind: "create" | "close-tab" | "close-window";
    groupId?: string; windowId: string; tabId?: string;
    sessionId?: string; status: "pending" | "unknown" }[];
};
```

- Recovery namespace: `dam-hopper:browser:v1:recovery`, separate from existing `dam-hopper:os:v1:session`. Operation records carry reconciliation identity/intent only: no creation request/key, URL, credentials, drafts or server authority. A pending record loaded after reload means **unknown**, never permission to POST.
- One origin-wide exclusive Web Locks key, `dam-hopper:browser:v1:recovery-lock`, protects every recovery read/modify/write (staging, settlement, clear, suppression reset and consume), independent of owner/profile. Reread and validate the complete durable document **inside each lock callback**, preserve unrelated owners/groups and unresolved records, then write. Hold the lock only for local storage/state transition, never network waits; remote completion reacquires it and rereads before settlement. No stale cached document commits, same-page-only substitute or in-memory fallback. Unavailable/failed locking blocks durable lifecycle mutation before dispatch, like storage failure.
- Browser address-bearing OS saves use that **same exclusion**, rereading durable suppression immediately before projection and write; cached flags/storage events are not proof of freshness. Clear holds the lock, writes suppression first, rereads current OS bytes and strips that owner's saved addresses/groups without disturbing hints/unknown markers. Multi-key storage is not transactional: if the OS rewrite fails, suppression remains and the action reports incomplete; later stale writers still strip addresses under lock. Only explicit validated address submit/supported URL launch may reset suppression under this lock, never snapshots, stale saves, settlement or unrelated consumption. Unrelated OS last-writer semantics are unchanged.
- First hydration observes recovery/suppression and OS projection under the lock **before publishing Browser addresses or enabling autosave/snapshot projection**. Migrate public `loadOsSession` and `saveOsSession` to async results; update their actual `OsShell.tsx` startup/debounce/flush callers and `persistence.test.ts` awaits. Retire late startup results on unmount/replacement; no default-state autosave before hydration. If lock/recovery read fails, withhold stored Browser addresses/groups and disable durable Browser writes; validated exact session hints may still support owner-verified GET reconnect, with drafts usable.
- A `storage` event for recovery invalidates the local cache and schedules a locked reread to refresh suppression/notices (the writing document updates itself after commit); event ordering/delivery is **not atomic** and never substitutes for the write-time locked read. Do not rehydrate unrelated OS state on notifications. Flush while the document is live/visibility becomes hidden; pagehide/beforeunload may request best-effort async save but cannot guarantee completion or bypass the lock synchronously.
- Local mode preserves ordinary tab IDs, committed restorable URLs and exact session ID hints plus owner scope. Load creates `connecting` only for matching verified owner and an ID; missing target is unavailable. URL-only local tabs are unavailable, not fresh-create intents. Blank entries stay New Tab. No mount effect infers creation from URL.
- Portable OS JSON/envelope exports and recipes contain `{ browserStateVersion: 1, tabs: [{tabId, committedUrl}], activeTabId }` only. Strip owner scope, session IDs, recovery/group identity and all runtime data. OS import generates fresh client IDs and marks URL tabs unavailable with explicit Reload; import alone issues no Browser requests. Recipes capture/validate/export sanitized address metadata only: existing app-step non-execution remains unchanged, no Browser recipe executor or claim that recipes instantiate pages.
- One-time old `{url,sessionId,logicalSessionId,presentation}` input conversion at deserialization only: one ordinary tab, validate URL, drop all unqualified session/logical IDs and runtime authority, mark unavailable until explicit Reload. Legacy recipe URLs convert to sanitized current metadata only. Never retain flat aliases or parallel runtime schemas; migrate every producer/consumer/fixture. Unknown versions, malformed arrays/IDs/active selection fail closed to New Tab with notice, no targets. Deduplicate IDs; do not silently truncate valid user pages. Enforce a shared `MAX_BROWSER_METADATA_BYTES = 1_048_576` on each serialized Browser projection/recovery document and raw recovery parsing; reject oversized Browser metadata visibly, never silently truncate tabs. Existing OS/recipe outer versions and unrelated validators unchanged; no pre-existing OS byte bound is assumed.
- Popup tabs are omitted entirely from every disk/portable projection (including session IDs and titles). Remap active selection to surviving opener, then nearest ordinary tab; if none, one blank tab. Live popup may be rediscovered only from current verified parent snapshot after reload, never its serialized URL.

## 3. Exact URL/privacy policy

Accept only HTTP(S); trim input; existing scheme-less host/port convenience adds `https://` (explicit `http://localhost:port` remains http). Reject empty host, userinfo (`username/password`), unsupported schemes and free-text/search terms. Do not turn arbitrary phrases into network searches. Backend network policy remains authoritative, including development restrictions.

For **ordinary committed** URLs, retain full normalized `URL.href`, **including query and hash**, for faithful routing/reopen. No silent query/hash stripping or heuristic OAuth parameter redaction. This is local plaintext metadata, not secret storage: ordinary path/query/hash may contain tokens or sensitive data and will also appear in user-requested exports/recipes. Explain this in New Tab/tools and export/recipe warning text. If a server/native snapshot contains userinfo or non-HTTP(S), omit its persisted address entirely; preserve only local session hint when ordinary so live reconnect still works. Do not rewrite a credential-bearing URL into a different address.

Popup classification is lifetime provenance (`parentSessionId` verified against opener); never downgrade to ordinary on redirect. Thus **all popup URLs**, even after redirect, are excluded. Same-tab OAuth/token URLs have no reliable secret classification in current DTO: ordinary URL retention applies; explicitly document this limitation. Never copy cookie jar, Authorization, tickets, leases, DOM form values, text selections, drafts or Chromium storage to client persistence/export. Never log full URLs/drafts/snapshot/error payloads; render bounded generic errors/kinds. No favicons, external searches or URL forwarding.

Provide **Clear remembered pages** in Browser tools/New Tab: remove saved groups and committed address metadata for current verified owner from local persisted open-tab records, not native pages/cookies. Under the shared origin-wide lock, reread recovery, persist owner suppression first and rewrite current OS addresses as above; suppression is observed at first hydration, refreshed on storage notification and reread on every address save. Only explicit new address submission/supported URL launch clears it under the same lock. Existing live runtime addresses remain usable. Preserve necessary owner/session hints and unresolved operation records; clearly state clearing metadata is not remote page closure or browser-profile reset. Lock/storage/multi-key failure is visible and never reported cleared.

## 4. Lifecycle and failures

### Creation and uncertain results

A single root-owned lifecycle service, not body effects, owns create/close promises by `(scope, windowId, tabId, operationId)`. Reserve UUID operation + creation key + immutable validated URL/viewport once before dispatch. Acquire the origin-wide recovery lock, reread and persist pending operation marker **before** mutation, then release before network dispatch. Repeated Enter, StrictMode/remount, resize and selection do not mint another key or dispatch concurrently. A settled known rejection such as `429/browserBusy` retains useful URL/placeholder and permits explicit retry; never loop on capacity. Distinguish target admission from viewer admission; no guessed `targetCapacityReached` kind and no fake exact occupancy counter.

A timeout, aborted transport, disconnected owner, lost body or late unpublishable response after POST is **create-unknown**, not cancellation or proof of absence. Keep exact promise result owned after UI tab/window removal. If exact response arrives for same scope: adopt only if intended tab still current; otherwise put ID into close reconciliation, check references and close safely. Never attach late result to replacement tab. On owner change withhold cleanup until the original scope is verified again; never send cleanup to replacement owner.

**Known API limitation, accepted fail-closed boundary:** GET/list cannot look up creation key; 600s key TTL and restart make same-key POST replay unsafe. Never auto-replay uncertain POST, match by URL/title/delta, or clear uncertainty from one empty inventory: an in-flight create can finish later. Durable unknown marker survives app reload; retain visible owner-scoped notice. Pending unknown blocks automatic restoration of **its affected saved group only**, not independent tabs/windows. Manual reconciliation panel lists current owner sessions with actual status, lets user explicitly attach/reveal a selected target or explicitly close that selected ID; it does not assert inferred correspondence. User may explicitly acknowledge “previous page may still exist; fresh pages can duplicate it” and start a fresh group (new operation IDs), retaining the unresolved notice/cleanup obligation. This is not an automatic retry, no broad delete or promise all pages closed. Exact settled operation/late result can clear its marker; manual inventory attachment alone cannot prove original operation settled.

Storage/Web Locks unavailable, quota failure or corrupt recovery data: show actionable continuity error; owner-verified known-ID GET reconnect and memory drafts remain usable. For durable create/close/clear/consume operations, fail before mutation/dispatch when the lock or pending-intent write cannot complete; retain tab/window and offer retry. Settlement also reacquires lock and rereads, removing only the exact proven-settled marker; failure retains an unresolved blocker, never false saved/closed success. Malformed recovery is not silently overwritten. No memory-only/sessionStorage/IndexedDB fallback.

### Tab and window closure

1. Close tab: immediately suppress its stream/audio/input; mark closing. Atomically release that view's reference under the native-target final-reference lock. Only DELETE if no other same-client tab/window references `(normalized endpoint, verified principal, prod/dev namespace, sessionId)`, **across profile IDs**, counting hidden/minimized/deferred views too. Include runtime checks where available; unknown evidence conservatively retains references. The same native-key closing gate excludes new inventory, popup or viewer attachment across profiles while final deletion is pending/unknown; serialize concurrent final releases for one DELETE. Requests use the initiating view's captured owner and current generation, rechecked after awaits; never share credentials. Different endpoint/principal/namespace cannot authorize I/O. Cross-client reference knowledge is unavailable; backend remains authority.
2. Known DELETE success, or subsequent exact owner GET 404/closed, settles close. `running/initializing/closing`, network error or `502/nativeCloseUnconfirmed` remains unknown; explicit **Check close status / Retry close** GETs same ID, rechecks references, then may DELETE same ID. Do not replace with a new target while unknown. If another local view references target, settle this view's release without DELETE. No automatic navigation/new target on status GET failure.
3. Keep closing tab/window shell visible until known release/close result; unknown displays recovery actions, never says closed. When all references released or exact targets confirmed closed, remove tab/window via pure window operations. Closing last tab produces one blank New Tab in same OS window, not saved-window reopen.
4. Explicit OS close stages a replacement most-recent group for its verified owner from restorable **committed ordinary** addresses, order and surviving active index; no drafts/popups/blank entries. Persist group + operation markers together before remote close; group remains blocked for **automatic** restore until closures settle. An explicit duplicate-risk acknowledgment may start a new user-requested group, never erase unresolved operation or permit later automatic replay. Deduplicate shared target DELETEs. Never close Chromium profile/cookies. Late creates join cleanup, not remembered addresses.
5. Default Browser action (`app.browser.open` focus-or-open from Dock/launcher/palette): if any eligible Browser window for captured owner exists, focus it unchanged. Only with no existing Browser window and no explicit URL use the most-recent closed group; under the origin-wide recovery lock reread eligibility/blockers, consume once and install one same-document window intent with fresh tab IDs, order/active index. A second same-origin document must see consumed state and cannot restore the same group. Release before lazy-creating selected address; others deferred. Consumption is not a cross-document OS merge or crash-atomic transaction: failed installation is visible, never replay stale captured group. A fresh reloaded deferred OS tab is unavailable until explicit Reload (creation intent is not persisted).
6. Explicit **New Browser Window** always one blank New Tab; explicit `browser:open`/`browser:preview` and URL deep links preserve current new-window/explicit resource semantics, never consume closed group. Do not change intents to default new-tab routing. Existing recipe execution stays unchanged (terminal steps only today); sanitized Browser recipe metadata is not new executable support. No URL-deep-link → old-group surprise.

### Live reconnect, restart and navigation

- App reload/network reconnect: verify exact scope then GET existing IDs, accept fresh live identity, mint tickets only if active and visible. No navigate/reload/POST. Preserve remote DOM, native history and form values; no “gapless” guarantee. Hidden tabs validate on next activation, retaining IDs and remote pages meanwhile.
- Server/Chromium restart, 404, lost/closed: retain address and tab, clear runtime leases/attachments, show **Page unavailable — Reload to open a fresh page**. Selecting unavailable tab or reconnecting never POSTs. Explicit Reload/validated Enter grants one fresh-create intent after unknown-close/create blockers resolved/acknowledged. Existing live Reload uses current committed URL/native reload, not dirty draft; Enter alone submits draft.
- Navigation: one operation per tab, preflight GET then one CAS mutation with current string revision; 409 refreshes snapshot and displays retry message, never replays. Enter ignored during composition or pending action. Escape resets draft to newest committed URL; native snapshot updates clean draft only. Back/forward remain enabled only for live/not-pending; no invented `canGoBack`, TLS verdict, load percentage or Stop cancellation promise. Late navigation responses cannot overwrite another tab, owner, runtime or newer action.

## 5. Root resources, visibility and popup focus

Expand host enumeration to `(window,tab)`; each tab owns stable parked container/canvas/controller/proxy identity through tile/float/maximize/minimize/desktop transitions. Slot/audio/focus APIs and resource claims accept window+tab tuple; migrate all callers, no window-only aliases. Render root items for live/unavailable tabs as needed, but never create target because a parked item exists.

Effective streaming visibility requires active tab, visible placement, active desktop, current verified owner, successful local claim, unlocked/non-Cognito and unfenced runtime. **Inactive tabs have zero media/control viewer attachments**; call existing hide path, release keys/pointer/control lease, cancel selection and IME handoff, flush PCM synchronously before React commits. Close old sockets before requesting next tab tickets; viewer permits may release asynchronously, so a transient viewer `browserBusy` remains explicit retry, not native page recreation. Active-only does not mean only OS-focused window: two visible Browser windows can each have one viewer within existing configured global budget. Placement reparenting alone keeps same objects/connection where still visible; hide/resume may mint new tickets but never create/reload target.

Popup: verified `activePopupSessionId` GET yields matching parent, scope, incarnation and profile epoch. Insert adjacent linked popup tab once per admitted session; preserve opener ID/order. Auto-select once only if opener tab is still selected in the same focused Browser window at admission completion; if user moved to another tab/window, insert without stealing focus. Selecting popup is explicit thereafter. No duplicate popup tabs from repeated snapshots. Track once-only admission/dismissal in memory.

Popup completion closed/lost/404 removes ephemeral child; select surviving opener **only when that popup is still active in that same focused window**. Otherwise retain user selection/focus; if child was active in a background window, choose fallback within it without focusing OS window or moving DOM focus. If opener gone, nearest surviving ordinary tab or New Tab. Hidden popup has no control socket: observe its completion lazily on activation, and via one owner/session single-flight GET when a current visible opener snapshot changes its popup link. No recurring background polling, new event bus or background viewer; remote state may remain stale while both views hidden. Child/opener close never cascades an unrequested native close to another referenced target. Capacity banner explains popups share the configured target budget (default 2); no automatic eviction or policy edit.

## 6. UX and accessibility

Refined utilitarian native chrome, reuse semantic theme/selection tokens, adaptive font sizes and existing Lucide icons; no new fonts/assets/dependencies. OS title bar unchanged. Internal tab strip ~34px, address toolbar ~36px baseline, grow for configured text/touch sizing. Tab widths 120–220px, horizontal overflow below available width (min 96px at narrow widths), always visible close affordance and fixed `+` outside scroll area. No icon-only tabs losing readable identification; focus scrolls selected tab into view.

```text
OS frame: Browser Preview                              [min] [max] [close]
[ globe  Project page × ][ globe  Docs × ][ Sign-in × ]        [+]
[Back][Forward][Reload] [ https://example.test/path?q=1#part ] [Audio][…]
───────────────────────────────────────────────────────────────────────
remote canvas OR in-tab New Tab / unavailable / capacity / close recovery
```

- New Tab is content of selected panel, not a modal; address field + Open action, URL-only helper, local-plaintext continuity notice, Clear remembered pages. Escape cancels editing, never closes OS window. Other tabs remain available.
- Tools disclosure retains accessible Control/Release, selection start/cancel, current session diagnostics, existing selection preview and terminal handoff, recovery inventory and clear action. Do not delete dev controls to achieve compactness. Active control status stays honest/visible; expanded tools accessible by keyboard with focus return. Keep existing audio mute/unlock (viewer-local) visible; no fabricated “playing” indicator without evidence.
- `role=tablist`, label Browser tabs; tab button + sibling close button (no nested buttons), unique tab/panel IDs, `aria-selected`, `aria-controls`, roving tabIndex. ArrowLeft/Right/Home/End select/focus tabs; Delete closes focused tab with predictable nearest focus; `+` normal keyboard button. Label close action with privacy-safe tab title. Inactive panels hidden/inert; single active panel. Scoped handlers never intercept address editing, canvas/IME, dialogs or outer reserved shortcuts. No new global bindings.
- Widths 400, 640, 1024+ and enlarged 10–32px text: address flexes, tools collapse first, no overlapping hit targets, body retains useful height, horizontal overflow only in tab strip; support coarse-pointer >=44px targets. Alerts/status live-region concise; pending text not fake progress. Cognito/lock masks titles/URLs/tooltips/ARIA and recovery inventory; suppresses input/audio synchronously.

## 7. Acceptance matrix (future evidence, not observed passes)

| ID | Scenario | Observable acceptance | Coverage |
|---|---|---|---|
| A01 | Reload/reconnect live tabs | Same IDs, DOM identity/form values/history; zero create/navigate/reload; only active viewers reattach | unit + full-app live |
| A02 | Draft/native navigation | Dirty draft survives switch/placement; clean reflects native URL; Escape current committed; Enter once; IME no submit | unit + browser |
| A03 | Tab switch/placement | Stable tab order/selection and canvas/controller identity; hidden sockets/PCM/input zero; return no native reload | host + browser + live |
| A04 | Close tab/shared target | Across two profiles with identical normalized endpoint/principal/namespace and selected session ID: first close zero DELETE, final close exactly one; hidden references counted; gate blocks racing attach; sibling unaffected; last tab New Tab | unit + browser + live |
| A05 | OS close/default reopen | Confirmed targets gone, cookies retained; saved order/active index; two independent same-origin documents consume group only once under lock; selected fresh page only; New Window blank | unit + two-document live |
| A06 | Restart/missing target | Address retained unavailable; selection/reconnect zero POST; explicit Reload creates exactly one fresh target | unit + isolated live restart |
| A07 | Configured capacity/popup | Default 2 unchanged; capacity placeholder retains address; retry explicit; admitted popup adjacent, once; no focus steal | unit + live default/raised fixture cap |
| A08 | Owner/endpoint/dev changes | Profile metadata/auth stays isolated; same-native census spans profile IDs without credentials transfer; changed endpoint/principal/namespace or mismatched runtime denies I/O; verified original scope may recover | connection + lifecycle + browser |
| A09 | Late create/close/navigation | Deferred results cannot alter replacement tab; exact late create cleaned only after cross-profile native reference/runtime checks; final-close/attach serialized; unknown blocks affected group only; 409 no replay | deferred unit + browser |
| A10 | Blocked/corrupt storage/locks | Visible failure, zero unsafe dispatch/durable mutation without lock; no memory fallback; GET reconnect/drafts usable; two independent documents preserve unknown markers through unrelated writes/settlement | unit + two-document live |
| A11 | Privacy/URL/audio | Ordinary query+hash retained with warning; popup absent; userinfo omitted; clear in document A survives stale autosave/snapshot/reload in B via locked suppression reread, not notification timing; Cognito/lock no leaks/PCM | projection + two-document live |
| A12 | Recipes/import/export/launch | Portable metadata only, new imported IDs; imports no automatic targets; recipe capture/schema/export retain ordinary tab metadata without enabling app-step execution; legacy converted once; URL launch not closed group | schema/engine + browser |
| A13 | Responsive/ARIA/tools | Full-app 400/640/1440 widths, large text and touch; close/plus/address and keyboard/focus work; approved colocated PNG/evidence/review artifacts plus actual human identity/time/source-run-image hashes and ACCEPTED decision required; pending/rejected blocks visual acceptance | browser + full-app capture + human gate |
| A14 | Selection/dialog/IME | Existing lease/CAS selection terminal handoff, dialog response and Vietnamese/Japanese composition retain isolation; tab hide cancels stale work | existing targeted regressions + live |
| A15 | Unknown-operation reconciliation | No URL guesses/replay/empty-list auto-clear; selected-ID actions and explicit risk acknowledgment; two independent same-origin documents interleave marker stage/settlement/clear/consume without losing unresolved notices or suppression | unit + two-document live fault injection |

Visual evidence uses existing `capture-evidence.ts` with exact new case directory `packages/ui/e2e/os-host-browser/tabs-visual/`: complete-viewport checkpoint PNGs, `evidence.json`, `review.md` colocated (attachments may duplicate, not replace; not golden baselines). Future verification owner owns helper outputs and implementation report; automation initializes/resets **PENDING_HUMAN_REVIEW only**. Actual human operator owns decision content of `review.md`, records identity/timestamp, matching source fingerprint/Git HEAD/run ID and every inspected image SHA-256, ACCEPTED or REJECTED with notes. Functional assertions/capture and agent image inspection are separate evidence, neither human approval. Pending/rejected/mismatched receipt blocks visual qualification and `verify-browser-acceptance` completion; source/image/run change requires fresh capture/review, never synthetic approval.

## 8. Future gates, ownership and rollback

Single implementation integration owner **BrowserIntegrator** serializes all overlapping writers (host/sync/window/persistence/launch); roles here describe future work, not agents spawned. Docs owner publishes Gate 1 sections in `docs/system-architecture.md`, `docs/architecture/host-browser-cdp-streaming.md`, `docs/design-guidelines.md` before product edits, explicitly distinguishing intended from implemented. Code standards' window-only browser claim statement reconciled at final drift review. Phase dependencies enforce publication first; no maintained docs changed now.

Cross-plan overlap: host-review-remediation phase 02/03/04 is concurrent-writer risk, not whole-plan blocker; inspect current source and serialize affected writes before execution. Login-popup and video/audio plans are informational source baselines with possible writable overlap, never proof of qualification. Preserve decimal-string fences and hidden PCM suppression; no unrelated cleanup.

Rollout is a clean cutover, no dual aliases or feature flag. Do not roll back by loading new multi-tab records into old single-tab code: preserve sanitized portable addresses, disable Browser auto-creation, explicitly settle remote operations, then deliberately convert records if reverting. Never delete user targets or recovery markers merely to make rollback pass. Gate 2 compares implementation with every state/projection/visibility contract above; unintended drift fixes code, accepted drift updates docs and tests. Changelog records user-visible semantics and limitations; no version bump requested. Initial review and one targeted F1–F3 follow-up are complete, corrections resolved at plan-contract level. Final researched scope validation retained UX-only design; see [receipt](reports/final-validation.md). Implementation, runtime verification and actual human visual acceptance remain unperformed.

Unresolved product questions: none. Known API limitation: ambiguous create can remain unresolved; recovery boundary above is intentional, not guaranteed remote cleanup.
