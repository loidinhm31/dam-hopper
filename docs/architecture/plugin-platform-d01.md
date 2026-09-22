# Trusted Plugin Platform — Phase D01

**Status:** Completed 2026-09-21. Targeted registry/archive/trust tests are green;
D01 is a runner-owned package registry and trust-staging boundary, not a
malicious-code sandbox or a production lifecycle/update service.

- [D00 contract candidate](../plugin-platform-d00.md)
- [D01 implementation plan](../../plans/260920-1603-plugin-platform/phase-01-package-registry.md)
- [Plugin platform plan](../../plans/260920-1603-plugin-platform/plan.md)
- [System architecture](../system-architecture.md)
- [D02 owner-account runner and supervision](./plugin-platform-d02.md)

## Scope and ownership

`server/src/plugins/` is the Rust registry library. The owner-account runner is
the only durable package/grant/binding authority. An API peer may request
management operations through the separately authorized runner namespace, but
it does not write a second registry or accept a server filesystem path, URL,
latest-version selector, or ambient `node_modules` path.

D01 implements one immutable installation path for the first G1 vertical slice.
D02 consumes immutable package references and supervises the worker; D03 adds
actor/target authorization; D05 owns update, rollback, disable, and remove
orchestration. Stage approval records an enabled installation but does not start
worker code.

The independently supplied SHA-256 proves the staged bytes match the review
request. It is not a publisher signature and does not make same-UID executable
code safe from malicious behavior. The registry is owner-private defense in
depth, not a sandbox.

## Runner state layout

`PluginRegistryLayout` accepts an injected root so tests use a temporary
filesystem. Deployment chooses the owner-account root (the plan proposes
`/var/lib/dam-hopper-plugin-runner/`; this is not hard-coded by the library).
The physical layout is:

```text
<runner-state-root>/
├── registry-v1.json
├── journal/
│   └── <transaction-id>.json
├── staging/
│   └── <stage-id>/
│       ├── package.tar.gz
│       └── review.json              # persisted StageReviewDto after finish
└── packages/
    └── <plugin-id>/<version>/<archive-sha256>/
        ├── manifest.json       # archive member
        ├── inventory.json      # runner-generated inventory projection
        ├── backend/...         # manifest-selected Node entrypoint
        └── ui/...              # optional opaque-srcdoc document
```

`stage_manifest_file` is available as a layout accessor for future split
metadata; D01 persists the review DTO in `review.json` and keeps the uploaded
archive in `package.tar.gz`.

`registry-v1.json` and journal records are strict JSON. Package roots are
addressed by plugin ID, SemVer, and the lowercase archive digest; a different
digest never overwrites an existing immutable directory. `inventory.json` is
written by controlled extraction from the validated manifest. Package state
never contains user source roots, workflow/history data, or policy data.

`ensure_layout` creates the root, `journal`, `staging`, and `packages`
directories with mode `0700` on Unix. Stage files are created with mode `0600`;
registry/journal writes use atomic replacement and mode `0600`, followed by a
parent-directory sync where implemented. `verify_path_security` walks the
hierarchy with `symlink_metadata`, rejects symlinks and world-writable paths,
and can enforce an expected Unix UID when the caller supplies one. The runner
service must still provision the root and owner identity correctly; test-root
injection does not prove deployment ownership.

The registry uses a short-lived global `state_lock` for metadata commits and
separate mutexes for active upload sessions and in-memory review DTOs. Archive
streaming and extraction happen outside the metadata lock; publishing and
registry commit reacquire it and re-check the security revision.

## Durable records and recovery

`RegistryV1Record` (`serde(deny_unknown_fields)`) contains:

| Field | Meaning |
| --- | --- |
| `version` | Must be schema version `1`. |
| `registryRevision` | Monotonic CAS revision for registry/binding reads and writes. |
| `securityRevision` | Monotonic revision for grants, admin-sensitive staging, and approval. |
| `adminConfigDigest` | Digest of the root-seeded administrator subject list. |
| `packages` | `pluginId@version#archiveSha256` → `RegisteredPackageRecord`. |
| `installations` | Installation ID → active/configured `InstallationRecord`. |

A package record stores plugin identity/version, archive digest, publisher, host
range, contract versions, capabilities, entrypoints, and install time. An
installation record stores installation ID, plugin ID, active package digest and
version, activation generation (starts at `1`), enabled intent, target
bindings, grants, and timestamps. Validation rejects unknown fields, invalid
IDs/SemVer/digests, zero revisions/generations, map-key mismatches, and
installations that reference a package absent from `packages`.

Journal phases are:

```text
RECEIVING → INSPECTED → APPROVED → EXTRACTED → REGISTERED → ACTIVATED
                                      └──────────────→ FAILED
```

