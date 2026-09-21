# Trusted Plugin Platform — Phase D00

**Status:** Candidate ready for G0 joint pin (2026-09-20). This document records
contracts and feasibility evidence; it does not claim that the runtime loader,
registry, runner service, or production plugin routes are shipped.

- [Implementation plan](../plans/260920-1603-plugin-platform/plan.md)
- [Phase D00 record](../plans/260920-1603-plugin-platform/phase-00-contracts-and-feasibility.md)
- [System architecture](./system-architecture.md)
- [Code standards](./code-standards.md)

## Scope and boundary

Phase D00 freezes the cross-repository contract for a trusted plugin platform.
The TypeScript package is dependency-light and domain-agnostic. Rust mirrors the
wire DTOs and framing rules in `server/src/plugins`. Later phases own the
installation registry, worker supervision, API integration, browser navigation,
and Linux qualification.

- [Phase D01 registry and trust staging](./architecture/plugin-platform-d01.md)

A trusted backend plugin is **not** advertised as a malicious-code sandbox. The
runner is owner-provisioned and same-identity controlled; authorization,
resource budgets, package immutability, and browser isolation remain explicit
platform boundaries. No arbitrary plugin filesystem path, plugin listener,
implicit administrator privilege, or stable public release is part of D00.

## Candidate artifact map

| Candidate | Location | Contract role |
| --- | --- | --- |
| Generic SDK package | `packages/plugin-sdk/` and `packages/plugin-sdk/dam-hopper-plugin-sdk-0.1.0.tgz` | TypeScript validators, DTOs, framing, worker cancellation, and bridge types |
| Manifest schema | `packages/plugin-sdk/schemas/manifest-v1.schema.json` | Package identity, compatibility, capabilities, entrypoints, and inventory |
| Runner schema | `packages/plugin-sdk/schemas/runner-protocol-v1.schema.json` | API/runner requests, results, admin names, and worker notifications |
| Worker schema | `packages/plugin-sdk/schemas/worker-sdk-v1.schema.json` | Worker-facing operation and cancellation contract |
| UI schema | `packages/plugin-sdk/schemas/ui-bridge-v1.schema.json` | Opaque iframe bridge envelopes |
| Fixtures | `packages/plugin-sdk/fixtures/{positive,negative,opaque-ui}/` | Cross-language acceptance and rejection examples |
| Opaque fixture builder | `packages/plugin-sdk/scripts/build-opaque-fixture.mjs` | Self-contained UI document and integrity metadata |
| Rust mirror | `server/src/plugins/{contract,error,framing,manifest}.rs` | Serde DTOs, errors, budgets, and frame decoder |
| Contract tests | `packages/plugin-sdk/src/{contracts,cancellation-feasibility}.test.ts` and `server/tests/plugin_contract_fixtures.rs` | TypeScript/Rust parity and feasibility checks |
| Browser proof | `packages/ui/browser-tests/plugin-isolation.browser.tsx` | Opaque origin, CSP, port acknowledgement, and generation checks |

The package version is `@dam-hopper/plugin-sdk` `0.1.0`; contract constants are
currently `runnerProtocol` `1.0.0`, `workerSdk` `1.0.0`, and `uiBridge` `1.0.0`.
The package tarball, schemas, fixtures, and source are candidate inputs to G0.
The SDK SHA-256 and the four joint contract digests are deliberately pinned at
G0, not inferred from this document.

## Manifest-v1

A manifest identifies one immutable package and its paired backend/UI
installation generation. Its required fields are:

- `manifestVersion: 1`, lowercase plugin `id`, SemVer `version`, `publisher`,
  and `hostVersionRange`;
- `contracts`: `runnerProtocol`, `workerSdk`, `uiBridge`, `manifest: 1`, and
  `dataApi` versions;
- `capabilities`: an explicit list; the host capability policy must reject
  unsupported values, and unknown manifest fields fail closed;
- `entrypoints.backend`: Node runtime, runtime range, and package-relative
  `entry` path;
- optional `entrypoints.ui`: package-relative `entry` with
  `mode: "opaque-srcdoc"`;
- optional `navigation` items (`id`, `title`, `route`, optional `icon`); and
- `inventory`: every packaged path, byte `size`, lowercase 64-hex `sha256`, and
  numeric file `mode`.

Backend-only packages without navigation are valid. A package that advertises
UI must provide the final self-contained UI document and its inventory entry.
The SDK/Rust manifest validators check identity/version/hash shapes, unknown
fields, and required entrypoint/inventory fields. The package validation stage
must additionally enforce package-relative paths, duplicate-entry rejection, and
the UI ceiling before activation.

