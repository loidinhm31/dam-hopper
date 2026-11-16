# Phase 05 final re-score

## Score: 4/10 — technical acceptance blocked

Reviewed current implementation after targeted fixes, security, performance, ownership architecture and YAGNI/KISS/DRY. Accepted designated tester evidence: **69/69 checks passed (68 tests + one E2E typecheck), zero failures/skips**. Passing checks are real evidence, not evidence of the unexercised acceptance paths below. No implementation or plan/task-state changes; reviewer did not rerun tests/build/lint.

### Improvements confirmed
- Native target identity is now saved in the registry; producer removal calls `Target.closeTarget`.
- Geometry update sends `Emulation.setDeviceMetricsOverride`; dimension reconfiguration now checks Streaming state, addressing the previous unconditional stopped-run restart.
- Reservation adjustment returns `Result` and consults admission on growth, but ownership transfer is incorrect (C1).
- Real Axum listener and both WebSocket upgrades are exercised; test now creates a logical registry session rather than inventing an absent session.
- Contiguous shared BHJF Bytes, exact subscription credit removal, two outstanding/one pending, settled-frame flush, fixed subprotocol echo, frame/message caps and cancel-aware media sends remain good primitives. No image re-encode engine or periodic screenshot loop introduced.

## Critical issues

### C1 — Memory ceiling/accounting remains unsound; growth fix releases its own delta
**Evidence:** `server/src/browser_host/diagnostics.rs:44-59,79-106,174-226`; `screencast.rs:587-602,650-724,795-845`; `protocol.rs:343-359`; reservation consumer search.

`let _ = self.controller.try_reserve(diff)?` immediately drops the returned RAII reservation. `self.bytes` still increases: reserving 100 then adjusting to 150 leaves the global count at 100; dropping the original reservation subtracts 150 and wraps the atomic counter. Growth can therefore undercount live allocations and subsequently poison admission. No bounds test calls `adjust`.

Independently, encoded candidates are copied before admission; simultaneously live base64, decoded JPEG and packed BHJF allocations are not fully charged. Only screencast publication calls the global controller: actor ingress, commands and raw relay do not participate. `clone_data()` exports Bytes without its reservation owner, allowing underlying transport allocation lifetime to exceed wrapper lifetime.

**Impact:** promised global 128 MiB ceiling/high-water accounting is not enforced; potential resource exhaustion or admission denial. **Correction:** transfer admitted delta into the original reservation without dropping/releasing it; reserve all live payload categories before allocation and bind the charge to actual exported shared-allocation lifetime. Test growth/shrink/failure/drop and naked transport Bytes retention. **Confidence: high, static; not runtime-reproduced.**

### C2 — Native create/delete is not an ownership transaction
**Evidence:** `media.rs:55-118`; `screencast.rs:178-185`; `server/src/api/browser_host.rs:351-364,419-429,1032-1045`; `session.rs:370-392,413-439`.

Two concurrent first attachments can both pass the producer/native-ID checks, create separate Chromium targets, and overwrite registry/map entries without closing the losing target. Creation racing DELETE can publish a producer after logical closure/removal. DELETE releases logical capacity before native closure; `close_target()` discards the CDP result and always returns success, and API creation discards native initialization failure. Closed registry sessions remain eligible for tickets/lazy producer initialization.

**Impact:** credential-bearing native pages can outlive successful DELETE, native target cap diverges from logical cap, and API can report successful creation with no native page. **Correction:** serialize native creation/publication/deletion per logical session; fence status/incarnation after awaits, clean losing allocations, return typed failures, and retain capacity/cleanup ownership until native closure is proven. **Confidence: high, static.**

## Warnings

1. **High — Resize can deadlock and reports incoherent geometry.** `screencast.rs:189-225,339-401`; `api/browser_host.rs:596-623`; `session.rs:559-569`. Resize holds the geometry write guard before acquiring the state read lock, while start holds the state write guard before acquiring geometry read: concurrent restart/resize with an existing Page session has inverse lock ordering. Native emulation/restart errors are ignored; initial start applies no device metrics. REST forwards raw geometry after registry clamping: width 5000 updates registry/input epoch but producer validation rejects it. Serialize lifecycle/reconfiguration, use the authoritative clamped DTO and propagate native errors. Streaming-state guard is an improvement, not complete serialization.