D01 writes `RECEIVING` at stage start, `INSPECTED` after archive review,
`APPROVED` before installation work, `EXTRACTED` after controlled extraction,
and `REGISTERED` after the atomic registry commit. D02 owns the later
activation outcome. Every record carries transaction/stage IDs, actor,
expected/actual digest, byte count, security revision, optional installation
ID, timestamps, and an optional error.

On runner startup, crash recovery removes same-identity incomplete staging for
`RECEIVING`/`FAILED`, removes expired or malformed `INSPECTED` staging, marks
`APPROVED`/`EXTRACTED` transactions failed and removes their staging, and only
cleans leftover staging for already `REGISTERED`/`ACTIVATED` transactions. It
never invents approval or activation. Ambiguous or corrupt registry state fails
closed instead of being reconstructed from package bytes.

## Streaming stage protocol

The administrative methods are separate from public plugin calls:
`management.stage.begin`, `management.stage.chunk`,
`management.stage.finish`, and `management.approve`. The wire DTOs use
camelCase; a chunk carries one base64-encoded byte slice.

### 1. Begin

`management.stage.begin` takes:

```json
{"expectedSha256":"<64 lowercase hex>","totalBytes":12345}
```

The runner requires a current plugin-admin subject, a non-zero size no larger
than `32 MiB`, and a 64-character hexadecimal digest. It creates a UUID stage
and transaction, a private `package.tar.gz` file, and a `RECEIVING` journal
record. The response is:

```json
{
  "stageId":"<uuid>",
  "transactionId":"<uuid>",
  "maxChunkSize":524288,
  "securityRevision":1
}
```

The returned security revision is a snapshot, not approval. A later admin or
grant change invalidates approval against that stage.

### 2. Chunks

`management.stage.chunk` takes `stageId`, zero-based monotonic `sequence`, and
one `chunkBytesBase64` value. The runner/API boundary must decode and bound one
chunk before calling the registry; it must not base64-decode or queue the whole
package. The registry enforces:

- each decoded chunk ≤ `512 KiB`;
- exact next sequence (`0, 1, 2, …`);
- cumulative bytes ≤ the declared `totalBytes`;
- a 60-second idle deadline;
- append-only writes to the stage file; and
- incremental SHA-256 and received-byte counters.

A request that fails sequence, size, overflow, deadline, or actor/admin checks
has no successful append. The caller is responsible for bounded backpressure
between chunks; no full-package allocation is part of the registry contract.

### 3. Finish and review

`management.stage.finish` closes and syncs the stage file, requires exactly
`totalBytes`, and compares the in-runner digest with the independently supplied
expected digest. A mismatch removes the stage directory and journals `FAILED`.
A matching archive is streamed through package inspection without execution or
rendering. The runner persists a bounded `StageReviewDto`/`review.json` with
stage and transaction IDs, plugin/version/publisher, host range, contracts,
capabilities, entrypoints, inventory count, expanded byte count, archive
SHA-256, captured security revision, and a five-minute expiration. The journal
moves to `INSPECTED`.

### 4. Approval and installation

`management.approve` binds `stageId`, expected digest, requesting actor, and
requested security revision to the review. Approval fails when the actor is no
longer an admin, the current security revision differs, the review revision
 differs, the digest differs, or the review expired. A review token is not
bearer authorization.

The runner re-inspects and controlled-extracts the archive, reacquires
`state_lock`, rechecks the security revision, atomically publishes the digest
root, inserts package/install records, increments `registryRevision`, and
removes stage bytes. The first installation gets a UUID and generation `1`; a
same-plugin approval advances the existing installation generation. No worker
process starts in D01.

## Archive validation invariants

The stage file is a gzip-compressed tar archive. Inspection uses a bounded
reader and one streaming pass; compressed intake is capped at `32 MiB`,
expanded bytes at `64 MiB`, entries at `2,048`, paths at `1,024` bytes, and path
segments at `255` bytes. Only regular files and directories are accepted.
Symlinks, hardlinks, devices, FIFOs, sockets, sparse/unknown entries, invalid
UTF-8 paths, and malformed/trailing tar data fail closed.

### Path and entry identity

Every archive path is normalized before it enters the inventory map. The
validator rejects:

- absolute paths, empty segments, repeated separators, `.`/`..` segments;
- backslashes and URL-encoded `/` or `\\` (`%2f`, `%5c`);
- leading/trailing whitespace, NULs, colon components, and overlong names;
- duplicate normalized paths; and
- lowercase/case-fold collisions, even on case-sensitive Linux.

### Manifest and inventory closure

`manifest.json` is required, UTF-8, strict schema version `1`, and has no
unknown fields. It requires a lowercase plugin ID, valid SemVer, non-empty
publisher and host range, manifest contract `1`, Node backend runtime, and
lowercase 64-hex inventory digests. A UI entrypoint must use
`opaque-srcdoc`; a backend-only package cannot carry non-empty navigation.

