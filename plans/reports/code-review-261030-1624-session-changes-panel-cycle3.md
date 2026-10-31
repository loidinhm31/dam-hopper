# Code Review — Read-Only OMP Session Changes Panel, Cycle 3

## Score: 4/10 — REQUEST CHANGES

Local fixes improve normal rendering/event delivery, but direct detail lookup introduces a wrong-file mapping. Baseline publication, truthful provenance, resource admission and identity/target ownership remain release blockers.

### Scope and evidence

- Reviewed all eight requested paths: `server/src/session_changes/{comparison,control,capture}.rs`, `server/src/api/session_changes.rs`, `packages/ui/src/components/organisms/{SessionChangesHost,SessionChangesPanel}.tsx`, `packages/ui/src/components/pages/WorkspacePage.tsx` (integration diff and relevant lifecycle references), `packages/ui/browser-tests/session-changes-host.browser.tsx`.
- Supporting evidence: session query/client/transport, inventory/store/root/binding/types, PTY binding publication, list/viewer, comparison and panel tests; PDR, code standards, frozen `plans/261030-1215-session-changes-panel/contracts.md`, Phase 06 and Cycle 2 report. Approximately 2,500 primary implementation/test lines plus supporting sections.
- Source review only: no builds, tests, linters or browser execution by this reviewer. Runtime consequences below are source-derived **[INFERENCE]**, high confidence unless qualified. No passing-check or measured-performance claim.
- No implementation or plan/task-state changes. This report is the only file created. Findings apply to inspected state, not necessarily attribution to a particular commit.

## Cycle 3 fix disposition

| Requested repair | Source-level disposition |
|---|---|
| Added-file renderability | Correct local branch: `comparison.rs:610-617` admits Added with text current side. Not complete: unknown originals are independently relabeled Added/Absent in detail. |
| Single-lock detail; no 200 clamp | Domain function now takes one records lock and does not call paginated list. **Wrong file-ID enumeration introduced/exposed; see C1.** API still prechecks under a separate lock. |
| Remove native stopPropagation blocking React | Replaced by React synthetic bubble handler at `SessionChangesHost.tsx:46-49`; preserves child React handler delivery by construction. Capture-phase competitors remain outside this boundary; browser test does not assert keyboard behavior. |
| Initial comparison; accurate loading | Effect and initial computing indicator added at `SessionChangesPanel.tsx:133-138,291-295`. Failure/loading distinction, reopen freshness, initializing promotion and current coverage remain incomplete. |
| rootId propagation | Backend files/detail query extraction and key construction fixed at `api/session_changes.rs:353-354,382,428-429,455`. UI hooks/client/transport still drop root; status/refresh still use `.`. |

## Critical issues — MUST FIX

### C1. Detail file IDs enumerate all paths; list IDs enumerate changed paths

**Evidence:** `comparison.rs:341-381` skips unchanged files and increments `file_idx` only for rows emitted; `:539-545` increments for every union path before matching the requested ID.

**Failure/impact [INFERENCE]:** Baseline/current both contain unchanged `a.txt` and modified `z.txt`. List returns `z.txt` as `fid-1`; detail for that ID returns `a.txt` and classifies it ModeOnly. Normal repositories contain many unchanged files, so selecting a changed row can show unrelated content. Removing the page clamp does not preserve the list/detail identity contract, including IDs beyond 200.

**Correction:** Publish one revision artifact with authoritative changed rows and an indexed file-ID-to-path/source mapping. List and detail must use that same mapping; unchanged entries must never consume changed-row ordinals. Add unchanged-before/between-changed and >200-row exact path/content regressions, not merely a successful detail response.

### C2. Independently rebuilt list/detail fabricate known deletion/addition and render unknown originals

**Evidence:** Scan proves current absence before deletion at `comparison.rs:154-194`; publication retains only current files, not current trie (`:298-299`). List unconditionally reports every baseline-only path Deleted/Absent (`:383-402`). Detail makes every current-only entry Added, gives absent original and `AbsentInVerifiedDirectory` without consulting the baseline trie (`:550-585,620-633`). Added text then becomes renderable (`:610-611`). Oversize placeholders have empty bytes/digests (`inventory.rs:190-204`), which equality checks treat as unchanged (`comparison.rs:81-85,344`). Added stats discard text-kind/count-completeness checks (`:207-228,417-435`).

**Failure/impact [INFERENCE]:** A file omitted because of permissions/ignore/scan limits is shown as deleted. A file excluded/unproven at capture is Unknown in list but Added with an empty original in detail. Changed unsupported files can disappear, while unsupported additions get confident counts. The added-file renderability repair therefore enables a misleading diff for unknown history.

**Correction:** One authoritative classifier/artifact for scan/list/detail, retaining verified presence/provenance/current coverage. Unknown must remain unknown/unrenderable; unsupported bytes must never equal an empty placeholder. Apply text/count bounds and completeness consistently.

### C3. Capture and comparison publication remain unfenced across awaits

