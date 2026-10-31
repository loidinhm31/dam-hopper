# Consolidated Session Changes Architecture Review

## Score: 5/10

The consolidation is directionally correct: one stored `ComparisonArtifact` now supplies list rows and detail lookup; detail no longer rescans disk or depends on the first 200 rows. It does not yet establish end-to-end snapshot fidelity, bounded resource use, or complete UI behavior. Changes required before treating the feature as qualified.

## Scope and evidence

Reviewed all requested files:
- `server/src/session_changes/store.rs`
- `server/src/session_changes/comparison.rs`
- `server/src/session_changes/control.rs`
- `server/src/session_changes/capture.rs`
- `server/src/api/session_changes.rs`
- `packages/ui/src/components/organisms/SessionChangesHost.tsx`
- `packages/ui/src/components/organisms/SessionChangesPanel.tsx`
- `packages/ui/src/components/pages/WorkspacePage.tsx` — changed integration sections, not the unrelated full workspace.

Supporting evidence: `inventory.rs`, `text_diff.rs`, `types.rs`, `binding.rs`; session changes client/query hooks; read-only Monaco viewer; comparison/adversarial/browser tests; PDR, code standards, API/architecture docs and `plans/261030-1215-session-changes-panel/contracts.md` S4–S9. Approximately 2,000 requested-file lines plus supporting sections inspected.

Static review only. No compilation, typecheck, lint, tests, or runtime checks executed; main agent owns verification. No implementation or plan/task-state edits.

## Critical issues

### C1 — Concurrent capture publication can destroy the immutable original

**Evidence:** `capture.rs:66-86,98-103,135-198`; public `api/session_changes.rs:147-157,210-224,246-299`; `comparison.rs:21-33,270-293`.

Existing-state checks happen before asynchronous capture, with no preparing reservation or per-identity single-flight ownership. Publication later inserts/replaces without revalidating identity, baseline, registration, or operation generation. Two prepares can both pass the initial check; one can finish and be acknowledged while the other is still scanning; the second then unconditionally replaces the acknowledged original. From-now can likewise pass its early check, race a valid original receipt, and replace that original. Comparison snapshots only the inventory/root, then labels the result with the record's baseline ID at publication; a replaced record can receive rows computed against the previous baseline. Concurrent comparisons can also publish older disk state as the newest revision.

**Impact:** irreversible loss of actual session-start bytes and misleading baseline/current pairs. This is snapshot-data integrity, not a claim that repository files are mutated. **Confidence: high, source-grounded race.**

**Correction:** reserve the exact identity/operation under lock before capture; reject/coalesce duplicate work; publish only if captured baseline/registration/target/operation generation still matches. Recheck the acknowledged-original guard at from-now commit. Validate `RefreshRequest.baseline_id` atomically with scan admission; it is currently unused by `refresh` (`api/session_changes.rs:305-332`). A new baseline must not accept stale pinned reads merely because its revision counter restarted.

## Warnings

### W1 — High: capacity accounting does not bound actual retained memory

**Evidence:** `store.rs:36-47,61-68,106-139,217-221`; `comparison.rs:27-32,51-59,289-293`; `api/session_changes.rs:232-275,292-297`; `capture.rs:135-136`.

`CapturedFile.bytes` is a `Vec<u8>` (`inventory.rs:13-23`), so cloning baseline inventories and union entries duplicates raw contents. Changed rows retain another original/current pair, while `current_revision_manifest` retains all current bytes but has no production reader. From-now retains duplicate baseline inventories in `baseline_inventory` and `active_from_now`. The counter charges only baseline raw bytes, after capture allocation; no current/candidate/duplicate/metadata/response reservation exists. From-now also never checks the 32-retained-identity cap, allowing arbitrarily many distinct session IDs, including metadata-only captures that charge zero raw bytes.

**Impact:** authenticated resource exhaustion and substantially higher heap use than the advertised 512 MiB accounting limit. **Confidence: high.**

**Correction:** one immutable byte owner per captured side, shared handles where needed; delete unused retained manifest data; reserve candidates/metadata/responses before allocation and enforce identity admission in every capture path. Do not introduce another cache.

### W2 — High: detail presence still contradicts the shared list row

**Evidence:** `comparison.rs:175-184,238-245,374-416`.

