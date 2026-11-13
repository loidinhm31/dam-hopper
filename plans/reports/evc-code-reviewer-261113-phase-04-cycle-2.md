# Phase 04 — cycle 2 terminal review

**Score: 6/10. Changes required; acceptance incomplete.** Read-only product/plan review. Code-review skill, published development rules, README, PDR, code standards, phase plan and cycle-1/fix reports read. Findings below based on source, not fix-report claims.

## Critical
None established. High-priority audio, status and bounded-work defects remain.

## Warnings

### High

**C2-W1 — W3 remains: attachment computes mute against a subscription not attached yet.**
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:1819-1827` assigns new credentials, computes mute, **then** attaches. `computeLiveMuteState` calls `canPlayAudioRef` (`:616-625`), which calls `canStreamTab`; that requires the controller's existing subscription to equal the new credentials (`:691-714,725-735`). A fresh real controller returns null; reconnect returns an old/null epoch. Thus visible, live, unmuted attachment computes **true**. Subsequent layout effect (`:1052-1055`) need not rerun when its visibility/mute dependencies stay unchanged.
- **Observed:** read-only probe ran actual extracted host helper bodies with the real controller: `{ muted: true, subscription: null }` for a visible/unmuted/live admission. UI may stay server-muted until another mute/visibility transition.
- Fix: derive pre-attach desired mute from current validated admission/slot/owner state, not post-attach subscription eligibility. Keep playback authorization strict. Test real null → unique fresh epoch, asserting the last pre-attach mute and first media-open control.
- Confidence: high.

**C2-W2 — W7 regresses to serialization/status emission every native frame.**
- `server/src/browser_host/screencast.rs:2482-2491` overwrites proven state and bumps `quality_revision` unconditionally, including identical settings/dimensions. `server/src/browser_host/media.rs:1838-1853` then considers each frame dirty; digest contains that revision (`:1410-1412`), so `:1501-1526` rebuilds, allocates, serializes and enqueues identical events. Old effective-event equality suppression is absent server-side.
- O(1) comparison exists but almost never skips work. Bounded writer slot bounds memory only; unchanged status traffic can track native FPS × viewers. Client duplicate filtering cannot recover server CPU/wire cost.
- Fix: bump only when proven run/version/settings/dimensions actually change; compare event-value state before serialization. Add steady identical-frame regression counting builds and outgoing status messages.
- Confidence: high, direct control flow; no throughput benchmark claimed.

**C2-W3 — W8 watermark misses asynchronous gate reopen.**
- `server/src/browser_host/media.rs:1530-1543` detects edges from a session-local boolean. Audio dequeue (`:1883-1898`) neither synchronizes this boolean nor observes a transition watermark; it tags an old broadcast chunk with the current gate generation. The 15 ms branch clears writer-slot audio on generation change (`:1782-1789`) but synchronizes the watermark only for pending controls (`:1801-1804`).
- Producer evaluation changes gates independently (`server/src/browser_host/adaptive_stream_controller.rs:487-493`; `screencast.rs:1663-1666`). Allowed → constrained/stalled → allowed between session observations leaves the boolean true and old watermark unchanged. Ready pre-recovery broadcast chunks can pass with the new generation. Even dequeue while closed does not record that closure.
- Fix: establish source/sequence admission boundary at the actual gate-generation transition and consume it atomically during admission; do not infer transition history from sampled booleans. Test deliberately held broadcast backlog and rapid tier/stall recovery, not only explicit initial unmute.
- Confidence: high for missing transition coverage; replay interleaving inferred, not live-reproduced.

### Medium

**C2-W4 — W4 partly fixed; FPS-only versioning leaves switching forever and warming can block proven events.**
- Proven tier/settings now agree (`server/src/browser_host/screencast.rs:875-893`), but effective/switching compares target version with native-run snapshot version (`:879-882`). FPS-only policy changes update governor cadence without restarting/replacing the native snapshot (`:1689-1699`). `server/src/browser_host/capture_tier.rs:363-390` preserves `native.version` when incorporating new FPS. Once target version advances, an otherwise applied cadence can remain `switching` indefinitely.
- Warming publishes **target** version (`screencast.rs:896-924`), while later proof can legitimately retain the older native version. Client rejects that proof before processing preference acknowledgements (`packages/ui/src/browser-host/stream-controller.ts:552-555,577-581`). **Observed controller probe:** warming v3 followed by coherent proven/switching v2 produced only the warming callback. Combined server/client path inferred from cited version rules.
- Construction is still multiple independently released locks/awaits (`screencast.rs:823-832`), not an atomic snapshot. Double run-read improves run replacement detection; it does not establish one consistent target/proof/directive revision.
- Fix: define an applied revision including governor-only changes; keep warming target revision separate from the monotonic applied-event fence. Snapshot coherent producer state before formatting. Add FPS-only and target-advances-before-first-frame regressions.
- Confidence: high for version rules/controller rejection; combined scheduling not live-reproduced.

**C2-W5 — W5 acknowledgement correlation fixed, disconnect clearing is not wired.**
- Store now waits for matching `event.preference`, not arbitrary diagnostics (`packages/ui/src/os/browser/browser-stream-quality.ts:118-143`). However, host's `onStatusChange` only updates component state (`BrowserStreamKeepAliveHost.tsx:1172`); media close retires audio and reports disconnected (`stream-controller.ts:333-341`) without clearing tuple diagnostics/pending. Host clearing effects depend on privacy/visibility/identity/tab phase, not stream status (`BrowserStreamKeepAliveHost.tsx:990-1066`). A media-only drop with the control session/tab still live can retain stale “effective” diagnostics or “Switching…” indefinitely.
- Fix: clear status/ack/pending for the current tuple on subscription retirement/disconnect/error while retaining preference. Add media-close regression with otherwise unchanged live tab/owner.
- Confidence: high, static lifecycle evidence. Store/controller separation probe also observed pending retained; not a full host/browser disconnect reproduction.

**C2-W6 — W9 partially improved; several advertised regressions cannot prove their claims.**
- `BrowserStreamKeepAliveHost.test.tsx:304-305` returns a preselected epoch even before attach, unlike real controller null. New ticket-race test (`:1517-1540`) starts after beforeEach already attached, never asserts another mint/attach occurred and checks only final mute after rendering. Changing connecting/live need not retrigger the connect effect (`BrowserStreamKeepAliveHost.tsx:1924-1933`). Resolving an unused promise and a correcting layout effect can both hide C2-W1.
- `browser-tools.test.tsx:303-310` dispatches ArrowDown, then assigns `value="low"` and dispatches change manually. It passes even if keyboard selection never works. Use real browser keyboard input and assert resulting value/callback without assignment.
- `browser-tests/host-browser-lifecycle.browser.tsx:641-645` still calls `releaseGeneration` directly instead of replacing connection generation. Selector/placement assertions are useful additions, but not generation-lifecycle/reload/two-unequal-viewer coverage.
- `server/tests/browser_host_media.rs:2904-2924` does not hold the receiver backlog; queued chunks may be consumed while muted before unmute, allowing the original defect to pass. It tests explicit initial reopening, not asynchronous tier recovery. Earlier mute assertions use `producer.set_viewer_muted` (`:2849-2861`), not a consumed wire mute acknowledgement.
- Fix focused oracles: unique fresh credentials/null preattach controller state; assert deferred work actually started; deterministic backlog hold; wire acknowledgement boundary; actual connection retirement; real keyboard interaction. Existing W1 document-floor and matching-preference tests are meaningful regressions.
- Confidence: high.

## Cycle-1 disposition — all nine checked

| Item | Disposition | Source evidence |
|---|---|---|
| W1 document floor | Fixed | `stream-controller.ts:599-617`: validate doc floor before switching audioRun, no floor reset. Regression `stream-controller.test.ts:1600-1660`. |
| W2 stale callback/tuple cleanup | Fixed for reported visibility/generation paths | `BrowserStreamKeepAliveHost.tsx:565-594,1215-1228`: current refs and credential/tuple match; `:1936-1956`: release last-published and latest tuples, dispose resources. `:590-595` retires previous generation. Not claiming every lifecycle path qualified. |
| W3 stale attach mute | Not fixed end-to-end | C2-W1; closure replaced, but eligibility now depends on unattached subscription. |
| W4 applied fidelity | Partial | Proven tier/settings coherent; warming numbers hidden in `browser-tools.tsx:191-235`. Version/atomic-snapshot issues C2-W4. |
| W5 pending ack | Partial | Explicit preference ack `browser-stream-quality.ts:102-143`; duplicate comparison includes preference `stream-controller.ts:556-575`; server digest includes preference `media.rs:1410-1415,1433-1436`. Disconnect gap C2-W5. |
| W6 Rust/TS parity | Fixed for reported cases | Rust `protocol.rs:1010-1011,1196-1229,1300-1333`: deny unknown audio fields, required nullable audioReason, required preference, 8192-byte union cap. TS `browser-host-types.ts:642-658,715-772`: exact **15** quality keys, preference enum and required reason; `:610-619`: canonical base64 round trip. Rust negative fixtures `protocol.rs:1591-1626`; six protocol tests passed independently. |
| W7 per-frame work/control feedback | Partial, server regression | Host preference-only forwarding fixed `BrowserStreamKeepAliveHost.tsx:598-614`; attach explicitly resends `:1822-1824`. Server C2-W2. |
| W8 fresh unmute | Partial | Explicit socket-control reopening samples latest sequence `media.rs:2092-2100`; missed independently changing gates C2-W3. Sequence generation uses checked increment `screencast.rs:2158-2162`; overflow fails closed. Parsing overflow/invalid becomes zero and is rejected by watermark (`media.rs:1884-1886`), then envelope validator rechecks canonical u64. |
| W9 lifecycle tests | Partial | Useful source-floor, ack and host publish tests added; C2-W6 remains. No new quality assertions found in `BrowserApp.test.tsx`; diff adds storage setup only. |

Audio mute boundary: stable closed gate is checked before writer admission and immediately before write (`media.rs:1208-1219,1891-1898`; `media_writer.rs:418-425`). One sequential writer sends control/status before subsequent queued audio (`media_writer.rs:108-115,385-467`); in-flight audio completes before mute acknowledgement can be written. No new post-mute-ack delivery path established while gate remains closed. This does **not** settle fresh-recovery backlog races.

## Suggestions

All three cycle-1 suggestions addressed:
1. Unique selector ID + announcement: `browser-tools.tsx:46,115-124,135-142`; panel originates from `BrowserApp.tsx:101` useId.
2. Unused PCM identity authority removed; controller remains authority: `pcm-player.ts:21-49`; host passes data only `BrowserStreamKeepAliveHost.tsx:1174-1180`. Queue flush regression `pcm-player.test.ts:238-259` passes.
3. One typed `releaseTab(tuple)` API: `browser-stream-quality.ts:161-164`; production callers `BrowserApp.tsx:419-424`, `BrowserStreamKeepAliveHost.tsx:1943-1948`; test caller `browser-stream-quality.test.ts:187`. Search found no obsolete public `current_run_proven()` getter.

New documentation suggestion: phase plan contract at `plans/261112-1205-browser-adaptive-stream-quality-and-performance/phase-04-viewer-quality-controls.md:30` still lists 14 fields, omitting required `preference`, and does not define target-valued warming placeholders. Contract owner should reconcile after fixing C2-W4. Plan deliberately not edited: read-only/no-task-tracking assignment.

## Reviewed files
Scoped changed hunks plus relevant callers/state paths; not a whole-repository audit:
- `server/src/browser_host/{protocol,media,media_writer,screencast,adaptive_stream_controller}.rs`; supporting `capture_tier.rs`.
- `server/tests/browser_host_{media,screencast}.rs`.
- `packages/ui/src/api/browser-host-types.ts`.
- `packages/ui/src/browser-host/{stream-controller,pcm-player}{,.test}.ts`.
- `packages/ui/src/os/BrowserStreamKeepAliveHost{,.test}.tsx`.
- `packages/ui/src/os/browser/browser-stream-quality{,.test}.ts`, `browser-tools{,.test}.tsx`.
- `packages/ui/src/os/apps/BrowserApp{,.test}.tsx`; `packages/ui/browser-tests/host-browser-lifecycle.browser.tsx`.
- Phase plan, cycle-1 report, three cycle-1 fix reports; README and docs cited above. Unrelated workspace config excluded.

## Validation commands / results
- `git status --short`, `git diff --stat`, scoped `git diff`, source reads/searches: completed. Product/tests/plans unchanged by review; only this report written.
- `pnpm --filter @dam-hopper/ui test src/browser-host/stream-controller.test.ts src/browser-host/pcm-player.test.ts src/os/browser/browser-stream-quality.test.ts src/os/browser/browser-tools.test.tsx src/os/BrowserStreamKeepAliveHost.test.tsx`: **5 files / 106 tests passed**, exit 0. Node module/localStorage warnings; no failed files in this narrow selection.
- `cargo test --manifest-path server/Cargo.toml --features vendored --lib browser_host::protocol::tests -- --nocapture`: **6 passed**, 1538 filtered, exit 0. Initial `...protocol::phase04_tests` filter matched zero tests; not counted as validation.
- `node --experimental-vm-modules --input-type=module <<'NODE' … NODE`: exit 0. Actual transpiled DTO/controller/store and extracted host callback bodies; boundary doubles only. Observed fresh unmuted admission computes muted; confirmed 15-key quality accepted, omitted audioReason/noncanonical base64 rejected. Store/controller isolation probe retained pending; not a live host disconnect test.
- `node --input-type=module <<'NODE' … NODE`: exit 0. Actual stripped controller accepted warming v3 then rejected proven/switching v2. Direct event-handler boundary probe; no server scheduling/browser claim.
- No broad UI rerun; known pre-existing **48 Node 26 localStorage failing files** not attributed to diff. No full build/typecheck/lint, media integrations or browser suite rerun in cycle 2. Prior agent results are not independent cycle-2 verification. Coverage percentages not measured.

## Unresolved questions
- Live/deterministic server evidence still needed for asynchronous tier/stall gate reopen with held backlog and genuine source restart. Watermark is scalar while `audio_seq` resets on new source (`screencast.rs:958-964`); verify/reset source-scoped boundary rather than assuming source continuity.
- Full host regression still needed for media-only disconnect with control/session left live, and real browser keyboard/generation retirement/reload/two-viewer acceptance. Current passing tests do not settle those paths.