## Runner framing and JSON-RPC

Every runner message uses this byte layout:

```text
+----------------------+------------------------------+
| 4-byte unsigned BE N | N bytes UTF-8 JSON-RPC 2.0   |
+----------------------+------------------------------+
```

`N` is checked before body allocation. The payload ceiling is 16 MiB; aggregate
buffered frames are capped at 64 MiB. Control messages have a 64 KiB budget.
The Rust `FrameDecoder` and TypeScript `FrameDecoder` reject oversized frames,
invalid UTF-8, malformed JSON, and invalid JSON-RPC shapes without accepting a
partial message as complete. The control ceiling is a caller-visible contract
for handshake, health, cancellation, and lifecycle messages.

The D00 JSON-RPC profile requires:
- request `method` plus object `params` when present; method-specific schemas
  reject fields or shapes outside the method contract;
- `jsonrpc: "2.0"` and string request IDs;
- one response (`result` or `error`) for each request, never both;
- notifications without an ID; and
- no JSON-RPC batch arrays and no numeric IDs.

### Runner method namespaces

Public calls are exactly:

```text
runner.hello
plugin.list
plugin.readUi
plugin.activate
plugin.deactivate
context.open
context.close
plugin.invoke
request.cancel
```

`plugin.list` returns metadata only. `plugin.readUi` requires the exact
installation ID, digest, activation generation, actor/target visibility, and
an approved UI document; it returns bounded raw bytes plus a digest. It is not
an arbitrary path reader, and the iframe cannot call it directly.

Administrative calls are separately authorized:

```text
management.stage.begin
management.stage.chunk
management.stage.finish
management.approve
management.rollback
management.disable
management.remove
management.grants.replace
management.bindings.replace
```

Worker lifecycle notifications are `worker.health` and `worker.shutdown`.
Worker stdout is protocol-only; logs cannot corrupt the framed stream.
Compatibility rejects unsupported contract major/minor versions before
activation or invocation.

## Opaque UI bridge

The bridge version is `1.0.0`. Each envelope carries a bridge version,
`frameSession`, and `activationGeneration` where applicable. IDs, nonce values,
operation names, and payloads are validated before dispatch; framed transport
and resource ceilings bound their size.

| Envelope | Direction / purpose |
| --- | --- |
| `host.bootstrap` | Host sends plugin ID, generation, nonce, and allowed capabilities |
| `frame.ready` | Opaque frame announces readiness and its nonce |
| `frame.portAck` | Frame acknowledges the one-use transferred `MessagePort` |
| `request` | Host/frame operation request over the acknowledged port |
| `cancel` | Cancel one request in the current frame session |
| `response` | Success or structured plugin error for one request |
| `context.revoked` | Host revokes a context or generation |
| `availability.changed` | Host reports an availability/generation change |

The browser host injects restrictive CSP (`default-src 'none'`, no network
connection, no object/base URL/form action) into approved fixture bytes, mounts
them as `srcdoc` in `sandbox="allow-scripts"`, and does not grant
`allow-same-origin`. The resulting origin is opaque (`null`), the parent cannot
read `contentDocument`, and the frame receives no host credentials, filesystem
API, arbitrary transport, or network path. A `WindowProxy` and nonce are matched
before the transferred port is accepted; data is withheld until `frame.portAck`.

Revocation closes the port and invalidates the activation generation. Reload or
rebind creates a new `frameSession` and nonce. A stale generation, wrong source,
wrong nonce, repeated acknowledgement, or unbounded envelope is rejected.

## Worker cancellation and escalation

`WorkerCancellationTracker` uses request ID plus context ID as the operation
identity. Its observable state machine is:

```text
register(request, context)
        |
        v
     active --cancel matching--> cancelled --settle--> settled
        |                              |
        +------------settle------------+

cancel unknown context/request -> unknown
cancel cancelled or settled request -> alreadySettled
```

A matching cancel marks the token immediately and invokes registered listeners;
cooperative work checks `isCancelled` or `throwIfCancelled()` at bounded
checkpoints. The original invocation settles once, with `CANCELLED` when the
worker observes the token. Repeated cancellation is idempotent from the
caller’s perspective. Settled request IDs are retained in a bounded history so
late cancellation cannot resurrect work.

