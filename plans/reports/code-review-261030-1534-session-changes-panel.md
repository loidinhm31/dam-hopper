# Code Review — Read-only OMP Session Changes Panel

## Score: 3/10 — REQUEST CHANGES

Static source/artifact review. Feature has useful domain/UI separation, but production wiring, authoritative identity, historical fidelity, resource admission and qualification are not complete. Passing the present focused tests does not establish the promised invariants.

## Scope and verification

- Inspected all requested domain modules, public handlers, changed server integration sections, five server integration tests, frontend DTO/client/query modules, four review components, changed terminal callback plumbing, WorkspacePage, three browser specs, E2E fixture/spec/evidence/review, changed feature docs and relevant plan contracts/acceptance/qualification reports.
- Also inspected `inventory.rs`, `server/src/main.rs`, `server/src/api/router.rs`, relevant `secure_path.rs`, OMP adapter handshake, model URI helper and existing connection/transport error contracts. These are necessary to follow the requested changes end to end.
- Approximate inspected source/test/contract scope: 7,000+ lines; existing large integration files reviewed by relevant ranges/diff, not whole-file audit.
- No implementation edits, plan/task-state edits, builds, tests, linters or browser runs performed by this reviewer. TestVerification owns execution and sent its results to Main. Repository qualification reports are reviewed claims, not independently reproduced evidence.
- No per-user PTY ACL is claimed: public routes do inherit existing account middleware (`server/src/api/router.rs:121,300-319,528-530`). No direct source/token logging was found in the reviewed feature handlers. Secure per-file snapshot helper is genuinely reused; do not confuse that with complete root/namespace race safety.

## Critical issues — MUST FIX

### C1. Production binary never mounts private session-change controls

**Evidence:** `server/src/main.rs:1027-1043` binds/starts collector before `:1119-1120` installs the session-change service. `server/src/agent_status/runtime.rs:235` initializes that service to `None`; `collector.rs:74-82` conditionally mounts the router once during bind.

**Failure/impact:** On the ordinary startup path, `/private/session-changes/v1/*` is absent. Later setting the runtime handle cannot mutate the already-built Axum router. Real OMP prepare/lookup/settled requests fail even though direct-router tests pass.

**Correction:** Construct/wire the shared service before collector router construction, or use an always-mounted route with explicitly available service state. Add real-binary startup coverage, not only `private_session_changes_router(...)` tests. **Confidence: high.**

### C2. Launcher invents both connection generation and OMP identity

**Evidence:** `packages/ui/src/components/pages/WorkspacePage.tsx:691-730`: owner generation is hardcoded `1`; `ompSessionId = terminalOrSessionId`. `connections.ts:448-449,663-699` advances generation and rejects stale owners. Fallback terminal lookup at `WorkspacePage.tsx:705` has no owner/incarnation recheck afterward.

**Failure/impact:** Normal connected generations cannot use this owner; even if generation matches, the terminal/UI key is not the producer's OMP session ID. Existing baselines are queried under the wrong key; explicit from-now can manufacture a separate identity rather than recover the actual session. Exited sessions have no retained-session selector path despite its server DTO.

**Correction:** Carry the pane's exact TerminalRef/instance owner; capture the live connection; resolve actual semantic OMP identity or explicitly choose from bounded retained sessions; revalidate owner/incarnation after awaits. Never substitute a terminal key/default profile for missing identity. **Confidence: high.**

### C3. Capture authorization bypasses validated project/worktree binding

**Evidence:** `server/src/pty/manager.rs:1750-1772` activates producer credential before binding raw launch cwd. `control.rs:134-138` and `api/session_changes.rs:159-166` use launch cwd or process `.`. `binding.rs:18-32` is not called by production; its canonical-target structure is separate from the structure used in `store.rs:31-35`. From-now directly inventories that path without root preflight.

