# Code Review Summary

**Score: 5/10 — changes required.**

## Scope and evidence

Reviewed all eight assigned files: `server/src/session_changes/{store,comparison,capture,control}.rs`, `server/src/api/session_changes.rs`, `packages/ui/src/components/organisms/{SessionChangesHost,SessionChangesPanel}.tsx`, and the session-changes integration in `packages/ui/src/components/pages/WorkspacePage.tsx` (imports, callback, callers and sole host). Approximately 2,550 relevant lines, plus supporting inventory, text diff, retained-session discovery, client/query, viewer and test code. Checked feature contracts in `plans/261030-1215-session-changes-panel/contracts.md`, phases 02/06/07, README, PDR and code standards.

Static review only: no build, typecheck, lint, test or browser execution; coordinator owns verification. Race failures below are source-derived interleavings, not executed reproductions. No production source or plan/task state changed. Type/test coverage and lint counts: not measured.

## Overall assessment

The stored `ComparisonArtifact` is the right direction: list and detail share immutable row identities and captured bytes, and a changed baseline ID fences an already-running scan. However, the complete publication/state machine does not yet satisfy immutable-original, cancellation, quota, retained-identity or complete-review contracts. The new successful-prepare CAS does not protect the other writers. Consolidation alone does not guarantee synchronized presence semantics.

## Critical issues — MUST FIX

### M1. Publication fencing does not cover every writer or terminal destruction

**Evidence:** `server/src/api/session_changes.rs:147-157,246-299`; `server/src/session_changes/capture.rs:133-160,165-193,226-241`.

`from_now` checks Ready/Incomplete only before awaiting capture, then replaces the baseline without checking the current record. A pending original can receive its valid receipt while from-now scans; from-now subsequently overwrites that acknowledged original. Two from-now requests can also replace each other. It clears `original_failed` at line 297, contrary to the independent failure-latch contract.

Prepare scan-failure/capacity paths unconditionally insert tombstones, so an old prepare can overwrite a successfully published from-now record. Its successful publication accepts a missing entry (`if let Some`), recreating a record after `remove_terminal_records` destroyed the terminal identity.

**Correction:** use an exact live reservation/generation at every success and failure publication, including from-now. Require that reservation still exists; terminal removal invalidates it. Recheck acknowledged originals under the final lock, preserve the original failure latch, and release only the losing candidate's accounting. **Confidence: high.**

### M2. Scan saturation strands an Initializing reservation permanently

**Evidence:** `capture.rs:66-123`; `store.rs:152-165`.

Prepare inserts Initializing before acquiring a blocking permit. If both permits are busy, it returns Busy without retiring the reservation. Later prepare calls always return Busy at lines 79-80. `build_status` reports TTL expiry through a local projected state only; it never changes the actual Initializing record. This turns transient admission pressure into a stranded identity/slot.

**Correction:** admit the operation before installing its reservation, or atomically finalize that exact reservation on admission failure. Retire expired reservations in the authoritative state without permitting a forbidden original recapture. **Confidence: high.**

### M3. Idempotent acknowledgment retry can invalidate an acknowledged original

**Evidence:** `capture.rs:278-305,334-364`; `capture.rs:69-84`.

Both activate and receipt apply the preparation TTL even after receipt made the original Ready/Incomplete. An identical receipt retry after 15 seconds sets the acknowledged original Unavailable/RegistrationExpired. Activate similarly checks TTL before its existing-receipt branch. That expiry does not set `original_failed`; a later prepare may then replace the original because protection is based on current state rather than retained acknowledgment.

**Correction:** validate exact identity and return an already-received acknowledgment idempotently without applying preparation TTL. TTL applies only to pending preparation; acknowledgment permanently prevents recapture/replacement. **Confidence: high.**

### M4. Same-baseline scans can publish backwards, and failed settled work is lost

