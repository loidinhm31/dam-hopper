# Phase 02 — Frame ownership and GUID-routed downloads

## Context / overview
[Plan](plan.md) · [Evidence F2, ownership transitions](reports/evidence-and-design.md). P1; pending; 8h. Depends on Phase 01; two sequential tasks share actor/selection/session/tests. Main is integration owner. Preserve existing navigation invalidation, Fetch enforcement and native host download destination.

## Requirements / architecture
One bounded instance-scoped frame/target ownership projection, attached to existing principal browser lifetime, not one independent attribution set per navigation watcher. Reuse manager's logical/native session identities and internal actor's causal child attachment events. Create `target_ownership.rs` for projection/query rules; manager remains native target lifecycle owner. Expose read-only proven ownership to later DevTools policy; bare CDP session IDs never cross connection namespaces. No timer polling census or invented frameId==targetId mapping.

### resolve-frame-target-ownership
1. Add bounded Page.frameAttached/frameDetached/parent-aware frameNavigated projection to `cdp.rs`, including CDP session context and existing memory accounting. Carry target/parent provenance needed by consumers; unknown/lost event invalidates admission rather than being silently ignored. Use existing bounded ChildAttached target events for OOPIF roots; projection is not proof until resolved to an owned parent.
2. Seed Page.getFrameTree on live root/owned OOPIF sessions. Subscribe before snapshot, correlate generation and ordered events; detect incomplete snapshot, event loss or detach during seed. Only publish complete current facts, otherwise fail closed and refresh on lifecycle recovery. Do not launch a second broad auto-attach service competing with stealth/manager.
3. Resolve every descendant frame to exactly one live owner tuple: principal/dev namespace, browser incarnation/profile epoch, logical session/native target identity and attachment generation. Seeded frame parent edges plus causal OOPIF attachment must agree. Top-level popup is a different logical target, not an owned child session of its opener. URL/origin/opener alone is insufficient.
4. On navigation/process swap, frame detach, target close/crash, profile reset or actor reconnect retire affected frame/session identities before new admission. On queue loss/overflow/cap exhaustion, invalidate affected ownership facts and re-seed under existing lifecycle; never clear maps then accept unknown. Reserve map/event memory and bound work by existing target/frame budgets.
5. Contract tests: same-process child, nested child, cross-site OOPIF replacement, detach/reattach, duplicate frame IDs across browser incarnations, snapshot gap and overflow. Real frame provenance required in Phase 05; if deployed engine cannot prove an owned child, affected compatibility stays blocked, not inferred.

### route-downloads-by-guid
1. Replace per-watcher `active_download_guids` and negative other-main-frame exclusion with one begin/progress dispatcher using the ownership projection. Keep server path setup internal. Resolve browser-level begin by positive frame ownership; page-session begin must also agree with current connection/session provenance. Missing/unknown/conflicting frame or stale emitter yields no user-visible attribution.
2. Atomically bind first GUID to live owner tuple and source frame before publishing `lastDownload`/SessionUpdated. Duplicate same-owner begin is idempotent; conflicting begin invalidates that GUID and never rebinds. Native browser events may omit sessionId; no first-watcher/session fallback.
3. Progress routes ONLY by bound GUID, validates original owner still live and never consults current active tab. Preserve binding if source frame navigates/detaches while original logical target remains live (ongoing download); session/target/incarnation retirement retires GUID and drops late progress. Completed/canceled GUIDs retain bounded dedup state then expire without permitting stale rebinding. At bound, refuse new attribution without evicting active ownership.
4. Keep DTO/filePath/suggestedFilename associated only with owner. No server-side inferred completion/path when native field absent; keep existing optional field semantics. Do not introduce cross-tab global download UI or storage migration. Remove obsolete watcher-local tracking helpers/tests and migrate callers to the single owner.
5. Deterministic tests use independent expected owner A/B, not projection code as oracle; progress-before-begin, duplicate/conflict, close/recreate and concurrent downloads tested. Phase 05 proves exactly one owner DTO/event changes and content remains in configured directory.

