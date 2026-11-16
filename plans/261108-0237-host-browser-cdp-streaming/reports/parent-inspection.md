# Parent inspection — initial final draft

Planning-only inspection after BrowserPlanAuthor terminal complete. Read canonical overview, architecture, all10phase files, acceptance matrix, ownership and authoring report. No product tests/builds/runtime checks.

## Observed structural check
Read-only installed `source.load` plus parent marker/link/DAG/overlap checks ran in Eval JS on actual final files:
- Overview51lines,10phases,29tasks,29matching markers.
-167local links checked,0broken links;0unordered writable overlaps; exact contract parser/DAG passed.
- Source fingerprint `63f346c49b8d488bb1065ac9f7fe2a144bb74ff2dec28bafdc4fcaf6a5f3fdaf`.
- No tasks.json/hydration. Proposed new paths enumerated; phase file maps classify first creation as Create new(planned), later writes as dependency-created. Existing files include auth_device_sessions.rs and current browser test glob matching planned .browser.tsx.
- Explicit JSON guard inspection: Phase01 headers BOTH surfaces; Phase04 exact Origin discovery/WS and Origin-less header-only; Phase08 currentAdmin ManagedBrowser vs Cooperative plus store/API/tests ownership; revoke-FIRST200retained/resetRequired; Phase09 bounded tuning grid+final-frame+revisit condition. Phase09 integrated task refers all matrix rows rather than restating every one.

## Candidate semantic issues for independent review
These are parent findings/questions to verify, not independent reviewer conclusions.

1. **Contiguous binary WS vs viewer-specific metadata / no-copy promise.** Initial architecture-contracts.md:101 includes subscriptionEpoch in each frame header;113 says per-viewer headers may differ while JPEG not copied. Phase05:70 says atomic one message + no per-viewer payload copies. Corrected exact locked evidence: server/Cargo.lock:163–164,192,4213–4221 selects Axum0.8.8 with tungstenite0.28.0; installed Axum0.8.8 `src/extract/ws.rs:735–739,779–781` uses contiguous `Binary(Bytes)` (now parent-read directly). Earlier neighbor-version inspection was not the locked dependency. Different per-viewer headers cannot share one full contiguous buffer without copy/custom writer. Small correction: socket-bound subscriptionEpoch, one immutable complete target envelope/publication, shared Bytes clones, originating-socket ACK context. No custom WebSocket framework.

2. **Semantic dependency/qualification mismatch.** Phase04:59–60 asks human-watched same target and independent producer while Phase05 producer/Phase07 UI depend on completion of phase04. A02 names Phase04 as owner of integrated human/agent proof. Phase06:94/174 asks real Android web SPA input before Phase07 root cutover. Phase02:65 asks read capabilities before Phase03 HTTP routes. Define real primitive/isolated harness evidence at early phase vs move final app assertions to Phase09; do not claim future full app in prerequisite or add circular edges. Phase01 correctly specifies maintained temporary real forwarding fixture to avoid its own gateway dependency.

3. **Logout UI non-destructive path unclear.** Phase08:125 cancel preserves login/profile and129 all actual Logout actions invoke confirmed wipe workflow when authorized. Server correctly permits non-destructive logout200retained/resetRequired. UI should offer explicit Log out, keep Browser data vs Log out and wipe vs Cancel rather than trap authenticated users into wiping. Broad report interpretation remains unconfirmed; final user validation must surface it.

4. **File-map reasons repetitive.** Most Purpose cells repeat task title for every path (e.g.phase08:28–33). Numbered steps provide concrete contracts; ask whether per-file responsibilities need refinement, especially unnecessary state.rs artifact write. Generic constraints are backed by detailed architecture, not inherently a defect. This is authoring usability, not a fabricated security finding.

## Reviewer gate
Independent plan-only read-only evc-code-reviewer assigned next. Evidence-based findings only; zero findings allowed. Review once plus at most one targeted follow-up after propagated revision; severe residual findings block regardless of allowance. No code permission from this inspection.

## Unresolved questions
Shared-profile account logout wipe remains an unconfirmed interpretation. Runtime engine/zoom/process/performance/nativeWindows/physicalAndroid/human qualification are future obligations, not current results.