**Evidence:** `comparison.rs:21-49,271-296`; `control.rs:403-422`; `store.rs:69-71`.

Only the two global permits are enforced; there is no one-operation-per-identity reservation. Two scans of the same baseline may run together. An older scan finishing last passes the baseline fence and becomes the higher comparison revision, replacing newer bytes/settled metadata with older results.

Settled inserts the turn ID into dedup before scanning and ignores every asynchronous error, including Busy. A retry is accepted as duplicate without retrying the missed work. `dirty_settled_hint` and `last_settled_turn_id` have no operational consumers, so the promised dirty/coalescing recovery is absent.

**Correction:** one active scan per identity, plus exact scan-generation/baseline publication checks. Preserve a bounded latest dirty turn on Busy/failure and reconcile via the specified bounded handoff or next authoritative open/manual refresh. **Confidence: high.**

### M5. Consolidation multiplies retained bytes without enforcing global storage limits

**Evidence:** `store.rs:36-46,61-68,106-139`; `comparison.rs:27-31,51-60,292-296`; `api/session_changes.rs:232-244,268-275,292-296`; supporting `inventory.rs:13-23`.

`CapturedFile` owns a `Vec<u8>`; clones copy payloads. Baseline cloning and union construction duplicate the captured content, then artifact rows retain original/current copies alongside the original inventory and full `current_revision_manifest`. From-now additionally retains another complete baseline in `active_from_now`. The current manifest has no production read consumers after this cutover.

Comparison capture/publication never reserves current/candidate storage at all. Original/from-now reservation occurs after capture and some clones. Thus the 512 MiB accounting ceiling does not bound actual retained/candidate memory; concurrent comparisons amplify pressure. From-now also bypasses the 32 retained-identity admission check.

**Correction:** remove obsolete duplicate payload stores; share immutable buffers/manifests where both owners truly need them. Enforce identity, candidate, retained-current and response admission before allocation, and release accounted ownership transactionally on replacement/removal. **Confidence: high.**

### M6. Detail still converts unknown historical/current presence into proven absence

**Evidence:** `comparison.rs:173-186,238-251,377-418`.

Unknown rows correctly carry unknown/excluded/unproven presence. But detail builds `presence: Absent` whenever the captured-file option is None. For an ignored-at-capture file later becoming eligible, `detail.file.original_presence` is Unknown while `detail.original.presence` is Absent. An unproven current omission has the same contradiction on the current side.

**Correction:** derive each `ContentSide.presence` from its stored row presence, not capture-option membership; missing bytes do not establish absence. Preserve null content/metadata for unknown sides. **Confidence: high.**

### M7. UI still silently limits review to the first 200 changed files

**Evidence:** `SessionChangesPanel.tsx:70-85,276-308`.

The panel always requests `(cursor=null, limit=200)`, ignores `nextCursor`, and labels the loaded count as the changed-file count. Backend detail can now address rows after 200, but users cannot select or discover those rows through this UI. A 201-file change silently omits file 201.

**Correction:** consume pinned pages through explicit pagination/load-more or an infinite query; use `comparison.changedFileCount` and distinguish loaded count. **Confidence: high.**

### M8. Host manufactures a session identity instead of resolving retained sessions

**Evidence:** `WorkspacePage.tsx:692-739`; supporting `binding.rs:35-69`; contracts S6.

The opener uses the semantic OMP session ID when present, otherwise substitutes the terminal ID. Those identifiers are not interchangeable. After semantic row removal, an original retained under its actual OMP session ID becomes inaccessible, and the missing view offers from-now for the fabricated identity. There is no retained-session query/selector. The selected row is also not checked against the captured terminal incarnation.

**Correction:** use authoritative retained identities for the exact terminal/incarnation, prefer a matching live semantic session, otherwise require explicit retained selection. Never substitute terminal ID for OMP session ID; verify row incarnation/current owner before adoption. **Confidence: high.**

## Warnings — SHOULD FIX