2. **High — Frame epoch/input trust can describe the wrong capture.** `screencast.rs:561-594,644-715`; `media.rs:895-900`. Epoch is first assigned after ACK await and reloaded after later awaits; old capture can be labeled as new viewport. Same-dimension changes retain old-epoch cache. Invalid metadata falls back to local geometry yet sets `inputTrusted:true`; dispatch uses local producer geometry instead of immutable published capture geometry. Carry capture/run/epoch signature through publication; disable input until reconciled.

3. **High — Upgrade security policy is weaker than existing canonical admission.** `media.rs:287-318,359-440,720-785`; `auth.rs:113-149`. Dev Origin helper accepts any superficially formatted Origin; missing peer metadata is accepted, duplicate Origins are not rejected. Neither upgrade checks admitted incarnation/profile epoch against current live target/process; control does not even check target existence. Ticket capability possession still limits exploitation, but does not replace these fences. Reuse canonical admission policy and validate live resource identity after awaited setup.

4. **High — Pair/lease ownership and reliable releases remain incomplete.** `media.rs:813-821,884-928,931-1024`; `attachments.rs:364-425`; `input.rs:271-311,414-505`; `api/browser_host.rs:750-753`. Control-only connection can dispatch input before mate readiness; message viewer/login/process/profile ownership is not bound to captured authority. Old-socket teardown checks viewer ID separately from revocation and can revoke a replacement lease. Missing-mate expiry is pruned only on later registration. PointerCancel is a native no-op; gap/overflow and REST release discard generated releases; native dispatch errors are swallowed after state mutation. Bind dispatch and atomic teardown to immutable complete authority, actively expire incomplete pairs, and send original-target releases or mark input unavailable on failure.

5. **High — Native ACK/recovery contract not met.** `screencast.rs:228-254,416-448,483-507,540-581`; `cdp.rs:370-384`. Runs reuse flattened sessions, allowing delayed old events to seed new native run identity. Broadcast lag merely warns; oversized current-run frames drop without ACK/abort. ACK waits for complete CDP response in the event/governor/heartbeat loop. Stop cancels before draining; ACK failure cancels tasks without reconnect/restart, and heartbeat alone cannot restart a stopped producer. Use fresh run session ownership, bounded prompt ACK enqueue, explicit loss accounting and ordered recovery.

6. **High — Deadline cancellation/cleanup not independent on every path.** `media.rs:475-504,506-556,664-678,815-837,884-928`. Outer deadline select cannot interrupt an already-selected media send or native input dispatch. Initial control write has no deadline/cancel race; initial cached media send ignores failure and precedes deadline setup. Already-expired return skips demand/attachment cleanup; failed upgrade has no cleanup guard. Use independently triggered deadline cancellation plus unconditional cleanup, including initial writes/native dispatch.

7. **Medium — Abuse/operational proof incomplete.** `media.rs:491-492,570-580,650-651,872-908`; `diagnostics.rs:245-305`; `tests/browser_host_bounds.rs:129-155`. Fixed one-second control windows do not implement sustained-100/burst-200; burst constant is unused, unsupported binary traffic and malformed control input are ignored. Global delivered/start/zero-demand-stop counters and qualification ring have no production updates; writer/ACK ages and queue-depth observations are absent. Wire small shared limiter/validation and instrument actual lifecycle/send boundaries; tests currently assign diagnostic counters directly.

All warnings above are source-backed, high-confidence static findings; no failing runtime reproduction claimed.

## Acceptance evidence limits

