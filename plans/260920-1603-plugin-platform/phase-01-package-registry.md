# Phase D01 — Runner-owned package registry and trust staging

## Context Links

- [Plan](plan.md)
- [D00 contracts](phase-00-contracts-and-feasibility.md)
- [Shared package/lifecycle contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md#package-ui-isolation-and-activation)
- [Repository evidence](reports/repository-analysis.md)
- Existing patterns: [`archive.rs`](../../server/src/linux_release/archive.rs), [`archive_extract.rs`](../../server/src/linux_release/archive_extract.rs), [`durable_fs.rs`](../../server/src/linux_release/durable_fs.rs), [`state_record.rs`](../../server/src/linux_release/state_record.rs)

## Overview

- **Date:** 2026-09-20
- **Priority:** P1
- **Plan status:** DONE (2026-09-21)
- **Implementation status:** DONE (2026-09-21)
- **Review status:** DONE (2026-09-21; Cycle 2 review 9.0/10)
- **Progress:** 100% (11/11 implementation steps; 6/6 todo items)
- **Completion timestamp:** 2026-09-21
- **Validation:** Targeted archive, registry, and contract-fixture integration tests passed 24/24 with no failures. See the [test report](../reports/test-report-260921-1150-plugin-package-registry-tests.md), [reviewer-fix QA](../reports/qa-260921-1215-phase-d01-reviewer-fixes.md), and [Cycle 2 review](../reports/code-review-260921-1216-phase-d01-cycle2-verification.md).
- **Dependency:** G0. Implement in parallel with D02 and evcrate E01/E02.
- **Gate contribution:** D01 accepts E02's early immutable real package candidate and makes it available to D02/D03 for G1. It does not wait for E04 publication polish.
- **Effort:** Unestimated.

Implement the registry library inside the owner-account runner boundary. It safely streams, verifies, reviews, approves, extracts and durably records immutable packages. The API never writes a competing registry. D01 supports one initial approved installation for G1; D05 adds production update/rollback/disable/remove orchestration.

## Key Insights

- Existing release archive code is reusable as a pattern, not as the plugin contract: release bounds are far larger and role-specific, while plugin packages require case-collision, link, executable-entrypoint and self-contained-UI checks.
- Runner UID must own registry state because it executes packages and is the durable grant/source authority. API cache loss cannot change authorization.
- A 32 MiB package does not fit one 16 MiB protocol frame. The API-to-runner admin stream must use bounded chunks and no full-body queue allocation.
- Expected SHA-256 comes from an independent administrator channel. A matching digest still does not authenticate publisher or make executable code safe.
- Initial G1 needs a real E02 package candidate. Waiting for E04 would make the vertical slice circular and too late.

## Requirements

### Safe intake and trust

1. Runner accepts stage begin/chunk/finish only from the authenticated API peer and an actor currently present in the root-seeded plugin-admin subject list.
2. Stream at most 32 MiB compressed in fixed <=512 KiB decoded chunks to a private transaction file; enforce sequence, declared length, request deadline and one open upload per stage. Rehash inside runner.
3. Require exact independently supplied lowercase SHA-256 before inspection. Return publisher, plugin/version, host/SDK ranges, capabilities, backend/UI entries, inventory totals and requested bindings for explicit review.
4. Separate `stage` from `approve`. Approval binds stage digest + actor + current admin/security revision; a stage token is not bearer authorization and expires.
5. No network fetch/latest, lifecycle scripts, dependency resolution, arbitrary server path, registry URL or ambient project `node_modules`.

### Archive/package validation

6. Enforce <=64 MiB expanded, <=2,048 entries, <=5 MiB UI document, bounded per-entry/path/name lengths and an exact manifest inventory.
7. Reject absolute, empty, parent, dot-segment, backslash/encoded-separator, non-UTF-8 and platform-ambiguous paths; reject duplicate and Unicode/case-fold-colliding names.
8. Reject symlinks, hardlinks, sparse/device/FIFO/socket/unknown entries, duplicate tar headers, trailing undeclared bytes, gzip expansion overflow and inventory size/digest/mode mismatch.
9. Permit only regular files/directories. Backend/UI entrypoints must be inventory members beneath the extracted immutable root. Worker is launched as fixed Node argv; package executable bits grant no alternate entrypoint.
10. Validate manifest compatibility. When UI is present, validate its self-contained/CSP-input shape; when absent, require no UI entrypoint/navigation and allow only the backend-only candidate form frozen at G0. Do not execute or render staged bytes.
11. Extract into runner-owned private staging with no-follow descriptor-relative creation, sync files/directories, then rename to immutable `packages/<pluginId>/<version>/<archiveSha256>/`. Existing same digest must match exactly; never overwrite.

### Durable authority and G1 installation

12. Strict `registry-v1.json` records monotonic registry/security revisions, root-seeded admin configuration digest, packages, installation IDs, active package digest/generation, enabled intent, bindings and grants. Unknown fields or invariant mismatch fail closed.
13. Initial-install transaction journal records `receiving → inspected → approved → extracted → registered → activated|failed`. Recovery removes only same-identity incomplete staging; it never guesses approval or activation.
14. Package bytes and registry are runner-owned. API obtains `plugin.list` snapshots tagged with revisions and may cache them only in memory.
15. Grant/source records reference exact configured target identity and the E00-qualified evcrate binding. Package state never contains or deletes history/policy/evaluation data.
16. Accept E02's early candidate version/digest, verify the pinned G0 contract versions, approve through the same trust flow, and create the real installation ID used by G1.
17. Preserve package candidate after G1 for evidence, but do not label it a production E04 artifact or platform release.

## Architecture

Runner state layout (proposed fixed default, injectable under a test root):

```text
/var/lib/dam-hopper-plugin-runner/
  registry-v1.json                 # strict atomic authority
  journal/<transaction-id>.json    # crash-recovery intent
  staging/<stage-id>/package.tar.gz
  packages/<plugin>/<version>/<sha256>/
    manifest.json
    inventory.json
    backend/worker.cjs              # manifest-configured backend entrypoint
    ui/index.html                   # optional manifest-configured UI; absent for backend-only G1 candidate
    contracts/...                  # manifest-inventoried domain schema/fixture assets
```

`PluginRegistry` owns one global state mutex for short metadata commits plus one lifecycle mutex per installation. It releases locks before streaming archive bytes or performing D02 handshakes. Security revision updates are compare-and-swap transactions; no async operation can commit against an older revision.

The registry uses generic durable write/sync primitives but has separate schema/state. Host release rollback and plugin package rollback never mutate each other's authority.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/server/src/plugins/package.rs` — bounded archive/hash/inventory validation and extraction.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/registry.rs` — sole durable registry API and revision snapshots.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/registry_state.rs` — strict v1 package/installation/grant/binding records and invariants.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/registry_journal.rs` — durable stage/install transaction and recovery classification.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/trust.rs` — expected-digest review/approval tokens bound to admin/security revision.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_package_registry.rs` — archive adversaries, durability, concurrency and early real-candidate contract.

### Modify

- `/home/loidinh/WS/dam-hopper/server/src/plugins/mod.rs` — export registry/package services.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/contract.rs` — consume G0 manifest/admin runner DTOs without renaming them.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/durable_fs.rs` — only if a generic primitive is missing; keep release policy out of plugin state.
- `/home/loidinh/WS/dam-hopper/server/Cargo.toml` — add only archive/normalization dependencies not already present.

### Delete

- None.

## Implementation Steps

1. Define runner state layout and strict registry/journal records under an injected `PluginRegistryLayout`; verify owner, mode, type and no-link ancestry before every open.
2. Implement staged upload sessions with monotonic chunk sequence, 512 KiB decoded cap, running length/hash, idle deadline and cleanup bound. Never base64-decode an entire package at once.
3. Parse the manifest under G0 schema and preflight declared counts/sizes/compatibility before reading all entries.
4. Inspect tar headers in one streaming pass; normalize paths, track exact and case-fold keys, reject links/specials/duplicates, hash regular content and enforce aggregate expansion before writing extraction output.
5. Perform a second controlled extraction or spool verified entry bytes into descriptor-relative files; never use `Archive::unpack`. Sync and atomically publish the digest directory.
6. Return an immutable review DTO. On approve, recheck admin subject, expected digest, stage identity and current security revision; then create an installation ID and activation generation without starting code.
7. Persist registry and journal transitions with file + parent sync. Recovery trusts durable phase and object identities only; ambiguous state remains unavailable for admin repair.
8. Implement revision-tagged list/read queries for D02/D03 and compare-and-swap grant/binding updates. Runner remains the only writer.
9. Import E02's early real candidate through the same stream/review flow. Verify package closure does not depend on sibling checkout, ambient `node_modules`, or stable E04 publication.
10. Hand the immutable installation/package reference to D02 `plugin.activate`; record activation result only after the runner worker handshake succeeds.
11. Keep all user source roots outside cleanup and uninstall path sets. Capture pre/post source metadata in future G1/G4 scenarios.

## Todo List

- [x] Runner-owned layout and strict state/journal invariants implemented.
- [x] Streaming intake and adversarial archive rejection implemented.
- [x] Independent digest review/approval and admin revision binding implemented.
- [x] Initial installation commit and crash recovery implemented.
- [x] Revision-tagged read façade and grant/binding CAS implemented.
- [x] Early E02 real package candidate staged for G1 without E04 dependency.

## Success Criteria

- Future, proposed test: `cargo test --manifest-path server/Cargo.toml --test plugin_package_registry` passes traversal/link/collision/bomb/duplicate/digest/mode/crash/revision races.
- A 32 MiB boundary package streams without one package-sized API/runner allocation; 32 MiB + 1 byte and 64 MiB expanded + 1 byte fail before publication.
- Stage cannot approve after admin/security revision changes. Wrong API peer, non-admin actor, expired stage, altered bytes and unknown capability fail closed.
- Replaying identical approved digest is idempotent; same plugin/version with different digest remains a separately reviewed immutable candidate, never overwrite.
- E02 candidate installs into a real immutable directory and exposes one installation ID to D02/D03. This is G1 input, not E04/G3 completion.
- Content/owner/mode/size/mtime inventory of configured advisor sources is unchanged by stage, install failure and cleanup.

## Risk Assessment

- Unicode/case behavior differs across filesystems. Freeze the portable collision rule at G0 and reject ambiguous packages even on case-sensitive Linux.
- Crash between extraction and registry commit can orphan bytes. Journal identity plus reference-safe cleanup avoids exposing or deleting uncertain state.
- Shared release-manager helpers can couple schemas accidentally. Reuse only generic durable primitives; keep registry authority separate.
- API buffering can negate runner streaming. D05 must stream request body to bounded stage chunks with backpressure.

## Security Considerations

- Registry/state/staging are owner-private and no-follow. Same-UID trusted worker code is outside the malicious-code guarantee; service hardening is defense in depth, not a sandbox claim.
- Expected SHA-256 is independently entered and verified twice; it proves bytes only. Do not imply publisher signatures.
- Admin/grant changes use current security revision and are never restored from package rollback.
- Never chmod/chown approved sources, copy them into package state, or place source paths in user-facing errors/logs.

## Next Steps

1. D02 consumes `PluginRegistry` snapshots and immutable package refs for worker supervision.
2. D03 exposes only authorized revision-tagged reads/invocations; no writable API registry.
3. G1 uses E02's early package candidate. D05 later extends the same journal/state to full update/rollback/disable/remove with E04.

## Unresolved Questions

- Concrete owner UID/state root are deployment inputs for D06; tests use injected roots and synthetic numeric IDs.
- Artifact transfer channel is operator-selected, but runtime performs no auto-fetch. The expected digest must remain independently sourced.