Rows correctly represent unverified missing sides as `Presence::Unknown`, but detail converts every missing `CapturedFile` into `Presence::Absent`. Thus `detail.file.original_presence` can be unknown while `detail.original.presence` is absent; the equivalent contradiction exists for current presence. Sharing rows synchronizes the nested `FileRow`, not the whole detail response.

**Correction:** copy `row.original_presence` / `row.current_presence` into the respective `ContentSide`; absent bytes are not proof of absent files. Add unknown/excluded-original and unverified-current regression cases. **Confidence: high.**

### W3 — High: rootId propagation is incomplete end to end

**Evidence:** `api/session_changes.rs:49-57,100-105,325-330,348-362,423-435`; `SessionChangesPanel.tsx:52-83,95-128`; `WorkspacePage.tsx:732-739`. Supporting `session-changes-queries.ts:93-134,137-248` and `session-changes-client.ts:86-101,126-189`.

Only server files/detail queries honor `rootId`. Public status and refresh still select `.`; the client and files/detail hooks cannot forward a root; the status hook puts root in its query key but omits it from its request. Workspace opening always hardcodes `.`. Preparing/from-now with a non-default root can succeed, then the panel queries a different record and reports missing or requests the wrong comparison.

**Correction:** carry the exact selected root through status, refresh DTO, client/transport, files/detail query keys and payloads, and workspace retained-session selection. **Confidence: high.**

### W4 — High: unsupported/binary files still get misleading equality and counts

**Evidence:** `comparison.rs:72-76,194-219`; `inventory.rs:190-204`.

Oversized files have an empty digest and no bytes; two unsupported snapshots therefore compare equal by `"" == ""`, hiding unknown content changes. Added files are counted using UTF-8 decoding irrespective of `FileContentKind`, and the line-limit result is ignored. Added binary/non-UTF8/unsupported files can receive invented numeric counts, no reason, and leave `counts_complete=true`.

**Correction:** equality requires admitted bytes or a valid actual digest, never missing-digest sentinels. Unknown/unsupported comparisons stay explicit. Numeric text counts require text kind and successful bounds checks; propagate reasons and mark aggregate counts incomplete. **Confidence: high.**

### W5 — High: renderability and response limits are not enforced

**Evidence:** `comparison.rs:374-426`; limits declared in `types.rs:24-32`; text-bound rejection in `text_diff.rs:47-95`.

`renderable` checks only kind for added/deleted/modified files, ignoring byte/line/line-length limits, and returns true unconditionally for mode-only changes. A binary chmod therefore produces a renderable detail with null content on both sides, which the viewer converts into empty models (`ReadonlyMonacoDiffViewer.tsx:122-126`). Text rejected for text limits can still be sent to Monaco. Two captured sides can each hold 2 MiB, exceeding the 2 MiB combined-detail contract. Detail response leases/concurrency and page serialized-byte limits are also absent.

**Correction:** derive rendering eligibility from admitted bounded text, represent mode-only metadata without inventing empty text, and enforce response limits before cloning/serialization. **Confidence: high.**

### W6 — High: CPU-heavy comparison executes on Tokio workers without an overall deadline

**Evidence:** `comparison.rs:43-48,50-262`; `text_diff.rs:123-134`.

Only current inventory capture runs in `spawn_blocking`. Union construction, buffer copies, line counts, and libgit2 diff run after `.await` on the async executor. The five-second comparison limit is supplied only to inventory, not subsequent processing. Per-file elapsed time is checked after synchronous libgit2 work returns, not cooperatively during it; many files can accumulate unbounded-overall comparison time.

**Correction:** move complete candidate construction/diff work to bounded blocking execution, enforce a shared operation deadline between units, and retain permit ownership until the blocking closure exits, including cancellation. **Confidence: high for execution placement; runtime impact not benchmarked.**

### W7 — High: settled scans can be lost permanently

**Evidence:** `control.rs:403-423`; unused recovery fields in `store.rs:70-71`.

Turn IDs are marked seen before the spawned comparison succeeds. Busy/failure results are discarded, so identical delivery is subsequently treated as duplicate without a fresh comparison. There is no per-identity flight/coalescing mechanism or dirty-hint update. Dedup also evicts lexicographically smallest IDs from a `BTreeSet`, not the oldest accepted turn.