- `tests/browser_host_media.rs:370-422` creates the session and tickets through direct Rust registry/manager calls, not HTTP POST endpoints. Lines 424-462 prove both real upgrades and initial control status, but receive no JPEG, send no input and assert no teardown. This is useful integration coverage, not a full REST/native-media/input journey.
- `tests/browser_host_screencast.rs:131-170` checks cache invalidation, not native resized image dimensions. The “heartbeat expiry” test (`176-205`) hides/removes viewers rather than waiting for 15-second expiry. The “burst” test (`209-258`) observes about:blank for one second; recorded evidence is one received frame, not a generated animation burst/replacement stress.
- `tests/browser_host_media.rs:162-200` tests two credit controllers, not a blocked physical WebSocket writer plus responsive PTY/control. `tests/browser_host_bounds.rs:86-126` tests wrapper retention, not independently retained transport Bytes.
- Phase 05 real faulted-ACK/old-run recovery, replacement lease isolation, pause/rebind replay, two-target 60-second global-budget soak and PTY/control responsiveness remain unproven. These are Phase 05 obligations (`phase-05-producer-fanout.md:56-92`), not demands for future SPA/platform work.

## Suggestions — performance / architecture / YAGNI-KISS-DRY

- One target lifecycle owner for create/start/stop/resize/delete and immutable native/capture identity; avoid independently mutable authorities, not add a generic orchestration framework.
- Remove map entry under the global producer lock, release that lock before native shutdown; currently unrelated producer access blocks across CDP awaits (`media.rs:68-73`).
- Spawn using `self: &Arc<Self>` instead of reconstructing the many-field shared handle (`screencast.rs:859-882`).
- Store immutable parsed publication metadata with shared frame bytes; avoid per-viewer header deserialization/string allocation on every admission/flush (`media.rs:164-205`). Reuse existing admission/coordinate helpers instead of duplicate policy.
- Add focused production-boundary regressions above; do not widen scope into unrelated UI or new abstractions.

## Reviewed files

Primary source: `server/src/browser_host/{screencast,media,diagnostics,protocol,mod}.rs`; `server/src/api/{browser_host,router}.rs`.

Tests: `server/tests/browser_host_{screencast,media,bounds}.rs`.

Supporting inspected sections/searches: `server/src/browser_host/{session,input,attachments,auth,cdp}.rs`; `plans/261108-0237-host-browser-cdp-streaming/{phase-05-producer-fanout,architecture-contracts}.md`; prior post-fix review; latest tester report; `README.md`; `docs/{code-standards,project-overview-pdr,system-architecture}.md`; `docs/architecture/host-browser-cdp-streaming.md`; published development rules/code-review skill and verification reference. Approximately 3,500 source/test lines plus supporting documentation. Plans updated: none, per assignment's no-task-tracking constraint.

## Validation commands/results

Designated tester evidence: `plans/reports/tester-261109-0940-phase-05-post-fix-evidence.md:31-78` and `agent://RunPhase05TesterFinalEvidence`. All recorded exit 0:

| Command | Result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test browser_host_screencast -- --nocapture` | 3 passed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_media -- --nocapture` | 7 passed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_bounds -- --nocapture` | 3 passed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway` | 14 passed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_admission` | 7 passed |
| `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle` | 10 passed |
| `cargo test --manifest-path server/Cargo.toml --lib browser_host` | 24 passed |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Passed; zero type diagnostics |

Reviewer: targeted source reads/searches, targeted integration `git diff`, `date +%y%m%d` → `261109`. Scoped TODO/FIXME/todo!/unimplemented! search found no matches. No tests/build/lint/formatter rerun. These are the selected browser regression targets, not a measured repository-wide suite. Type/test coverage percentages, lint count and release-build status unavailable.

## Unresolved questions

No missing repository information blocks corrective action. Missing evidence remains: reservation-growth/transport-retention proof; concurrent native create/delete; resize/restart serialization and native dimensions; ACK-failure/old-run recovery; paired/replacement lease isolation; independent blocked-writer deadline cancellation; real expiry and the specified 60-second two-target/PTY-control soak. **Do not promote Phase 05 to technically accepted based solely on 69 passing checks.**