## Related files / actions
Prefix `/home/loidinh/WS/dam-hopper/`. Create `server/src/browser_host/target_ownership.rs`; modify explicit paths in task records. `cdp.rs` transports bounded facts; manager/session retire identities; selection consumes download notifications without duplicating ownership. Delete only obsolete code inside these modules, no file deletion. Do not disturb raw gateway's documented authority or stealth injection policy.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "resolve-frame-target-ownership",
    "title": "Establish positive live frame and child-target ownership",
    "blocked_by": ["seal-devtools-command-envelopes"],
    "allowed_files": ["server/src/browser_host/target_ownership.rs", "server/src/browser_host/mod.rs", "server/src/browser_host/cdp.rs", "server/src/browser_host/manager.rs", "server/src/browser_host/session.rs", "server/src/browser_host/selection.rs", "server/tests/browser_host_adapter.rs", "server/tests/browser_host_devtools.rs"],
    "constraints": ["One bounded projection attached to existing browser lifecycle; no alternate logical-session registry or cross-connection bare-session IDs.", "Ownership needs causal live frame/target proof; unknown, gap, capacity overflow or ambiguous OOPIF state denies attribution and target promotion."],
    "acceptance": ["Live root and descendant frames resolve to exactly one logical/native incarnation; child/OOPIF swaps and snapshot/event ordering cannot admit stale owner facts.", "Detach, reconnect, target/profile retirement and event loss invalidate authority before reuse; memory bounds do not default-allow."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --features vendored --lib browser_host::target_ownership; cargo test --manifest-path server/Cargo.toml --features vendored --test browser_host_adapter --test browser_host_devtools -- --test-threads=1. Use explicit parent/detach/gap fixtures and Phase 05 deployed-engine same-process/OOPIF identity observations; no real-browser claim from mock events."]
  },
  {
    "id": "route-downloads-by-guid",
    "title": "Route download begin and progress by immutable positive owner binding",
    "blocked_by": ["resolve-frame-target-ownership"],
    "allowed_files": ["server/src/browser_host/target_ownership.rs", "server/src/browser_host/selection.rs", "server/src/browser_host/session.rs", "server/src/browser_host/manager.rs", "server/tests/browser_host_devtools.rs", "server/tests/browser_host_selection.rs"],
    "constraints": ["Remove watcher-local negative attribution and GUID fanout; no fallback owner for absent or unknown frame.", "Pin GUID through frame navigation while original target lives; retire on logical/native incarnation loss; preserve optional native filePath and server-managed directory."],
    "acceptance": ["One child/OOPIF download updates exactly one owning logical session; progress does not leak suggested filename/path or completion to another tab.", "Progress-before-begin, conflicting duplicate GUID, unknown frame, overflow and late progress after close/recreate cannot mutate a replacement or foreign session."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --features vendored --test browser_host_devtools --test browser_host_selection -- --test-threads=1. Inspect A/B sessionUpdated streams and independent REST DTO snapshots for exact GUID ownership; Phase 05 real-Chromium two-tab iframe lane must exercise both download bytes and owner isolation."]
  }
]
```
- [ ] <!-- evcrate-task:resolve-frame-target-ownership --> Resolve positive frame ownership
- [ ] <!-- evcrate-task:route-downloads-by-guid --> Bind and route download GUIDs

## Success / risks / security / rollback / next
No inference from absence of known foreign frames; child-frame ownership positive or attribution unavailable. Losing attribution on a legitimate frame is a visible compatibility failure to resolve, not a passing security fixture. Do not cancel unrelated native downloads solely to simplify routing. Keep private paths out of diagnostics. If observer unavailable, mark relevant attribution unavailable without copying metadata to another session; no synthetic completion. Rollback disables/drains affected Browser capability, preserves already-downloaded files/profile locks, and never promises file deletion or undo. Next Phase 03 reuses existing input authority; no independent concurrent writers.