**Evidence:** `capture.rs:66-98,196-199` checks identity/capacity, awaits filesystem work, then inserts unconditionally without a per-identity reservation. `comparison.rs:30-41,279-299` snapshots one baseline then publishes into whichever record currently exists. `api/session_changes.rs:147-157,210-224,246-299` has the same check/await/overwrite shape for from-now. Refresh ignores supplied baseline ID (`:305-332`). API detail checks baseline then unlocks before domain read (`:458-491`); domain rechecks revision, not expected baseline. Failure cannot tombstone a missing reservation (`capture.rs:337-344`).

**Failure/impact [INFERENCE]:** Concurrent prepares can replace original bytes; removed/failed capture can publish late; an old comparison can be stamped with a replacement baseline ID. Baseline/revision reuse after replacement can bypass split prechecks. One global semaphore is not one operation per identity.

**Correction:** Reserve identity/capacity atomically before work; carry exact immutable baseline/root/incarnation plus operation generation through completion; publish only against the surviving reservation. Validate baseline/revision together with artifact acquisition. Preserve failed-original history independently from explicit from-now.

### C4. Memory/scan/response limits do not bound real allocations

**Evidence:** Capture reserves raw storage only after allocation (`capture.rs:98-136`); from-now has no retained-identity admission and duplicates inventory before reservation (`api/session_changes.rs:210-242,253-296`). Comparison clones baseline before acquiring a permit (`comparison.rs:30-49`), clones source again while unioning (`:60-68`), and installs unaccounted current bytes (`:299`). List/detail clone all source under the global records lock (`:311-335,510-534`). Detail/render byte and concurrency constants are declarations only in the searched session subsystem. Permit lives in async caller, not blocking closure (`capture.rs:89-100`, `comparison.rs:45-54`, public API `:199-214`).

**Failure/impact [INFERENCE]:** Authenticated request pressure can grow zero-byte identities without the 32-record bound, exceed the advertised global memory budget, and serialize unrelated sessions behind expensive source cloning. Cancellation releases permits while blocking scans still run. Declared detail/render limits do not constrain response/model allocations.

**Correction:** Prospective identity/storage/candidate/response admission; keep owned permit in actual blocking job until exit; share immutable byte storage instead of deep cloning. Acquire a revision artifact under a short lock and do bounded serialization/diff work outside it. Enforce text and combined response limits before allocation.

## High-priority warnings

### W1. rootId is not propagated end to end

`SessionChangesPanel.tsx:70-113` has no root argument for files/detail. `session-changes-queries.ts:40-85,124-130,178-188,235-244` omits root from source keys/requests; status root exists in its key but not its request. Client methods omit root (`session-changes-client.ts:86-92,126-134,147-157,170-179`), and transport explicitly serializes no root (`ws-transport.ts:1676-1692,1724-1767`). Backend status/refresh still key `.` (`api/session_changes.rs:100-105,325-330`).

**Impact [INFERENCE]:** Nondefault-root capture/from-now cannot be queried/refreshed by the panel; it may read the default root instead. **Correction:** Resolve the stored selected root consistently and thread exact root through status/refresh/files/detail, query keys, client, transport and invalidation. Test actual request URLs and two roots, not only Rust deserialization.

### W2. Launcher still invents session identity; target binding is launch cwd, not configured authority

`WorkspacePage.tsx:692-739` falls back to ambient/default profile and `ompSessionId = terminalId`; semantic row incarnation is not compared with selected incarnation. No retained-session selector is consulted. Production PTY publication stores `launch_cwd` (`server/src/pty/manager.rs:1750-1759`); control uses it as project root (`control.rs:149-160`), as does from-now (`api/session_changes.rs:170-197`). The configured-root resolver in `binding.rs:18-33` is not used by that path. Public reads do not revalidate configured target generation.

**Impact [INFERENCE]:** Missing/stale OMP metadata can query/create a fabricated identity; untargeted terminals in arbitrary Git directories are accepted for tracking, while valid subdirectory launches can fail direct-root preflight. Existing source remains available after target retirement. This is a configured-scope/ownership defect, not a claim of unauthenticated access or a new per-user ACL requirement.

**Correction:** Use exact displayed terminal owner/instance; validate row incarnation/generation; use retained identities or explicit unavailable state. Bind/revalidate the authorized project/worktree/root descriptor rather than treating cwd as authority.

### W3. Initial refresh errors become perpetual loading; current coverage and lifecycle are ignored

`SessionChangesPanel.tsx:118-138` catches refresh errors without rendering them. When comparison is null, `:291-295` always says computing, including after terminal mutation failure. The effect does not depend on mutation settlement, so it is not a recovery mechanism. File-query failures with no data fall through to no changes (`:296-300`); detail failures appear as select-file (`:315-332`). No visible error branch uses query/mutation errors. Empty-state completeness consults baseline status, not `comparison.currentCoverage`. Query hooks have no initializing/settled/visibility recovery (`session-changes-queries.ts:93-324`); opening an already-compared baseline does not scan again. Source caches are not removed on close; host state is not retired on owner/incarnation replacement (`WorkspacePage.tsx:676-742,2964-2975`).