**Failure/impact:** Unknown terminal/incarnation can capture the server's working directory; untargeted cwd outside configured projects is not rejected; configured project/worktree identity/current workspace generation is never revalidated. Even valid terminals launched in a project subdirectory can fail original tracking because raw cwd is treated as the Git root. Root changes for one OMP identity get independent map keys instead of rootMismatch.

**Correction:** Bind one canonical, server-authorized target descriptor before credential activation; fail closed when absent; use current configured target/worktree/generation validation for capture and every query. Remove `.` fallback and dead duplicate binding convention. Preserve the existing account policy; this is a scope/identity defect, not a new per-user ACL requirement. **Confidence: high.**

### C4. Original capture lacks reservation, cancellation and failure-tombstone fencing

**Evidence:** `capture.rs:25-94,132-135` checks then scans then unconditionally inserts. Request `mode`, `lifecycle`, `expires_at_ms` are never enforced. No initializing reservation is installed before await. `fail_session_capture` at `:241-251` cannot tombstone an absent record. Scan permit lives in the async caller (`:79-94`), not the blocking closure. Comparison has the same permit-lifetime pattern (`comparison.rs:44-57`).

**Failure/impact:** Concurrent preparations can recapture/overwrite the same original; failed/removed/replaced identities can publish after blocking work returns. Expired or lookup-mode prepare can still scan. Cancelling the awaiting future releases a permit while its blocking task continues, so the claimed two-scan ceiling is not a real ceiling.

**Correction:** Atomically admit/reserve one operation/identity before filesystem work; latch failures even before bytes exist; enforce accepted monotonic deadline and exact reservation generation/target/incarnation on publication. Move owned permit/accounting into the blocking closure until actual exit. **Confidence: high.**

### C5. Activation/receipt/failure controls do not fence immutable origin identity

**Evidence:** `capture.rs:179-187` does not verify registration ID and generates a new receipt for duplicate activation. `:202-234` checks epoch and receipt ID only—not TTL, baseline ID, registration ID or nonce. `:241-251` ignores the entire FailureRequest and makes whichever current record unavailable. `control.rs:348-367` accepts settled work without checking requested baseline ID/origin and launches detached refresh; failed/busy work is deduplicated without a dirty recovery marker.

**Failure/impact:** Expired activation can later become ready; duplicate activation invalidates prior acknowledgment; delayed old original failure can destroy explicit from-now review; stale settled frames affect a replacement baseline. Fail-before-prepare races remain resurrectable. Lookup does not enforce requested known epoch or current target.

**Correction:** One typed, origin-qualified state machine with exact epoch/registration/session/root/baseline/nonce/receipt/TTL checks and idempotent activation/receipt. Original failure state must be independent of active from-now; settled admission must validate exact active origin/baseline and preserve a bounded dirty hint on failure/busy. **Confidence: high.**

### C6. From-now relabels old baseline bytes instead of installing the newly captured baseline

**Evidence:** `api/session_changes.rs:202-241` puts the new inventory and active-from-now material only in `or_insert_with`; for an existing initializing/failed record, `:243-252` updates ID/origin/time/coverage but not `baseline_inventory`, `canonical_root`, `active_from_now`, existing comparison or manifest. Comparisons read `baseline_inventory` (`comparison.rs:30-41`).

**Failure/impact:** The exact recovery workflow promised by the design shows old session-start bytes under a fresh from-now baseline ID/time, or remains unable to compare. Stale revision/comparison metadata can reference a different baseline. Concurrent from-now requests can also overwrite accepted metadata without an identity reservation.

**Correction:** Atomically install the newly captured immutable baseline and reset all current-revision metadata under reservation fencing; preserve original failure latch separately. Do not duplicate raw inventory into another owning record. **Confidence: high.**

### C7. Advertised resource ceilings are largely constants, not enforced admission