Control parsing and cancellation acknowledgement remain available while the
worker is processing. If a worker ignores cancellation or exceeds its deadline,
the owner supervisor escalates to process termination, revokes all contexts and
activation state, and reports `WORKER_FAILED` or `CONTEXT_REVOKED`; this is a
failure boundary, not a second successful settlement. Candidate timing targets
are cancellation acknowledgement at most 250 ms on the LAN and cooperative
settlement at most 1 s.

## Identity, authorization, and errors

DamHopper derives the actor from `AuthenticatedActor.subject`, resolves the
configured project/worktree through the existing server resolver, then checks
actor, installation, target, operation, grant revision, activation generation,
and API connection epoch at each boundary. The grant key is:

```text
(actorSubject, installationId, configuredProjectTarget,
 allowedOperations, allowCurrentAccountPolicy)
```

The runner registry is the sole durable authority for installation, source,
grant, binding, activation-generation, and rollback state. Administrator
subjects are root-seeded out of band; the default allowlist is empty and deny.
Login, registration, and `--no-auth` never confer administration.

The structured error code set is:

```text
UNAUTHORIZED FORBIDDEN INCOMPATIBLE RUNNER_UNAVAILABLE
RUNTIME_UNAVAILABLE SOURCE_NOT_CONFIGURED SOURCE_MISSING
SOURCE_PERMISSION_DENIED INVALID_INPUT OVERLOADED DEADLINE_EXCEEDED
CANCELLED WORKER_FAILED CONTEXT_REVOKED SNAPSHOT_EXPIRED
DETAIL_CHANGED_OR_MISSING
```

## Candidate resource budgets

| Resource | Candidate bound |
| --- | ---: |
| Runner payload / control frame | 16 MiB / 64 KiB |
| Package compressed / expanded / entries | 32 MiB / 64 MiB / 2,048 |
| UI document | 5 MiB |
| Context operations / worker operations / queue | 4 / 16 / 32 |
| Contexts per worker / idle TTL | 16 / 15 min |
| Snapshots per context / aggregate / TTL | 2 / 128 MiB / 5 min |
| Active scans / scan I/O / scan deadline | 1 / 256 MiB / 30 s |
| Aggregate buffered frames | 64 MiB |
| Page default / maximum / result | 100 / 500 / 1 MiB |
| Evaluation file read | 8 MiB |
| Worker RSS target / cgroup MemoryMax / TasksMax | 512 MiB / 1 GiB / 64 |
| Handshake / ordinary / graceful-stop timeout | 5 s / 10 s / 5 s |
| Crash failures / window | 3 / 60 s, then durable failed |

These are candidate ceilings and qualification targets, not evidence of a
production deployment profile. E00/G0 must retain the measured values and
jointly decide which become immutable compatibility limits.

## Rust mirror

`server/src/lib.rs` exports `pub mod plugins`; `server/src/plugins/mod.rs`
re-exports `contract`, `error`, `framing`, and `manifest`. Rust DTOs use
`serde(rename_all = "camelCase")`, manifest DTOs also use
`serde(deny_unknown_fields)`, and error codes serialize as screaming snake case.
The Rust frame decoder mirrors the four-byte big-endian prefix, pre-allocation
payload check, UTF-8 check, aggregate buffer limit, JSON-RPC no-batch rule, and
string-ID rule. Fixture tests keep TypeScript and Rust acceptance/rejection
behavior aligned.

## Feasibility and G0 gate

The opaque fixture is a real React/Vite classic-script document built into
`fixtures/opaque-ui/dist`. The browser proof exercises CSP injection, opaque
origin, one-use port acknowledgement, bidirectional request/response, and
revocation. The cancellation proof covers cooperative checkpoints and the
non-cooperative supervisor escalation model.

G0 may pin D00 only after the following candidate set is jointly reviewed:

1. the packed generic SDK and SHA-256 digest;
2. all four schema versions and their positive/negative fixtures;
3. TypeScript/Rust DTO, framing, error, budget, and cancellation parity;
4. opaque UI bytes, script/style integrity metadata, and browser isolation proof;
5. E00 domain/identity consumers and compatibility behavior; and
6. the Node runtime distribution and Linux qualification assumptions.

D01–D06 remain required for a usable platform: owner-worker runner and registry,
API façade, browser integration, lifecycle/rollback, and Linux workload/deploy
qualification. A loader or fixture worker alone is not platform completion.

## Unresolved questions

- Which immutable Node `>=22.19` distribution and digest will E00/G0 approve for
  the owner worker on each supported Linux target?
- Which deployment subjects, systemd paths, and hardware/staffing profile are
  available for E00/G4 qualification?
- Which candidate budget values become immutable public compatibility guarantees
  versus deployment-tunable limits?