For each inventory member, inspection requires an archive regular file with
exact path, byte size, `mode & 0o777`, and SHA-256. Every regular archive file
other than `manifest.json` must be declared; directories are allowed but are
not inventory files. The backend entrypoint must exist and be regular; an
optional UI entrypoint must exist, be regular, and be ≤ `5 MiB`. These checks
bind the manifest to the bytes that will be extracted, not merely to archive
headers.

The implementation hashes every regular entry while reading it and retains
manifest bytes only; a bounded preallocation avoids trusting an archive's
untrusted declared size. Controlled extraction never calls `Archive::unpack`:
it normalizes paths again, uses `create_new` files, syncs each file and the
extraction directory, writes `inventory.json`, then atomically renames the
private extraction directory into the digest path. Existing same-digest output
is idempotent; a different digest is never substituted.

Package modes are inventory-bound and currently preserve the archive's masked
`0o777` mode during extraction. Do not treat package-provided mode bits as an
independent deployment security boundary; runner-directory permissions remain
the boundary. World-writable mode sanitization, active-stage cardinality,
transaction timestamp preservation, and registry-aware recovery after an
`EXTRACTED`/registry-commit crash remain explicit hardening follow-ups from the
D01 review, rather than undocumented guarantees.

## CAS registry API

The Rust API is the runner-side source of truth. `PluginRegistry::new` creates
or validates `registry-v1.json`, ensures the layout, and runs crash recovery.
The principal operations are:

| Method | CAS/authorization behavior | Result |
| --- | --- | --- |
| `stage_begin(actor, expectedSha256, totalBytes)` | Current admin; captures `securityRevision`. | `StageBeginResult` with IDs, chunk cap, revision. |
| `stage_chunk(actor, stageId, sequence, chunk)` | Same stage actor and current admin; exact sequence/size/deadline. | Cumulative `receivedBytes`. |
| `stage_finish(actor, stageId)` | Same stage actor and current admin; exact size/digest; inspect before review. | `StageReviewDto`. |
| `approve_stage(actor, stageId, expectedSha256, requestedSecurityRevision, bindings, grants)` | Admin + review digest + current security revision + unexpired review. | Durable `InstallationRecord`. |
| `read_state()` | Validates strict registry record before returning. | `RegistryV1Record`. |
| `list_plugins()` | Read-only snapshot. | Metadata list + `registryRevision`. |
| `get_installation(installationId)` | Read-only exact ID lookup. | Optional `InstallationRecord`. |
| `read_ui_bytes(installationId, expectedDigest)` | Enabled installation and exact active digest; UI size cap. | Base64 bytes + SHA-256 + size. |
| `update_grants(actor, installationId, expectedSecurityRevision, grants)` | Admin and security-revision CAS under `state_lock`; increments security + registry revisions. | Updated installation. |
| `update_bindings(actor, installationId, expectedRegistryRevision, bindings)` | Admin and registry-revision CAS under `state_lock`; increments registry revision. | Updated installation. |

`write_state` validates before atomic replacement and syncs the registry parent.
A stale revision returns `FORBIDDEN`; it never merges caller data or silently
retries against a newer security state. `PluginError` exposes structured
`UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`, `DEADLINE_EXCEEDED`,
The registry read methods alone are not the public façade. D02 supplies the
owner runner; D03 now adds the public activation-generation, actor, target,
grant, and API-epoch fences before exposing reads or invocation.

## Evidence and boundaries

Targeted evidence on 2026-09-21:

```text
cargo test --test plugin_package_archive \\
  && cargo test --test plugin_package_registry \\
  && cargo test --test plugin_contract_fixtures
```

The three integration binaries passed **24/24** tests (`5 + 5 + 14`), with no
reported compiler warnings or errors. Archive tests cover path normalization,
case collisions, links, undeclared files, and inventory digest mismatch.
Registry tests cover stream lifecycle, admin/revision rejection, chunk ordering
and overflow, grant/binding CAS, and restart cleanup of incomplete staging.

D01 does not claim a network fetcher, publisher-signature verifier, worker
supervisor, public REST route, UI renderer, lifecycle rollback, or Linux
production deployment. The owner UID/state root, artifact handoff channel,
Node distribution, and deployment policy remain D06/operator inputs.

## Unresolved questions

- Which owner UID/state root and service provisioning profile will D06 approve?
- Which operator-selected artifact transfer channel will supply the independently
  entered digest without adding runtime auto-fetch?
- Should package extraction sanitize world-writable mode bits before D05 lifecycle
  code relies on package roots, or should the package validator reject them?