**Evidence:** `inventory.rs:86-98` collects/sorts an entire directory before checking trie limits; all file captures happen before `:251` inserts bounded trie metadata. `store.rs:93-110` reserves only a counter; its only production caller is `capture.rs:95-96`, after allocation. From-now (`api/session_changes.rs:180-253`) has neither max-32 admission nor global reservation and clones the entire baseline. Comparisons clone baseline and file buffers repeatedly (`comparison.rs:30-69`), allocate current content without accounting, and list/detail clone source under a global lock (`:278-303`). Detail concurrency/page/detail byte limits have no implementation consumers. TempDir is created but captured bytes remain in Vecs.

**Failure/impact:** Wide directories defeat metadata/time bounds before insertion; repeated from-now identities retain unbounded source memory; concurrent/list/detail operations can exceed 512 MiB independently of the counter. The server can stall or OOM despite reporting bounded tracking. Reservation release subtracts only baseline coverage and cannot represent current/candidate/duplicate storage.

**Correction:** Reserve before allocation/read; stream bounded directory entries; share metadata/manifest accounting; account baseline/current/candidate/scratch/leases/serialization and enforce global identities for every creation path. Use shared immutable artifacts rather than cloning source. Enforce response limits and actual two-detail leases. **Confidence: high.**

### C8. Historical absence is certified without the required observed stability

**Evidence:** `inventory.rs:78-105` silently discards individual readdir failures; it does no before/after directory identity or child-set revalidation; `:251` always calls `record_directory(..., true, ...)`. Missing descendants then become certified absent (`absence.rs:257-264`). Nested roots/gitlinks are not detected: only entries named `.git` are skipped (`inventory.rs:109-113`), and every other unignored directory is traversed. Ordinary pathname read_dir also bypasses the descriptor-safe directory helper already available in `fs/secure_path.rs`.

**Failure/impact:** A file omitted through read error or directory drift can later be labeled a new addition instead of unknown. Nested-repository files become part of a supposedly single-root snapshot. File-level no-follow reads do not validate namespace proof or pin target identity for the whole scan.

**Correction:** Descriptor-safe bounded enumeration and before/after ancestry/directory/child-set certification; incomplete/error/drift must invalidate relevant negative proof permanently. Prune nested roots/gitlinks and exclude their content. Do not infer scan-wide stability from individual successful file reads. **Confidence: high.**

### C9. Incomplete current scans fabricate deletions; unsupported content fabricates equality/counts

**Evidence:** `comparison.rs:140-168,350-370` treats every baseline path missing from current inventory as definitely absent. Current omission can mean ignored, unreadable, deadline, path/byte limit or symlink. `inventory.rs:179-194` stores oversized files as empty byte vectors; comparison equality checks bytes alone (`comparison.rs:81,311`). Added/deleted branches ignore text-limit results and binary kind (`:142-160,176-195`); `get_file_detail` marks unsupported kinds renderable (`:533-535`) and invents absent sides when manifest data is missing (`:505-512`).

**Failure/impact:** Existing files are presented as deleted; changes between two uncaptured oversized files disappear as equal; binary/oversized data gets zero or confident counts/empty-text rendering. Global `countsComplete` starts true regardless of original/current coverage gaps.

**Correction:** Separate presence proof from admitted content; inspect/prove baseline-only current paths within the operation budget. Unknown/unsupported bytes are never empty bytes. Preserve unknown sides/reasons; apply text/line/kind bounds to all change kinds; aggregate completeness must include coverage. **Confidence: high.**

### C10. Revision/baseline fences and pagination do not protect returned source

**Evidence:** Public refresh/list/detail parse but never check `baseline_id` (`api/session_changes.rs:279-294,326-339,377-389`); root is hardcoded `.` in these paths/status. `comparison.rs:246-266` publishes by current key without validating which baseline/root/generation was scanned. `get_file_detail` releases the listing lock and reacquires records without rechecking revision (`:477-495`) and echoes the requested revision (`:541`). It searches only the first 200 rows (`:477-482`).

**Failure/impact:** A comparison started against old bytes can be published under a replacement baseline ID; detail rows from R can be paired with content from R+1. Changed files after row 200 cannot be opened. Panel itself fetches only the first page and never consumes nextCursor (`SessionChangesPanel.tsx:69-85`).

