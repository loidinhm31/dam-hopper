# Parent correction candidates — accepted for revision

Planning-only correction input. Independent reviewer terminal COMPLETE; F1–F3 accepted by coordinator in review-triage.md. No user implementation permission or product changes.

## Atomic shared frame solution
Evidence: initial architecture header includes per-viewer subscriptionEpoch while fanout promises no per-viewer JPEG copy. Exact lock selects Axum0.8.8/tungstenite0.28.0 (server/Cargo.lock:163–164,192,4213–4221); installed Axum0.8.8 ws.rs:735–739,779–781 uses contiguous Binary(Bytes). Parent has now read this exact source, correcting the earlier neighboring-version citation. Small boring correction:
1. Keep subscriptionEpoch in socket admission/paired media-control state, and in ACK/discard controls. Do not put it in the shared per-target binary frame.
2. Encode one immutable COMPLETE BHJF prefix+target metadata+JPEG buffer per publication; clone its Bytes for each viewer. Target/process/producer/viewport/sequence remain in binary header.
3. Client annotates incoming frame with captured originating socket subscription token; after decode rechecks that token before draw/ACK. ACK uses originating token, never ambient current subscription.
4. Account complete retained buffers and unavoidable WS/TLS internals; promise no application-level per-viewer JPEG copy, not zero physical network copying. No custom scatter/gather WebSocket stack.

## Early vs integrated verification
Phase04 can prove real production gateway target-bound DOM/screenshot command roundtrip plus independent CDP Page-session primitives using the already maintained real-engine qualification harness. It cannot require Phase05 producer or Phase07 SPA to exist. Keep required full human+viewer+agent proof and interference scenario in Phase09, mapping acceptance A02 accordingly. Phase06 can use real browser component harness with real CDP endpoint after admission to prove input, then require physical Android full SPA in Phase09. Phase02 probes manager/domain capability directly; HTTP capability proof belongs after Phase03.

## Logout choice
Keep unconditional idempotent auth revoke-first behavior. Explicit UI choices should be Log out, keep Browser data / Log out and clear shared Browser data / Cancel. Destructive option requires live admin, sibling warning, confirmation and expected profile epoch; non-destructive logout returns retained/resetRequired honestly. Final product validation must settle whether ordinary explicit account logout defaults to wipe or keep; no answer received previously.

## Authoring usefulness
File maps should explain each path's responsibility (DTO/module registration/domain logic/API mapping/behavioral regression/config conversion), not repeat one task title across every file. Exact numbered steps already provide core design, but per-file reasons remove unnecessary writable authority (e.g. explain why state.rs participates in artifact binding rather than reflexively changing it). Generic constraints may point to authoritative architecture once concrete invariant exists there.

## Unresolved questions
Initial independent review complete; F1–F3 correction underway. User logout default still unconfirmed. Accepted material answers must propagate through contracts/tasks/matrix/ownership before readiness. Runtime metrics remain future obligations.
