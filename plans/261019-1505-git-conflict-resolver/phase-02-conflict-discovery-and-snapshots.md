# Phase 02 — Conflict discovery and snapshots

## Context links

- [Plan](./plan.md), [Phase 01](./phase-01-feasibility-and-contract-gates.md), [design contract](./design-contract.md#conflictsnapshot-invariants).
- [Acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md), [Git research](./research/git-semantics.md).

## Overview

- Date: 2026-10-19. Priority: P2.
- Status: Complete with accepted deferrals; safety gates remain open (2026-10-19).
- Implementation: Complete with accepted deferrals. Review: Complete with user-accepted deferrals (cycle 3 changes requested with 6 gate warnings deferred). Progress: 100% (implementation); qualification gates remain open. Effort: unestimated.
- Owner: backend discovery owner; integration owner controls shared Rust DTO/API edits.
- Entry: Phase 01 passed with frozen single coordinated UI/server schema, byte/classification policy, supported conversions, measured web/Linux limits and repository identity rules; Windows-native client qualification remains separately Pending/nonblocking.
- Handoff: bounded inventory and coherent on-demand detail usable by mutation and retained draft owners.
- Go/no-go: no lossy/ambiguous content or incomplete precondition reaches writable clients; failed coherence is a retryable read outcome, never an apparently valid snapshot.

## Key insights

- Current get_conflicts eagerly returns optional stage strings and lossy UTF-8; absent stages, binary blobs and read errors collapse into omitted content.
- Existing handlers already resolve registered project/worktree and VCS root; reuse rather than create a parallel root authority.
- Summary must stay cheap with many conflicts; source/base/result loading belongs to requested detail only.
- Paths can contain non-UTF-8 or separators unsuitable for line parsing; safe display names are not mutation identities.
- Git metadata and effective attributes can change while a file is read; immutable DTOs alone do not establish coherence.

## Requirements

### Functional

- Return bounded deterministic inventory with target revision, entries and explicit truncation/paging semantics; never silently lose unsupported entries.
- Load requested conflict detail with stages 1/2/3, worktree descriptor, roles, limits, conversion policy and precondition token.
- Distinguish missing, zero-byte text, binary, invalid encoding, read error and unsupported types without replacement characters.
- Preserve raw stage path identities, OIDs, modes, byte sizes and missing stage descriptors.
- Recognize regular, absent, symlink, directory, gitlink and unreadable worktree states.
- Bind discovery to actual registered worktree and explicit nested root; aggregate write scope is invalid.

### Nonfunctional

- Enforce byte/line/long-line/region/response bounds before allocation/materialization where applicable.
- Do not execute unknown filters or infer readability from a failed read.
- Use opaque OID strings with qualified hash-format support, never a hardcoded 40-character invariant.
- Return safe labels for unsupported paths; no empty-path default or guessed replacement path.

## Architecture

Protected route -> existing registered target resolution -> explicit VCS root -> bounded unmerged-index summary.
Detail resolves server-issued conflictId against that actual scope, reads descriptors and qualified bytes on demand, then validates before/after fingerprints.
The precondition covers repository/worktree/index/root, HEAD/operation, stage OID/mode/path, worktree content/type and effective conversion policy.
Relevant attributes/config fingerprint includes decisions that change staging/materialization, not just file mtime.
A changed-during-read detail is rejected; snapshotVersion is a state precondition, not authorization or external-writer isolation.
During phases 02–05 the changed API is not independently releasable; coordinate every UI/server consumer without retaining the old permissive DTO, legacy write fallback or compatibility shim. The supported-server safety matrix remains mandatory regardless of deferred Windows-native client proof.

## Related code files

- Modify: `server/src/git/diff.rs` to retire eager get_conflicts/read_blob_utf8 implementation and delegate new contract at coordinated cutover.
- Modify: `server/src/git/types.rs`, `server/src/git/mod.rs` for one exported DTO family.
- Modify: `server/src/api/git_diff.rs`, `server/src/api/router.rs` for summary/detail routes and request limits.
- Reuse/modify only if required: `server/src/git/vcs_roots.rs`, `server/src/git/repository.rs` for real root/hash identity.
- Modify: `server/src/git/tests.rs`, `server/src/api/tests.rs` with observable real-repository cases.
- Create (proposed): `server/src/git/conflict.rs` for bounded inventory/snapshot logic if extraction keeps diff.rs focused.
- Create (proposed): child snake_case modules under `server/src/git/conflict/` only if size/responsibility requires; assign concrete ownership before extraction.
- Delete: obsolete optional-string conflict DTO/read helpers after all exports/callers migrate; do not delete unrelated diff code.

## Implementation steps

1. Re-read affected declarations and references at implementation time; locate all list/detail DTO consumers and test fixtures.
   Record ownership of types.rs/mod.rs/API files; do not independently publish incompatible wire changes.
2. Resolve registered project, worktreePath and explicit root through existing handlers.
   Capture canonical actual worktree/index/root identity; do not trust a client-provided canonical string as authorization.
3. Build summary from unmerged index entries without reading every blob or worktree file.
   Group only by truthful conflict identity; preserve separate stage paths for rename ambiguity and annotate unsupported cases.
   Apply measured count/response bounds and deterministic paging or explicit continuation, keeping unsupported entries reachable.
4. Define stage descriptors with presence, opaque OID, mode/type, path identity and size.
   Treat absent stage and present zero-length blob differently; label stage roles using available operation evidence, not unconditional ours/theirs.
5. Resolve conflictId to raw server-side identity and safely escaped display label.
   Include non-UTF-8 paths in inventory where the platform supports them; disable mutation when the supported publication path cannot represent them safely.
6. Classify worktree type without following unsafe symlinks or converting read failures into missing.
   Read qualified text bytes only after checking per-stage and total size; preserve BOM/EOL/final-newline metadata.
   Binary and invalid encoding remain separate classifications with explicit allowed actions/handoff.
7. Query relevant attributes and effective conversion/config policy without running unknown filters.
   Record a stable fingerprint of policy inputs; unknown custom conversions yield unsupported before any writable text detail is offered.
8. Capture before-state fingerprint; read stage descriptors/content and actual worktree bytes/type; capture after-state fingerprint.
   Reject changed-during-read with refresh-required reason rather than returning a mixture of old stages and new result.
   Hash relevant bytes/content, not mtime alone, and include operation/HEAD changes in the precondition.
9. Expose bounded summary and on-demand detail through protected routes with consistent error/status mapping.
   Enforce request/body/response limits at route and content boundaries; do not wait until JSON decoding to bound all blob materialization.
10. Add real-repository classification, root, coherence and bounds cases.
    Use controlled change-between-read boundaries for deterministic race evidence rather than flaky timing assumptions.
    Ensure unsupported entries remain present and no inferred text path becomes a mutating target.
11. Hand examples of all descriptors, token inputs and negative outcomes to Phase 03/05 owners.
    Preserve the single source of wire truth; legacy write payloads must fail closed, not select a fallback/shim. Release waits for the coordinated client/server migration.

## Todo list

- [x] Replace eager summary and define deterministic bounds/paging.
- [x] Preserve raw paths, modes, OIDs and all missing/content/type distinctions.
- [x] Implement coherent detail and operation/attribute/content fingerprint.
- [x] Enforce scope, response and materialization limits.
- [x] Add real-Git negative/race fixtures and DTO examples; require coordinated consumer cutover with legacy writes rejected, no fallback/shim.

## Success criteria

- AC1/AC9: linked worktrees and nested roots with identical relative filenames yield distinct correct scope; a missing/aggregate root cannot become writable detail.
- AC6/AC7: missing stage, empty blob, binary, invalid UTF-8, symlink/gitlink and read error are observably different; no lossy text is emitted.
- AC8: changing worktree bytes, attributes, stage mode/OID or operation mid-read prevents a successful coherent detail response.
- AC11/CUT4: many conflicts do not cause all blobs to be read; an oversized detail is bounded before materialization and remains visible in summary with handoff.
- Raw path oracle: NUL-safe Git index listing and descriptors identify the same path/stage tuples; escaped labels cannot select another target.
- Actual future smoke: create two registered linked worktrees plus a nested repo, each with same-named conflicts; query summary, then one empty-source/partial-worktree detail and one binary/unsupported detail.
- Compare `git ls-files -u -z`, raw worktree bytes and response descriptor fields; change attributes during controlled detail read and require refresh instead of mixed content.
- Gate fails if absent and empty collapse, any unknown read is presented as safe text, or detail fingerprint omits a mutation-relevant state input.

## Risk assessment

Snapshot ABA/external filesystem races cannot be fully excluded; describe token limitations and revalidate immediately before mutation in Phase 03.
Overaggressive grouping can hide complex renames; preserve raw descriptors and unsupported visibility instead.
Inventory paging must not make operation completion appear safe while unseen conflicts remain.

## Security considerations

Keep existing authentication and registered-target resolution on every route; tokens are not bearer authorization.
Never follow unsafe ancestors or log conflict content/raw sensitive paths unnecessarily.
Bound input identifiers and output content; safe UI labels must be escaped, not interpreted as markup or shell arguments.

## Next steps

Pass frozen summary/detail fixtures and precondition composition to [Phase 03](./phase-03-safe-resolution-and-staging.md).
Pass owner/root identity and read outcomes to Phase 05; no writable UI until mutation and client cutover agree.

## Deferred items to subsequent phases

User approved proceeding from cycle-3 code review (`plans/reports/code-reviewer-261019-2332-phase-02-conflict-discovery-snapshots-cycle3.md`) with the following items deferred to Phase 03 and Phase 05:

- **W1 (High, AC6/AC7) — Read error status mapping (Deferred to Phase 03):** Handle final component, `File::open`, and blob errors per-descriptor rather than collapsing to HTTP 5xx/4xx. Worktree files with mode 000 should yield `WorktreeKind::Unreadable`; dangling symlinks or escaping symlinks should yield `WorktreeKind::Symlink`/`Unsupported` without failing in `verify_safe_worktree_path`; blob read failures should produce `StageKind::ReadError`; backslash-prefixed paths should be handled consistently (reject backslash only on Windows or mark Unsupported in summary).
- **W2 (High, AC8) — Attribute and content coherence (Deferred to Phase 03):** Include effective attributes and config in the before/after `StateFingerprint` comparison window (detect mid-read `.gitattributes` or config modifications) for both the discovery/detail snapshot window and mutation revalidation; re-hash worktree bytes (or re-stat + hash) across the read window to detect same-size same-mtime edits on coarse-mtime filesystems; hash symlink targets.
- **W3 (High, gate) — Conversion policy gating (Deferred to Phase 03):** Expand conversion policy inspection beyond `eol`/`working-tree-encoding`/`ident`/`filter` to cover `text`, `crlf`, `binary`, `diff`, `merge`, `core.autocrlf`, `core.eol`, `core.safecrlf`. Explicitly gate `ident=true` ($Id$) and `working-tree-encoding` to return unsupported before mutation.
- **W4 (Med-High) — Operation roles and limits in DTO (Deferred to Phase 03 / Phase 05):** Enhance the conflict snapshot DTO to explicitly include `operation`, `targetRevision`, contextual `roles` (ours/theirs derived from operation context rather than unconditional labels), and `limits` fields required for mutation and retained draft lifecycle.
- **W6 (Med) — Offset pagination cursor stability (Deferred to Phase 03 / Phase 05):** Server cursor contract must bind to the last raw path/hash of the unmerged set rather than HEAD + offset, with explicit stale-cursor rejection/restart semantics, ensuring resolving conflicts mid-operation does not cause subsequent entries to be skipped in client pagination.
- **W7 (Med) — Legacy code retirement (Deferred to Phase 03 / Phase 05 / Phase 08):** Retire legacy helpers `diff.rs::get_conflicts`, `read_blob_utf8`, `resolve_conflict`, Rust `ConflictFile` (in `types.rs`/`mod.rs`), UI `ConflictFile` (in `client.ts`), and legacy tests as part of the coordinated clean cutover once mutation callers migrate.
- **W12 (Low) — UI query and pane binding (Deferred to Phase 05):** Pass explicit `root` parameter to conflict queries, handle multi-page inventory lookup in editor, bind result pane to conflict drafts rather than `useGitFileDiff`, and replace fail-closed `useGitResolve` with Phase 03 preconditioned apply service.

## Unresolved questions

Phase 02 is administratively closed with accepted deferred findings recorded for resolution in downstream phases; coherent-snapshot (AC8), conversion gating, and inventory-completeness gates remain open. Writable integration and release qualification remain blocked pending their remediation in Phases 03 and 05.