**Correction:** Retain one immutable comparison artifact with indexed metadata and shared original/current bytes; fence exact epoch/baseline/root/incarnation/revision before publication and response handoff. Detail lookup must cover the complete bounded artifact, independent of pagination. UI must page through all changed rows. **Confidence: high.**

### C11. Capture-phase keyboard isolation disables the review's own keyboard handlers

**Evidence:** `SessionChangesHost.tsx:32-46,64-66` stops propagation during capture at the content ancestor. List navigation is a descendant keydown handler (`SessionChangedFilesList.tsx:55-76`); Monaco also receives keys on descendants. Existing accessory shell has document capture Escape handling (`TerminalFloatingControlShell.tsx:59-67`); opening review does not dismiss its keyboard/shortcut state (`MobileTerminalAccessoryBar.tsx:260-267`).

**Failure/impact:** Events can be stopped before reaching list/Monaco target handlers, while already-run document/window capture shortcuts are not isolated. Competing accessory/other dialog focus/escape traps are not arbitrated; exact invoker focus is not retained by this custom host.

**Correction:** Isolate workspace/PTY dispatch at their capture/input ownership guards while preserving target delivery inside the dialog; contain bubbling appropriately. Close accessory/sheet/dialog competitors on open and restore the surviving exact invoker. Test actual Arrow keys, Monaco find/copy/selection/Tab/Escape and a document capture listener—not only body bubbling. **Confidence: high.**

### C12. Review can report no changes before any comparison, and stays stale afterward

**Evidence:** Panel reads status/list/detail but never refreshes on open (`SessionChangesPanel.tsx:51-147`); files remain empty when `comparison` is null. Empty message at `:284-288` says no changes for ready status without a completed comparison, even during files failure/loading. Query module has only query hooks and explicit mutation invalidation (`session-changes-queries.ts:93-324`), no settled/open/reconnect recovery, identity/revision acceptance checks or close cache purge. Source queries survive unmount under ordinary cache lifetime.

**Failure/impact:** Fresh ready/from-now baselines display a confident empty result before current scan; later producer revisions or external edits need manual recovery; initializing status has no deterministic promotion refetch. Complete baseline plus incomplete current scan can still say no changes. Closing does not meet the promised source-cache purge; profile/session changes do not close/rebind the stored host owner.

**Correction:** Authoritative status then bounded refresh on open/reconnect/visibility recovery; invalidate from exact settled identity; guard post-await owner/revision/request sequence; explicit list/detail/refresh/from-now errors and coverage reasons/current timestamps. Purge/cancel source cache/models on close/retirement; implement retained-session selection. **Confidence: high.**

### C13. Qualification evidence claims behaviors the tests never exercise

**Evidence:** `e2e/session-changes-review/session-changes-review.spec.ts:27-56` puts the entire feature journey behind `if (await changesButton.isVisible())`, succeeding when absent. Its fixture only stages a dirty Git repo (`omp-session-fixture.ts:17-64`), with no installed OMP/managed PTY/model tool turn; no Monaco original/current assertions occur. Browser host test only checks body bubbling (`session-changes-host.browser.tsx:96-108`); viewer tests assert toolbar text rather than mounted model read-only behavior (`session-changes-viewer.browser.tsx:76-95`). Lifecycle test manually inserts/removes records, never drives PTY replacement/dispose (`server/tests/session_changes_lifecycle.rs:57-80`).

`reports/qualification.md:4-24` marks all acceptance verified and even references absent `server/tests/session_changes_capture.rs`, `session_changes_store.rs`, `session_changes_absence.rs`. `resource-qualification.md:22-24` claims 100,000 trie nodes and temp-backed baselines despite 10,000 constant and Vec storage. Case `evidence.json:42-43` claims pass; current case directory has no PNG files. Case `review.md:3-9,25-26` remains pending. `docs/project-roadmap.md:9` claims runtime verification complete. Overview `plan.md:4` says completed while phases/tasks remain pending.