1. **Unsupported content can become false unchanged/numeric counts.** `comparison.rs:73-77` compares hashes without knowing they exist; oversize inventory entries use `sha256=""` (`inventory.rs:190-204`), so two unread files compare equal. Added binary/unsupported rows get numeric additions and no reason (`comparison.rs:195-220`), ignoring content kind and `count_logical_lines` completeness. Deleted text sets a numeric deletion count even when its line-length completeness check failed (`150-185`). Keep unsupported comparisons/counts explicitly unknown/null and propagate coverage reasons.
2. **Renderable does not enforce render/response budgets.** `comparison.rs:377-428` serializes any captured UTF-8 text and marks it renderable without the 1 MiB/20,000-line/16 KiB-line gates. `ModeOnly => true` also sends binary mode-only rows to an empty text diff. Supporting viewer trusts this flag (`ReadonlyMonacoDiffViewer.tsx:79-126`). Enforce text eligibility and combined detail/serialized-response limits before constructing content; use a metadata presentation for non-text mode-only changes. Page/detail endpoints also lack the specified byte-bounded response leases.
3. **Failures become misleading empty or permanently loading UI.** `SessionChangesPanel.tsx:118-138,141-153,237-300,315-333` ignores mutation errors and never renders query errors. Initial comparison failure leaves `!comparison` and an endless computing state; files query failure becomes an empty list/no-changes message; detail failure asks users to select a file again. The effect does not list mutation pending state as a dependency, so a retry loop is not established by this code—stuck loading is the directly supported concern. Render actionable typed error/stale-coverage states and an explicit retry.
4. **Root contract is inconsistent.** `api/session_changes.rs:100-105,325-330` hardcodes `.` for status/refresh while capture/from-now/files/detail accept other roots. `SessionChangesPanel.tsx:52-58,141-150` exposes `rootId`, but supporting client/query files omit it from file/detail requests. Preserve one authoritative root binding end-to-end or explicitly reject unsupported roots; do not create an unreachable non-default-root baseline.

## Suggestions — NICE TO HAVE

- After correctness fixes, remove dead row-store aliases and unused state rather than preserving a second convention. In particular, the full `current_revision_manifest` is obsolete if artifact rows are the authoritative payload owner; dirty-turn fields should be implemented for the actual contract or removed with the contract deliberately changed.
- Reject malformed/oversized cursors instead of treating them as offset zero, bind cursor identity/revision, and use checked offset arithmetic (`comparison.rs:316-345`).
- Add deterministic barrier-driven regressions for each publication race, saturated admission, post-TTL acknowledged retries, same-baseline scan ordering and failed settled reconciliation. Add >200-row UI coverage, unknown-presence detail parity, binary/oversize/long-line and retained-session-after-status-removal cases. Existing inspected comparison test covers only the small happy-path modified/added/deleted flow and stale revision.

## Positive observations

- List/detail use the same stored artifact rows and opaque file IDs rather than rescanning or reconstructing the list.
- Detail reads use captured bytes, preserving revision content despite later working-tree edits.
- In-flight scans reject a changed baseline ID before publication.
- Public responses explicitly use private/no-store headers; private control responses use no-store.
- One lazily mounted host exists outside responsive shell selection. Radix content-level keydown bubbling suppression allows descendant handling instead of swallowing keys in capture. Actual terminal isolation/focus behavior still requires browser qualification.

## Recommended verification by coordinator

After fixes and all writers stop: run the repository-supported Rust check/session-changes suites, UI typecheck/lint and focused query/panel/workspace tests; then real-browser >200-row, errors, retained-identity, modal Tab/Escape/xterm isolation and Monaco-boundary scenarios. These are recommendations, not exercised results.

## Unresolved questions

None needed to establish these findings. Actual OMP first-turn ordering, browser/Tauri behavior, platform filesystem guarantees and runtime resource bounds remain unverified by this static review.
