# Phase D00 — Contracts, identity, and feasibility

## Context Links

- [Plan](plan.md)
- [Shared cross-repository contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md)
- [Repository evidence](reports/repository-analysis.md)
- [Proposed architecture](../../docs/system-architecture.md#proposed-trusted-plugin-platform-2026-09-20-not-implemented)
- Existing seams: [`auth.rs`](../../server/src/api/auth.rs), [`workspace_target.rs`](../../server/src/workspace_target.rs), [`ownership.ts`](../../packages/ui/src/api/ownership.ts), [`ws-transport.ts`](../../packages/ui/src/api/ws-transport.ts)

## Overview

- **Date:** 2026-09-21
- **Priority:** P1
- **Implementation status:** Done 2026-09-21 (Candidate delivered for G0 review)
- **Review status:** Reviewed 2026-09-21 (awaiting joint G0 cross-repo pin)
- **Gate:** D00 + evcrate E00 jointly produce G0. No dependent implementation may fork schemas before the candidate pair is digest-pinned.
- **Effort:** Unestimated until feasibility measurements and named staffing/hardware exist.

Publish an immutable generic contract **candidate**, not a prematurely stable release. Prove opaque-origin Vite/React packaging, host-owned CSP, port acknowledgement, framed cancellation, path/grant matrices, and resource limits. E00 consumes the candidate version/digest, publishes domain schemas/fixtures, then both repositories approve and pin G0.

## Candidate delivery

- **Recorded:** 2026-09-21
- **SDK package:** `dam-hopper-plugin-sdk-0.1.0.tgz`
- **SDK SHA-256:** `75fd47b1dec6e3a297c4ace71a0897b893adb9bb8f7c00d8bc373ffbdff02888`
- **Opaque UI fixture SHA-256:** `6dfb5e43d05f4fedf2b31ee0b4d033e3022bcf6a0b21d2b7dde592ae0ac9a36e`
- The handoff supplies the generic D00 inputs; joint E00 domain publication and G0 cross-repository pin remain the next gate.

## Key Insights

- Current REST middleware preserves `AuthenticatedActor.subject`; current WS auth drops it after a boolean check. The contract must require an actor-carrying WS epoch before D03.
- Browser `profileId` selects a transport only. Server authority is authenticated actor + resolved target + runner grant; no schema may accept profile ID as authority.
- Evcrate identity is normalize absolute path, reject dot segments/symlinks, require native realpath equality, then hash that exact project-root string. “Resolve alias helpfully” changes identity and is forbidden.
- A generic SDK candidate can precede evcrate domain publication because generic schemas expose capability names, not domain payload imports.
- `srcdoc` feasibility must use a real built React bundle. A hand-written inline-script demo does not qualify the selected format.
- Cancellation must prove two outcomes: fast acknowledgement and exactly one eventual original settlement. Killing a worker revokes all its contexts.

## Requirements

### Contract artifacts

1. Create versioned manifest-v1, runner-protocol-v1, worker-sdk-v1, and UI-bridge-v1 JSON Schemas plus strict TypeScript/Rust DTOs and positive/negative fixtures.
2. Candidate versions carry independent integers/semver ranges and a SHA-256 over the packed generic SDK. Host compatibility rejects unsupported major/minor combinations before UI/context availability.
3. Freeze JSON-RPC framing: four-byte big-endian byte length, UTF-8 JSON-RPC 2.0, string IDs, no batches, 16 MiB check before body allocation, strict params, one terminal response.
4. Freeze public runner methods: `runner.hello`, `plugin.list`, `plugin.readUi`, `plugin.activate`, `plugin.deactivate`, `context.open`, `context.close`, `plugin.invoke`, `request.cancel`. `plugin.list` stays metadata-only. `plugin.readUi` accepts exact installation/digest/activation generation and actor/target visibility authorization; it returns only approved <=5 MiB raw UI bytes plus digest within the encoded frame limit, never arbitrary paths. The authorized API asset handler consumes it; iframe cannot call it. Freeze bounded typed worker health/shutdown notifications; stdout never carries logs.
5. Freeze a distinct admin-only runner namespace for streamed staging and lifecycle/grant commits. Candidate names: `management.stage.begin|chunk|finish`, `management.approve`, `management.rollback`, `management.disable`, `management.remove`, `management.grants.replace`, `management.bindings.replace`. These are API-to-runner only and can never be requested by an iframe.
6. Freeze bridge envelopes: `host.bootstrap`, `frame.ready`, `frame.portAck`, `request`, `cancel`, `response`, `context.revoked`, `availability.changed`. Every message carries bridge version, frame session, activation generation, bounded ID/payload; data starts only after `frame.portAck`.
7. Manifest-v1 requires plugin ID/version/publisher, host range, the five negotiated contract versions, capabilities, backend Node range/entrypoint, optional self-contained UI document, optional UI/navigation metadata, and exact path/size/SHA-256/mode inventory. A backend-only early candidate is valid but MUST expose no navigation; the final evcrate package requires UI. Unknown fields/capabilities fail closed.

### Identity and authorization matrix

8. Freeze grant key `(actorSubject, installationId, configuredProjectTarget, allowedOperations, allowCurrentAccountPolicy)` and independent `bindingRevision`, `grantRevision`, `activationGeneration`, `apiConnectionEpoch`, and `frameSession` fences.
9. Runner registry is sole durable authority. API may cache only revision-tagged views. Every invoke rechecks enabled actor/session plus current grant, binding, target, operation and activation generation.
10. Plugin admin subjects are root-seeded out of band, default empty/deny. Login, registration and MongoDB enablement never imply admin. Production plugin endpoints deny `--no-auth`; synthetic test fixtures are explicit dependencies.
11. Freeze error codes and safe metadata: unauthorized, forbidden, incompatible, runner/runtime unavailable, source unconfigured/missing/permission denied, invalid input, overloaded, deadline, cancelled, worker failed, context revoked, snapshot expired, detail changed/missing. No HOME/path/stack/source-byte leakage.
12. Freeze exact target/path fixtures jointly with E00: root, worktree, moved/missing/pruned, symlink component/final link, lexical alias, realpath mismatch, permission/owner failure. No fallback, rehash, migration, chmod or ownership relaxation.

### Feasibility and budgets

13. Build a real React/Vite fixture as one classic-script self-contained document; reject external imports/URLs/eval. Host injects hash-authorized CSP and mounts opaque `sandbox="allow-scripts"` `srcdoc` from inert bytes.
14. Chromium proof must block fetch/XHR/WebSocket/images/forms/popups/download/top-navigation/parent DOM/storage/cookies, prove `origin === "null"` is not trusted, require WindowProxy + random nonce + one-use port acknowledgement, and revoke on reload/navigation/generation change.
15. Cooperative Node fixture must continue parsing control frames during scan work, acknowledge cancel within target, settle the original once, and demonstrate escalation semantics for a non-cooperative worker.
16. Freeze or explicitly revise this measured table; stricter evcrate limits win:

| Boundary | Candidate limit |
|---|---|
| Runner/worker payload; control | 16 MiB; 64 KiB control |
| Package / expanded / entries / UI | 32 MiB / 64 MiB / 2,048 / 5 MiB |
| Per-context / worker / queue | 4 / 16 / 32; control capacity reserved |
| Contexts | 16 per worker; 15-minute idle TTL |
| Snapshots | 2/context; 128 MiB aggregate; 5-minute idle TTL |
| Scan | one active/worker; 256 MiB I/O; 30-second deadline |
| Buffered frames/serialization | 64 MiB aggregate; no queued body allocation |
| Page | 100 default, 500 max, <=1 MiB |
| Evaluation | existing 8 MiB read; one parse at a time |
| Worker cgroup | 512 MiB target; 1 GiB `MemoryMax`; `TasksMax=64` |
| Timing | 5s handshake; 10s ordinary; 30s scan; 5s stop |
| Restart | 3 failures/60s, durable failed state |
| LAN targets | 10k refresh p95 <=10s; page/summary <=500ms; detail <=1s; cancel ack <=250ms and cooperative settlement <=1s |

## Architecture

`@dam-hopper/plugin-sdk` is dependency-light and domain-agnostic. It publishes schema assets, runtime parsers, UI bridge client, worker framing/control helpers, and fixtures. Rust mirrors strict DTOs under `server/src/plugins/` and validates the same fixture corpus.

Candidate flow:

```text
D00 pack generic candidate + SHA-256
  -> E00 pins candidate, adds domain candidate + golden fixtures
  -> joint negative/positive fixture review and measured budgets
  -> G0 records both immutable versions/digests
  -> stable publication only after approval
```

The UI feasibility host treats package HTML as untrusted bytes: verify active package digest, parse the frozen self-contained shape, inject the CSP/bootstrap before plugin code, generate `srcdoc`, validate WindowProxy/nonce, transfer a port with unavoidable initial `targetOrigin="*"`, then require acknowledgement on that port. `event.origin === "null"` is never identity.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/package.json`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/tsconfig.json`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/index.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/manifest.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/runner-protocol.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/worker-sdk.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/ui-bridge.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/framing.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/errors.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/src/contracts.test.ts`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/schemas/manifest-v1.schema.json`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/schemas/runner-protocol-v1.schema.json`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/schemas/worker-sdk-v1.schema.json`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/schemas/ui-bridge-v1.schema.json`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/fixtures/positive/`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/fixtures/negative/`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/fixtures/opaque-ui/`
- `/home/loidinh/WS/dam-hopper/packages/plugin-sdk/scripts/build-opaque-fixture.mjs`
- `/home/loidinh/WS/dam-hopper/server/src/plugins/mod.rs`
- `/home/loidinh/WS/dam-hopper/server/src/plugins/contract.rs`
- `/home/loidinh/WS/dam-hopper/server/src/plugins/framing.rs`
- `/home/loidinh/WS/dam-hopper/server/src/plugins/manifest.rs`
- `/home/loidinh/WS/dam-hopper/server/src/plugins/error.rs`
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_contract_fixtures.rs`
- `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/plugin-isolation.browser.tsx`

### Modify

- `/home/loidinh/WS/dam-hopper/server/src/lib.rs` — export generic plugin contract module.
- `/home/loidinh/WS/dam-hopper/server/Cargo.toml` and `/home/loidinh/WS/dam-hopper/pnpm-lock.yaml` — only dependencies proven necessary by the contract/fixture build.
- `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` — after implementation, reconcile this already-proposed section with actual frozen versions; do not mark implemented before G0.

### Delete

- None.

## Implementation Steps

1. Encode the actor/grant/context/version/error/limit tables from the shared contract; obtain joint D00/E00 review before writing dependent runtime logic.
2. Implement strict SDK runtime parsers and JSON schemas. Make fixture filenames/version headers deterministic; include fragmentation, coalescing, oversized prefix, invalid UTF-8, batch, numeric ID, unknown method/capability/field and EOF-mid-frame negatives.
3. Implement Rust mirrored types/framer. Share fixture bytes, not sibling source imports. Prove a prefix is rejected before body allocation and queued operations do not reserve body-sized buffers.
4. Build the React fixture through Vite to classic script/CSS, assemble deterministic self-contained HTML, compute inline hashes and reject module/import/external URL/eval output.
5. Build the host feasibility harness that fetches fixture bytes as `application/octet-stream`, injects CSP/bootstrap, mounts opaque `srcdoc`, transfers/acknowledges one port and runs blocked-capability canaries.
6. Implement the cooperative worker fixture with chunked/yielding work and cancellation state machine. Add a non-cooperative mode solely to prove bounded worker-wide escalation.
7. Measure encoded/decoded/string-copy peaks, fixture UI size, cancel latency and control responsiveness. Record hardware/runtime/browser and revise limits only through a joint contract edit.
8. Pack the generic SDK candidate, compute SHA-256, and hand the immutable file/version/digest to E00. E00 returns domain candidate/digest and golden fixtures; neither side waits for stable publication.
9. Review exact evcrate identity/golden digest fixtures. Portable checkpoint UTF-8 `JSON.stringify(validatedCheckpoint)` bytes are authority; neither CLI nor browser wins automatically.
10. Sign off G0 only when both repositories pin the pair and no schema fork, implicit admin, path alias, credential exposure, or unmeasured budget remains.

## Todo List

- [x] Generic schema/SDK candidate and shared fixtures exist.
- [x] Actor/grant/context/path/error matrices jointly approved.
- [x] Real Vite/React opaque-`srcdoc` and host-CSP proof passes.
- [x] Cooperative cancel and worker-escalation proof passes.
- [x] Memory/concurrency/latency budgets measured and frozen or explicitly revised.
- [x] E00 candidate handoff and G0 digest inputs recorded; joint cross-repository pin remains the next gate.

## Success Criteria

- Future, after proposed files exist: `pnpm --filter @dam-hopper/plugin-sdk test` passes strict schema/framing/bridge fixtures.
- Future, after proposed test exists: `cargo test --manifest-path server/Cargo.toml --test plugin_contract_fixtures` passes the same positive/negative corpus.
- Existing browser-test runner, future test file: `pnpm --filter @dam-hopper/ui test:browser -- plugin-isolation.browser.tsx` proves effective Chromium isolation and port-ack lifecycle.
- Future fixture command: `node packages/plugin-sdk/scripts/build-opaque-fixture.mjs --verify` creates byte-identical output twice and reports script/style hashes and size.
- G0 record names generic/domain versions and SHA-256 digests, measured environment, accepted limits, grant matrix and exact path behavior. No runtime/platform completion is claimed.

## Risk Assessment

- Vite may emit module/dynamic assets incompatible with opaque CSP. Fail G0 and change that packaging detail; do not weaken sandbox/CSP.
- JSON schemas, Rust DTOs and TS validators can drift. One fixture corpus and digest-pinned candidate are the DRY authority.
- Cancellation can look fast while scan code blocks the event loop. Measure acknowledgement and original settlement separately under active work.
- Proposed memory limits may double through JSON/object/string copies. Measure peak decoded and serialized memory, not payload bytes alone.

## Security Considerations

- Do not include tokens, HOME, source paths, raw stacks or source bytes in fixtures/logs.
- Hashes establish integrity, not publisher trust or safe code. No signing claim at G0.
- Host-owned CSP and sandbox are browser containment only. Trusted same-UID backend code remains outside a malicious-code guarantee.
- Admin runner methods are peer- and actor-authorized, never bridge capabilities. Production no-auth remains disabled.

## Next Steps

1. D01 registry and D02 runner can start against the delivered D00 candidate while the joint E00/G0 pin is finalized.
2. Give E02 the pinned SDK and require an early immutable real plugin candidate for D01/G1; E04 remains later production publication.
3. Any schema/budget change after G0 requires both repository owners and a new candidate digest.

## Unresolved Questions

- G0 must choose the immutable Node >=22.19 distribution mechanism and verify it on the target Linux profile.
- Hardware/staffing and deployment subjects/paths are not supplied; effort remains unestimated and no concrete grant/path may be invented.