**Failure/impact:** Release acceptance is unsupported; production failures C1/C2 are hidden by isolated happy-path tests and optional E2E assertions. Real OMP, cancellation/resource measurements, authenticated denials, native Tauri and human visual gates remain unproven.

**Correction:** Required entrypoint must be asserted, not conditional. Provision actual pinned OMP, execute controlled first tool mutation, assert exact server/Monaco bytes and no repository mutation; add meaningful race/bounds/lifecycle/security assertions. Replace unsupported reports/docs with exact observed results/blockers and actual captured artifacts; human/native gates cannot be certified by source or mocked component rendering. No plan state edited in this review. **Confidence: high.**

## Warnings — SHOULD FIX

1. **Private HTTP admission lacks existing collector hardening.** `control.rs:55-110` authenticates bearer but never checks Host, Origin, peer or query; those checks exist only inside the WS handler (`collector.rs:163-197`), not shared middleware. Only prepare uses the control semaphore (`control.rs:123`); no per-bearer 4/s limiter or bounded settled admission. Preserve bearer auth, add exact loopback route guards/rate admission and reserved cheap completion capacity. This is defense-in-depth and protocol compliance; no unauthenticated token bypass is alleged.
2. **Per-file diff does not bound work and is run under the global source lock on reads.** `text_diff.rs:123-127` times only after synchronous libgit2 finishes; MAX_LINE_COMPARISON_UNITS is unused. `comparison.rs:278-431` repeats whole-repository row construction/diff on each page/detail while holding records lock, on the async handler thread. Precompute once in admitted blocking comparison work; use cooperative algorithm work bounds; keep locks short.
3. **Lifecycle destruction leaves old source records.** Actual remove is hooked (`manager.rs:2342-2348`), but winning incarnation replacement (`:1735-1746`), durable eviction (`:2650-2693`) and workspace disposal (`:2769-2795`) do not release feature records/bindings. Historical source remains available through handlers that do not verify current PTY incarnation and consumes bounded-original capacity indefinitely. Release exact destroyed identities after successful authority transitions, never on normal exit or failed durable deletion.
4. **Typed HTTP errors are lost in the real client path.** `session-changes-client.ts:54-67` decodes `err.response`, whereas `ApiRequestError` exposes `details` (`client.ts:105-114`; constructed with parsed body in `ws-transport.ts:3171-3176`). Real refreshRequired/busy/capacity becomes networkError. Decode actual ApiRequestError.details and retain code/retryability/currentRevision; server refreshRequired currently always omits currentRevision (`api/session_changes.rs:18-24`).
5. **Decoders coerce malformed responses instead of validating.** `session-changes-types.ts:366-415,463-543` uses Boolean/Number/String and enum casts, no safe numeric/ID/path/array/text limits, no request-versus-response identity check. Invalid FileRow.change can reach undefined badge access (`SessionChangedFilesList.tsx:85,106`). Validate bounded exact types/enums and source/coverage invariants before render. Canonical decimal helpers in both languages also accept values beyond u64.
6. **Adapter readiness guard remains incomplete.** Supporting modified adapter `omp-agent-status.ts:550-563,607,650,678` checks a per-entry token that is not cancelled on session switch (`:710-715`) or shutdown (`:345-368`); response assertions do not verify full identity. `:631-661` floors remaining deadlines at 1s and `:687-705` awaits another fail request. `:1126-1129` treats truthiness of getSessionFile path as file existence and missing capabilities as fresh; `sanitizeSessionId` (`:155-165`) truncates/collides identities used by new capture controls. Implement exact session ID validation, verified freshness, cancellable attempt liveness and one monotonic overall deadline; loss of final receipt response must not invalidate already-acknowledged bytes.
7. **Frontend error/coverage/accessibility detail is missing.** Errors in refresh/from-now are swallowed without rendered mutation state (`SessionChangesPanel.tsx:118-146`); original/current coverage reasons and current comparison timestamp are not displayed. Disclaimer and empty wording always say session start even for fromNow. List uses shifting left border instead of project selection tokens (`SessionChangedFilesList.tsx:95-98`), no aria-activedescendant/roving focus/scroll-to-selection; several compact panel buttons are below required 44px. Preserve truthful origin and usable keyboard/touch states.
8. **Wire/docs drift.** Rust Option fields use skip_serializing_if despite contract explicit nulls (`types.rs:226,241-247,561-568,615-616`); request structs lack deny_unknown_fields and identifier bounds. Public routes inherit 10 MiB default body limit, not feature 16 KiB (`api/router.rs:24,625`). API docs use expectedServerEpoch for files/detail while handlers require serverEpoch (`docs/api-reference.md:81-82`); call offset cursors keyset pagination and omit /fail. Align contracts, request limits, examples and stable error/status mapping.

