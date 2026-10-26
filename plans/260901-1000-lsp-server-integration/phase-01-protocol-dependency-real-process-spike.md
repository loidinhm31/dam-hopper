# Phase 01 — Protocol, Dependency, and Real-Process Spike

## Context links

- Parent authority: [latest Validation Summary and revision ledger](./plan.md#validation-summary); September research is historical input, not runtime evidence.
- Planning ADR: [decision record](../reports/brainstorm-260901-1000-lsp-server-integration.md).
- Historical research: [Monaco/transport](./research/researcher-01-lsp-client-transport.md), [TSLS provisioning](./research/researcher-02-tsls-provisioning-resource-controls.md).
- Current sources: [UI manifest](../../packages/ui/package.json), [Monaco host](../../packages/ui/src/components/organisms/MonacoHost.tsx), [native origin guard](../../apps/native/src/native-server-url.ts), [Linux archive builder](../../deploy/release/build-release-archive.sh), [manifest/SBOM generator](../../deploy/release/generate-release-manifest.mjs).
- Protocol reference: [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/).

## Overview

- Date: 2026-10-23
- Description: Establish executable, bounded STOP/GO evidence before committing to downstream production paths.
- Priority: P1
Implementation status: DONE (2026-10-23) (Spike completed; G0–G7 proven on real processes; G8 deferred to Phases 07 & 10 under approved plan exception)
Review status: Reviewed 2026-10-23 (Cycle 1 NOT APPROVED, `../reports/code-reviewer-261023-0231-lsp-phase-01-spike-review.md`; Cycle 2/3 empirical hardening completed in `scripts/spike-lsp-test.mjs`). Approved by user 2026-10-23 with noted issues (G0–G7 proven on real processes, G8 tracked for in-browser qualification in Phases 07 & 10).
- Effort: 24h
- Direct dependencies: reconciled parent policy and planning ADR; no implementation phase.
- Estimate rationale: adds hostile-loading, descendant, adaptive-wire, version-fence, and actual-web gates to the historical 16h spike. Failed-gate redesign is not silently included.

## Key Insights

- Linux x64 server + actual web application are the only blocking release topology. Native, including Linux Tauri, Windows, and Android remain unqualified/deferred/nonblocking; do not weaken the native same-origin guard.
- Only a bundled immutable Node/TypeScript/TSLS tuple is eligible. No project-selected TypeScript, custom command, host override, plugin registry, or direct-tsserver fallback.
- LSP advertises one `TextDocumentSyncKind`, not both Full and Incremental. Definition/Implementation have no standard document-version parameter or didChange acknowledgement.
- URI/result containment limits gateway disclosure/navigation, not the child's server-account filesystem authority. Trusted workspaces only; plugin/hook suppression is a separate executable gate.
- Pre-execution policy: finite candidate settings and cleanup ownership were recorded prior to running processes (`reports/phase-01-execution-policy.md`). Spike execution is complete: G0–G7 GO empirically verified, G8 STOP tracked for in-browser qualification.

## Requirements

- Freeze `/ws/semantic/v1`, subprotocol `dam-hopper.semantic.lsp.v1`, attach-first, text-only single-object JSON-RPC, UTF-16 positions, `dam-hopper://semantic/<session-target-id>/<encoded-relative-path>`, and stable safe error codes.
- Choose exact tool versions, package tree, absolute launch paths, hashes, licenses, Linux ABI assumptions, and release-relative layout; unknown version strings/layouts are STOP, not runtime discovery.
- Pin a transport-only `vscode-ws-jsonrpc`/`vscode-jsonrpc` pair, or deliberately choose pinned primitives if the adapter fails. Preserve Monaco's lazy import and exclude full language clients/VS Code service graphs and duplicate Monaco runtimes.
- Record every required TSLS server request, fixed server-owned configuration reply, initialization option, tsserver executable selection, and child capability. Unknown command/edit/registration/filesystem requests never cross to the client.
- Select and document finite initial limits below before execution; Phase 03 makes passed settings enforced initial runtime policy; Phases 04–08 consume it. Phase 09 tunes it from evidence, not a prerequisite for initial safety.

## Architecture

A disposable, loopback-only bounded harness connects the actual web application's Monaco path through a filtered gateway to the real candidate tuple. It is not a permanent feature implementation. Production module paths in later phases remain provisional until every gate passes. Keep the evidence and reproducible fixture recipe; delete disposable executables/harness scaffolding after extraction into the owning implementation phase, not an arbitrary permanent prototype.

### Initial candidate policy — record before running

These are conservative experiment/admission settings, not measured capacity, RSS guarantees, or qualified release thresholds. A failed candidate may be revised only by recording a new bounded policy before rerunning; never remove limits to obtain a pass.

| Dimension | Finite initial candidate |
|---|---|
| Concurrency | 2 global semantic trees; 1 per semantic connection; 8 observed processes/tree as a termination trigger |
| Protocol | 8 KiB stdio header; 4 MiB WS message/frame and stdio body; 32 queued messages and 4 MiB queued bytes per direction/session; 8 in-flight navigation requests/session |
| Models | 1 MiB UTF-8/document; 16 open documents/session; 4 MiB overlay text/session; 8 MiB total overlay text; bounded transient edit copies accounted separately |
| Input | 40 messages/s/session, burst 80; fixed bounded rate state |
| Sync | 64 KiB post-edit full-text UTF-8 bytes: full below, incremental at/above; didOpen/replay/resync always full |
| Time | 30s startup; 10s navigation; 2s graceful shutdown + 3s force-kill/reap budget; 60s idle only with no open models/pending work; 2 restarts/5min, 1s then 3s backoff |
| Output | 64 KiB retained sanitized stderr summary/session, continuous drain; 2s socket-send and auth-store lookup deadlines |
| Child resources | 256 MiB V8 old-space hint per Node process, if pinned launch proves propagation; optional child-only cgroup candidate 768 MiB memory, 50% of one CPU, 16 tasks/tree |
| Spike envelope | 15min wall-clock/run, 2h aggregate executed workload; finite target corpus/file-count/bytes recorded before any child starts |

V8 old-space, process-count observation, RSS sampling, and kill triggers do not provide hard RSS/CPU bounds. Portable-only mode must run with application bounds and honest degradation even if no cgroup/delegation is available. Hard controls must cover the semantic tree, not tighten the API daemon's own cgroup. Record measured baseline and exact sampling/overshoot limitations.

### Named STOP/GO gates

Evidence paths below are future artifacts under this existing plan, not files claimed to exist. Each records command/fixture recipe, versions/digests, candidate limits, observed result, and reviewer disposition. Exclude real credentials, source/private paths, and unsanitized logs.

| Gate | GO evidence and artifact | STOP disposition |
|---|---|---|
| G0 — Bounded execution | `reports/phase-01-execution-policy.md`: all finite bounds, fixture corpus limits, cleanup owner, watchdog, and no-exposure/default-OFF setup recorded before first process | No execution until complete |
| G1 — Immutable tuple/layout | `reports/phase-01-tuple-layout.md`: exact Node/TS/TSLS + transitive lock/hashes/licenses, resolved tsserver path, Linux x64 ABI, release layout integrated with existing archive/manifest ownership; no project/PATH/network resolution | Halt downstream provisioning; no arbitrary installed-tool fallback |
| G2 — Transport/lazy bundle | `reports/phase-01-transport-bundle.md`: exact transport pair, license/dependency and gzip chunk deltas, recorded acceptance ceiling, browser exports, cancellation/close; initial app chunk retains Monaco lazy boundary and one runtime | Revise narrow adapter/pins; never import full client to bypass gate |
| G3 — TSLS handshake/config | `reports/phase-01-protocol-config.md`: real initialize/initialized, required fixed configuration replies, exact advertised capabilities/UTF-16, shutdown/exit, no unhandled child requests | No protocol exposure while required behavior is unknown |
| G4 — Adaptive sync | `reports/phase-01-sync-version.md`: one negotiated Incremental kind candidate accepts both range-less full replacements and ranged incremental events; same correct overlays/navigation below/at/above64KiB, crossing both directions, empty docs, close/reopen/replay, ASCII/Unicode/non-BMP/UTF-16 cases | Halt; no dual enum advertisement or assumed compatibility. Any changed contract needs explicit plan reconciliation |
| G5 — Version and result freshness | Same sync/version artifact: prove required filtered-profile `params.damHopperDocumentVersion` extension on Definition/Implementation, removed before child dispatch; FIFO through actual child writer after validated overlay updates; capture source version + open incarnation + child/session/target/connection generations, reject stale results; prove destination coordinates associate with the exact destination content/version, including unopened files, via demonstrated content association or validated invalidation-and-requery strategy | Halt if source semantics, close/reopen fencing, or destination-coordinate freshness cannot be demonstrated; a freshly authorized/readable destination alone does not prove the TSLS range matches that content; no invented LSP ack or all-project snapshot claim |
| G6 — Project execution suppression | `reports/phase-01-hostile-loading.md`: real hostile package/tsconfig/tsserver plugin sentinels, local TypeScript decoy, automatic typings acquisition, Node preload/loader and inherited execution-environment hook vectors do not execute or fetch; positive control proves sentinels detect execution | Halt if any project plugin/hook executes or pinned engine resolution is bypassable |
| G7 — Tree lifecycle/control | `reports/phase-01-process-tree.md`: TSLS + tsserver/typings/helper descendants observed; graceful/crash/hung-parent/forced-stop cleanup leaves zero live descendants/zombies within recorded deadlines in required portable-only mode; characterize process-group escape/reparenting and daemon-death handling; optional child-only hard mode separately proven | Halt on unowned/leaked descendants or lack of safe portable cleanup; missing optional hard controls alone is not STOP |
| G8 — Actual web navigation/provider coexistence | `reports/phase-01-web-navigation.md`: authenticated actual application + bundled real candidate, unsaved `.ts/.tsx/.js/.jsx` Definition and Implementation, in-target multi-result selection, unopened destination, cancellation/reconnect, external-result denial; prove competing built-in Monaco TS/JS Definition/Implementation providers are suppressed only for currently owned eligible semantic models while unrelated/nonowned/OFF models retain existing behavior, despite potentially global Monaco controls; fresh sanitized captures + human review | Halt if model-scoped coexistence or navigation freshness cannot be proven; no global feature disabling, built-in result contamination, source-only/jsdom or protocol-only harness substitution; native proof not required |

Candidate G4 wire contract: gateway advertises one Incremental sync kind plus an explicit versioned adaptive-profile capability; the client selects representation from post-edit UTF-8 length, server recomputes and validates it. Require exact TSLS support for the child-facing full/ranged event union under its one negotiated kind. G5 uses an explicitly documented DamHopper extension, not a standard LSP field. Navigation must follow writes on the same actual child FIFO; this is ordering, not a child acknowledgement. Record how changes to other open destination models invalidate pending navigation; on uncertainty discard and reissue rather than selecting stale ranges.

## Related code files

- Inspect: `packages/ui/package.json`, `pnpm-lock.yaml`, `packages/ui/src/components/organisms/MonacoHost.tsx`, `packages/ui/src/lib/monaco-setup.ts` — dependency and lazy editor boundaries.
- Inspect: `deploy/release/build-release-archive.sh`, `deploy/release/generate-release-manifest.mjs`, `server/src/api/ws.rs`, `server/src/workspace_target.rs` — real packaging/auth/target seams.
- Future evidence only: artifacts named in G0–G8 and isolated bounded fixture recipe; no mandatory production `semantic-json-rpc.ts` created by this spike.
- Future production dependency/transport edits belong to Phase 07 after gates. Phase 02 fixture launch uses the winning bundled Node, never system Node/PATH.
- Delete after future spike: disposable harness/output and failed candidates; retain concise reproducible gate evidence. No code changes in this revision.

## Implementation Steps

1. Reconfirm parent policy; write G0 settings and baseline fixture inventory before running any process or opening exposure.
2. Select exact tuple/layout and transport candidates; inspect pinned upstream CLI/config behavior and release ownership. Stop on missing provenance/license data.
3. Build an isolated bounded test artifact. Build-time retrieval of hash-pinned inputs may use network; runtime and qualification of the packaged tree do not.
4. Run G1–G3 real process/transport qualification, recording required TSLS replies and actual tsserver selection.
5. Prove G4/G5 exact adaptive wire contract, FIFO/version/open-incarnation fencing, destination freshness, threshold crossing, Unicode/range equivalence, and full resync/replay. No protocol acknowledgement fabricated.
6. Run G6 hostile sentinel fixtures with positive controls; verify sanitized environment, disabled automatic acquisition/plugin loading, no project-selected engines/hooks/network fetches.
7. Run G7 portable cleanup and optional child-only hard-control probes; record descendants, reaping owner, escape/reparenting behavior, and cleanup timing. Stop if portable lifecycle cannot be owned.
8. Run G8 through the actual web application using bounded temporary integration. Prove stable dirty local model object/text/undo/view state across matching authorized reconnect despite replacement wire URI; changed endpoint/root/actor must never receive retained source automatically. Prove model-scoped provider coexistence for active/OFF/nonowned models, source-version and destination freshness; capture fresh non-sensitive visual evidence and human review.
9. Record aggregate document/payload sizes, cold/warm latency, CPU/RSS observations, core/terminal baselines and degradation; pass raw evidence to Phase 09 without claiming unmeasured ceilings.
10. Assign GO/STOP separately for every gate. G0–G7 GO empirically proven on real processes; G8 STOP granted approved plan exception to qualify in-browser during Phase 07 and Phase 10. Temporary test fixtures and processes cleaned up; hardened reproducible harness preserved at `scripts/spike-lsp-test.mjs`. Downstream backend implementation (Phases 02–06) unblocked.

## Todo list

- [x] Record G0 finite policy before execution (`reports/phase-01-execution-policy.md`).
- [x] Pass G1 exact immutable tuple/layout/provenance (`reports/phase-01-tuple-layout.md`).
- [x] Pass G2 pinned lazy-bundle transport (`reports/phase-01-transport-bundle.md`).
- [x] Pass G3 child handshake/configuration replies (`reports/phase-01-protocol-config.md`).
- [x] Pass G4 one-kind adaptive sync and G5 version/result freshness (`reports/phase-01-sync-version.md`).
- [x] Pass G6 hostile execution-hook suppression with positive controls (`reports/phase-01-hostile-loading.md`).
- [x] Pass G7 portable tree cleanup and characterize optional hard controls (`reports/phase-01-process-tree.md`).
- [ ] Pass G8 actual authenticated web navigation, model-scoped provider coexistence and visual review (STOP — deferred to in-browser qualification in Phases 07 & 10 under approved user exception; see `reports/phase-01-web-navigation.md` and `reports/phase-01-gate-disposition.md`).
- [x] Record gate disposition, measured inputs, and clean temporary test fixtures/processes (disposition in `reports/phase-01-gate-disposition.md`, baselines in `reports/phase-01-performance-baseline.md`; test harness intentionally retained at `scripts/spike-lsp-test.mjs`).

## Success Criteria

- G0–G7 each have explicit empirical evidence and GO verdict; G8 STOP has explicit approved plan exception moving browser DOM/worker qualification to Phases 07 & 10. Downstream backend implementation (Phases 02–06) is unblocked.
- Runtime OFF and ON integrity checks each create zero semantic children; executable protocol qualification occurs only in this bounded spike/release gate or first authorized lazy session.
- Definition/Implementation reflects tested current unsaved source overlays and destination freshness; no stale/cancelled/open-incarnation result navigates or host path leaks.
- Owned semantic models cannot receive competing built-in TS/JS navigation results; OFF, unrelated and nonowned models retain their prior provider behavior. If Monaco's available controls cannot achieve that without global collateral effects, G8 is STOP pending explicit replan.
- Required portable-only mode passes tree cleanup and bounded work without claiming a hard memory ceiling. Optional hard-control absence does not fail a safe portable mode.
- Native policy unchanged; no native/Windows/Android qualification implied. No custom executable path survives in the proposed production surface.

## Risk Assessment

- Plugin suppression, exact TSLS sync behavior, and descendant ownership may prove infeasible; these are STOP gates, not assurances.
- Indexing can exceed portable memory/CPU expectations despite bounded messages; report observed behavior and stop admission/terminate semantic work, never starve core server.
- A spike can ossify into a second architecture; keep findings/fixtures only and place final code in owning phases.
- Estimate is 24h for bounded investigation; failure may change downstream estimates only after evidence-driven replan.

## Security Considerations

- Child retains the server account's filesystem authority; URI filtering is not an OS sandbox, and trusted workspaces remain a prerequisite.
- Direct absolute bundled executable/entrypoint, fixed server-owned args/config, minimal explicit environment; deny inherited `NODE_OPTIONS`, `NODE_PATH`, preload/loader, dynamic-loader and package-manager execution hooks. No shell/PATH/project engine resolution.
- Verify both tsserver plugin discovery and TSLS configuration restrictions against selected source and real sentinel fixtures; flag names alone are not evidence.
- Loopback fixtures use ephemeral credentials; routine evidence/logs omit tokens, source, argv/environment, symbols and private paths.

## Next steps

- Phase 01 complete and approved on 2026-10-23. Proceed to Phase 02 (LSP framing and child owner).
- Phase 02 consumes selected framing and process-tree lifecycle findings (`reports/phase-01-process-tree.md`); Phase 03 encodes immutable tool and initial resource/sync policy.
- Gate disposition: G0–G7 GO; G8 STOP tracked for in-browser qualification in Phases 07 & 10 per explicit user approval.