**Impact [INFERENCE]:** Busy/network failures look indefinitely active or falsely empty, completed initial capture can remain initializing, hidden edits remain stale, and retired/closed source remains cached. **Correction:** Distinct pending/error/unknown/complete states; actionable retry; authoritative open/reconnect/settled reconciliation; render current coverage; cancel/purge exact source cache and models on close/retirement. Do not add an uncontrolled retry loop.

### W4. Settled Busy failures are accepted/deduplicated with no recovery; acknowledged receipt is not idempotent

`control.rs:403-422` inserts turn ID before detached scan, discards the result and never sets dirty state. `capture.rs:304-312` applies preparation TTL before recognizing already-received receipt; a delayed exact duplicate changes Ready to Unavailable. Activation does not validate registration (`:243-275`); failure accepts no absent-record tombstone and from-now clears original failure latch (`api/session_changes.rs:297`). Prepare ignores `mode` and refuses only Resume lifecycle (`capture.rs:25-33`).

**Impact [INFERENCE]:** A settled edit under scan pressure is silently lost, later duplicate cannot recover it, receipt resubmission expires an acknowledged original, and forbidden original recapture/lifecycle paths remain possible. **Correction:** Exact origin/registration/epoch/state transitions; already-acknowledged duplicates idempotent; failed-original latch immutable; bounded latest-turn dirty recovery and one scan per identity; enforce prepare mode/lifecycle before capture.

### W5. Host browser test no longer tests keyboard isolation

`session-changes-host.browser.tsx:96-98` dispatches ArrowDown on dialog content, not the list, and checks neither selection, preventDefault nor ancestor receipt. Only mount and click-to-close are asserted. Synthetic bubbling in host is the appropriate local repair, but cannot prevent already-executed document/window capture handlers. Existing competing capture listener unconditionally consumes Escape (`TerminalFloatingControlShell.tsx:59-67`); workspace opener does not arbitrate accessory/modal state.

**Correction:** With real host mounted, focus list and assert Arrow selection changes; assert body/document bubbling is contained; exercise capture-phase shortcut/competing accessory gating, Monaco find/copy/Tab/Escape and exact opener restoration. Gate global consumers by modal input ownership rather than reintroduce native capture stopPropagation.

### W6. UI still silently truncates changed files at 200

`SessionChangesPanel.tsx:70-85` requests only cursor null/limit 200 and never consumes nextCursor. Header displays loaded length (`:278`), not total comparison count. **Impact [INFERENCE]:** Even after direct detail repair, users cannot reach changed row 201. **Correction:** Bounded cursor pagination/infinite list and honest loaded/total count; include >200 changed files with interspersed unchanged paths.

## Medium-priority improvements

- **Private control admission/security:** Bearer authentication is present (`control.rs:60-98`), but only prepare uses the control concurrency semaphore (`:127`). Other handlers lack the contract's shared concurrency/per-bearer rate admission and reserved completion capacity. Reuse existing collector guards/rate patterns; do not add an unrelated authentication scheme.
- **Origin labeling:** Panel disclaimer always says session start even for fromNow (`SessionChangesPanel.tsx:225`). Use actual origin and show compared-at/current coverage reasons. An origin badge does not correct the contradictory prose.
- **DRY/KISS:** Three separate comparison classifiers are the principal architecture problem, not merely file length. `changed_rows` builds cloned row/source structures during scan only to retain their count (`comparison.rs:71-273`), then public reads recompute everything. Use one small immutable artifact and remove obsolete structures; no generic scheduler/repository abstraction needed.

## Positive observations

- Dedicated capability-free read-only viewer and top-level host remain separated from mutating Git UI.
- Domain detail no longer acquires the same records lock recursively through list and no longer requests a clamped giant page.
- Added/deleted text renderability arms express the intended absent-side rule locally.
- React synthetic isolation preserves child delegated handlers; Radix provides existing dialog semantics rather than a custom focus trap.
- Public source responses carry private/no-store headers; source file reads reuse secure regular-file snapshot helper.

## Recommended actions

1. Fix shared revision artifact/file-ID mapping and preserve unknown provenance before certifying rendering.
2. Fence baseline publication and apply prospective resource/response admission; preserve immutable original state.
3. Finish exact owner/root routing and lifecycle/error/current-coverage presentation.
4. Main agent/test owner should run focused Rust wrong-file/unknown/provenance/race/limits tests, client/transport root tests, real-host keyboard and initial-scan-failure browser regressions, plus supported typecheck/build/lint gates after changes settle. No such checks were run by this reviewer.

## Metrics / unresolved evidence

- Type/test coverage percentages: not measured; lint/build status: not assessed by execution.
- Source-inspected requested-file coverage: complete; runtime/end-to-end acceptance coverage: incomplete.
- Remaining evidence: real OMP first-turn capture, exact Monaco bytes/read-only behavior, source retirement, resource/cancellation measurements, namespace/publication races and native/human visual qualification. No unresolved product question; frozen contracts specify the required behavior.