## Suggestions — NICE TO HAVE

1. **Delete redundant/dead representation rather than add layers.** Consolidate duplicate BoundTerminalTarget types; remove unused ComparisonArtifact/FileRowInternal source ownership and FromNowRecord data duplication after adopting one immutable artifact/state machine. Build file rows once instead of maintaining near-duplicate classification logic in refresh and listing.
2. **Model lifecycle should follow existing keep-current/deferred-disposal pattern.** Viewer creates/destroys models itself and immediately disposes matching global models (`ReadonlyMonacoDiffViewer.tsx:116-144`) while DiffEditor receives neither matching model paths nor keepCurrentOriginalModel/keepCurrentModifiedModel (`:255-272`). Establish one owner of model attachment/disposal and actual mounted-editor lifecycle tests before relying on toolbar assertions.
3. **Remove unused URI parser or make its encoding reversible.** `session-changes-model-uri.ts:24-28,47-65` joins encodeURIComponent fields with `_` and splits on `_`, which encodeURIComponent does not escape; valid underscore-containing identifiers do not round-trip. Runtime URI identity already has useful dimensions; use distinct path components/structured encoding if parsing is needed.

## Positive observations

- Separate read-only viewer lacks repository mutation callbacks; original/current DTOs and distinct presence/provenance concepts are a sound direction.
- Owner-qualified query key structure, URLSearchParams/path encoding, random baseline/nonce IDs and no-store headers on normal feature JSON responses are useful existing foundations.
- `read_regular_snapshot` performs real descriptor/no-follow and before/after per-file stability checks (`fs/secure_path.rs:608-665`); reuse this approach for directory/target authority rather than replace it with unchecked pathname traversal.
- Existing normal-exit terminal retention policy was not expanded; public route middleware remains account-authenticated.

## Recommended repair/acceptance order

1. Restore real startup routing and exact UI/PTY/OMP target identity; no cwd/default owner fallbacks.
2. Correct reservation/origin/cancellation state machine and from-now byte installation before extending feature claims.
3. Enforce pre-allocation resource admission, certified namespace/current absence, immutable comparison artifacts and full pagination.
4. Correct modal event ownership, cache/model lifetime, authoritative refresh and truthful loading/error/coverage presentation.
5. Main verification after repairs: real-binary collector + OMP first edit; failed-original/from-now/stale-control races; removal/replacement/dispose; wide/deep/nested/symlink/omission limits and measured memory; >200 rows; actual Monaco key/model immutability; required authenticated app journey plus native/human receipts. Current suites alone are insufficient.

## Metrics / unresolved evidence

- Type coverage: not measured; typed DTO declarations do not equal runtime validation.
- Test coverage: not measured; no percentage asserted.
- Lint issues: not measured by this reviewer.
- Outstanding evidence: actual installed OMP first-turn ordering, authenticated full application journey, adversarial cancellation/resource measurements, Tauri host capture and human visual acceptance. None established by inspected artifacts.
- Implementation qualification: incomplete. Product scope/questions are defined in the frozen contract; the missing items are implementation and evidence, not a request for product clarification.