**Correction:** implement the already-specified one-flight/latest-dirty-turn behavior; retain failed/busy reconciliation hints and handle result publication explicitly. A single bounded mechanism should serve manual and settled scans. **Confidence: high.**

### W8 — Medium/High: the panel still hides files, failures and current coverage gaps

**Evidence:** `SessionChangesPanel.tsx:70-85,118-138,141-153,237-300,315-333`.

The UI always requests cursor null / limit 200 and never consumes `nextCursor`, so file 201+ remains unreachable even though backend detail lookup is fixed. Query/mutation errors are swallowed or never rendered: a files failure can say “No changes detected”; an initial refresh failure can leave “Computing…” indefinitely; detail errors say “Select a file.” Empty-state coverage consults baseline status only, not `comparison.currentCoverage`, so an incomplete current scan can appear clean.

**Correction:** expose bounded pagination and authoritative total count; render typed error/retry states separately from empty results; display both baseline and current coverage. **Confidence: high.**

### W9 — Medium/High: visible refresh and retained-session reopening remain disconnected

**Evidence:** `SessionChangesPanel.tsx:133-138`; `WorkspacePage.tsx:700-739`; query hooks `session-changes-queries.ts:111-134,251-324`.

The panel auto-refreshes only when no comparison exists. No semantic settled subscription invalidates its status while open; backend settled publication alone cannot update the mounted query. Opening an existing comparison does not force the required fresh disk comparison. When a semantic OMP row disappears, workspace opening substitutes `terminalId` for `ompSessionId` rather than using the existing retained-session selector, so an actual retained original can be presented as missing.

**Correction:** exact-owner settled invalidation plus bounded refresh on open/reconnect; use retained metadata when the live semantic session is absent. Never manufacture a new session identity as recovery. **Confidence: high.**

## Suggestions: architecture, KISS/DRY and qualification

1. Keep `ComparisonArtifact` as the sole immutable published comparison. This is the correct simplification; fix surrounding admission/publication rather than rebuilding parallel list/detail algorithms.
2. Remove `current_revision_manifest` once shared byte ownership is in place; reduce duplicated from-now snapshot state and centralize construction/publication policy currently repeated in capture and public API handlers. Retain original-failure state separately: from-now currently clears `original_failed` (`api/session_changes.rs:297`), contrary to the independent failure-latch contract.
3. Keep the host's child-first bubbling boundary (`SessionChangesHost.tsx:46-49`); do not restore the native capture listener that blocked React children. Strengthen browser assertions: list arrows/Enter, copy, Tab, Escape/Monaco widgets, focus return, no terminal writes, and document/window shortcut leakage. Existing host test dispatches a key but asserts neither child handling nor leakage (`session-changes-host.browser.tsx:96-99`). Runtime keyboard correctness is not established by this review.
4. Main-owned targeted verification should cover racing prepare/receipt/from-now and simultaneous refreshes; unknown presence; non-default roots; added binary and oversized files; rendering/response boundaries; 201+ changes; request failures and incomplete current scans; busy settled recovery and exited-session reopening. Existing happy-path tests do not establish these properties.
5. Align docs with the implemented keyboard strategy: `docs/CHANGELOG.md:8`, `docs/frontend-components.md:39`, and `docs/system-architecture.md:68` still describe capture-phase isolation. Resource qualification also claims temp-directory baseline storage (`reports/resource-qualification.md:24`), whereas inspected snapshots retain `Vec<u8>` in memory; declarations and report text are not enforcement evidence.

## Positive observations

- List/detail share exact stored rows and revision checks (`comparison.rs:298-371`); no detail disk scan or first-page search remains.
- Added/deleted text eligibility now checks the side actually present.
- Private control derives terminal/incarnation from bearer credentials (`control.rs:60-98`); public routes are behind existing authentication (`api/router.rs:301-319,526-530`). No authentication bypass identified in this scope.
- API success/error helpers emit no-store headers; reviewed error strings do not expose raw paths/source.
- Review UI remains separated from mutation controls, and model URIs include owner/session/root/revision identity.

## Metrics and unresolved evidence

- Type coverage, test coverage, lint counts: not measured.
- Executed verification: none; static evidence only.
- Unresolved runtime evidence: full keyboard/focus/terminal isolation, race behavior under coordinated scheduling, memory under admission pressure, and native/browser qualification. These are test gates, not reasons to defer the source-visible corrections above.
