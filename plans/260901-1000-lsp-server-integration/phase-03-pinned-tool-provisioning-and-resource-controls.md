# Phase 03 — Pinned Tool Provisioning and Resource Controls

## Context links

- Parent: [current policy and ledger](./plan.md#validation-summary).
- Direct dependency: [Phase 02 tree owner](./phase-02-lsp-framing-and-child-owner.md); transitively consumes [Phase 01 gates, tuple and finite initial bounds](./phase-01-protocol-dependency-real-process-spike.md#architecture).
- Historical input: [provisioning research](./research/researcher-02-tsls-provisioning-resource-controls.md); custom-profile/platform suggestions are superseded.
- Current packaging: [archive builder](../../deploy/release/build-release-archive.sh), [manifest/SBOM generator](../../deploy/release/generate-release-manifest.mjs), [installer local bundle](../../deploy/release/dam-hopper-install.sh), [release owner](../../server/src/linux_release/mod.rs), [API service template](../../deploy/systemd/dam-hopper-api.service.in).

## Overview

- Date: 2026-10-23
- Description: Package one immutable Linux x64 tool tuple, encode enforced initial portable limits, and qualify optional child-only hard controls without weakening release ownership.
- Priority: P1
- Implementation status: Pending (0%)
- Review status: Pending
- Effort: 28h
- Direct dependencies: 02 (includes passed 01 gates).
- Estimate rationale: replaces historical 20h provisioning with actual archive/strict manifest/SBOM, role projection, offline install/update/rollback and descendant-scoped controls work.

## Key Insights

- Existing `deploy/release/build-release-archive.sh` assembles the Linux archive; `generate-release-manifest.mjs` assigns strict entry roles and generates hashes/SPDX SBOM. Do not stage tools through the development run script or invent a parallel installer/signing system.
- Exact Node + TypeScript + TSLS + transitive packages ship as one server release unit. Browser, import, host file, flag or environment cannot select another executable, args, package tree or tool profile.
- Runtime offline is distinct from build-time retrieval of pinned inputs. Reproducible build may fetch verified locked artifacts; packaged runtime/install from a local bundle must not fetch engines or invoke npm/pnpm/npx.
- Portable-only is required runnable degradation. Application limits, V8 heap hints and sampled termination are not hard process-tree RSS/CPU ceilings.
- Phase 01 establishes finite bounded candidates; this phase enforces them before any session exposure. Phase 09 later tunes measurements and qualifies the resulting values; no cycle.

## Requirements

- Bundle the exact Phase 01 tuple/layout: absolute Node, fixed TSLS entrypoint, pinned TypeScript/tsserver resolution, package tree/lock, hashes, licenses/NOTICES, SBOM and provenance matching existing release policy.
- Integrate immutable server-role files into archive staging, manifest inventory/role classification, schema/strict validators where necessary, server/both staging and web-only omission. Preserve existing ownership/modes and transactional activation/rollback.
- Verify regular-file paths, expected release root, permitted immutable links if any, ownership/mode and digests before execution. Workspace-controlled or mutable alternative paths fail closed; hashes alone are not protection from a hostile local operator.
- Startup and ON perform bounded non-executing integrity/config/layout checks only: zero children. Actual version/protocol/capability probe occurs in bounded spike/release qualification or within the first authorized lazy session after tree/resource ownership is established.
- Enforce all passed Phase 01 initial values centrally: frame/header/document/overlay/transient-edit bytes, queue count/bytes, process/admission/in-flight/rate caps, deadlines, idle/restart policy and bounded stderr. Version the policy and propagate exact threshold/limits to consumers; callers cannot enlarge them.
- Apply optional Linux hard controls to the complete semantic tree before admitting semantic work. Never put `MemoryMax`/`CPUQuota`/`TasksMax` on the whole API daemon merely to constrain TSLS; never starve core PTY/FS/Git services.
- If child-only cgroup/delegation or any hard-control prerequisite is absent/fails, tear down any partially owned child safely, report `portable-only` with prominent warning and precise capability facts, then use the proved portable owner/bounds. Unsafe cleanup/ownership failure is not an acceptable degradation.
- No Windows-server/Job Object, native sidecar, Android-hosted or generic-language scaffold. Future Java/Rust engines require separate included-engine integration and real qualification; Rust unsupported now.

## Architecture

`semantic/tool_profile.rs` owns one internal built-in `typescript` descriptor tied to the current release root; no public registry or selected custom profile. Split passive artifact integrity/readiness from executable session compatibility: `integrity-valid` is not `protocol-qualified`. First-use protocol failure yields `missing-tool`/`incompatible`/bounded failure, reaps the tree and preserves core service.

`semantic/resources.rs` defines the enforced initial policy selected by Phase 01. `semantic/resources/linux.rs` reports and applies optional per-tree hard controls. Resource status describes actually applied controls and limitations; use `hard` only for the defined complete child-tree control set. Sampling/V8 hints remain labeled observation/soft guidance in either mode.

Release-owned immutable tuple sits in the G1-proven layout beside the versioned server release. Archive, inventory, SBOM, staging, retention and rollback treat it as server-role content. Normal bundled engine updates arrive through a new qualified DamHopper release, normally restarting the daemon; ordinary navigation and hot OFF/ON need no restart. Local operator file authority is outside authenticated API authorization, but does not introduce custom semantic commands.

Rollback boundary: missing/tampered/incompatible tools disable semantic admission only. Partial cgroup setup is cleaned without moving/killing unrelated daemon children. Runtime remains OFF by default and no route is made externally usable before Phases 05–06 security/control gates.

## Related code files

- Modify: `deploy/release/build-release-archive.sh` — deterministic tuple staging, permissions and server-role layout, not runtime downloads.
- Modify: `deploy/release/generate-release-manifest.mjs` — exact engine file roles/hashes/licenses and SPDX package relationships; preserve existing release generation owner.
- Modify where required by actual layout: `deploy/release/release-manifest.schema.json` and `server/src/linux_release/` inventory/manifest validation/staging/retention code — accept only approved server-role tuple paths and preserve role isolation/rollback.
- Inspect/modify only when necessary: `deploy/release/dam-hopper-install.sh`, `deploy/systemd/dam-hopper-api.service.in` — local `--bundle` install and safe child-control delegation; no daemon-wide semantic memory/CPU cap.
- Modify: `server/Cargo.toml` — only proven resource/integrity dependencies.
- Create: `server/src/semantic/tool_profile.rs`, `server/src/semantic/resources.rs`, `server/src/semantic/resources/linux.rs` — immutable descriptor, finite policy and precise Linux capability adapter.
- Create: release-owned pinned semantic artifact inputs/manifest in the exact G1-selected layout; no unselected path invented by this plan.
- Create: `server/tests/semantic_tool_profile.rs`; extend existing `server/tests/linux_release_manifest.rs`, `server/tests/linux_release_state_machine.rs` and applicable release-owner tests for actual inventory/install/rollback changes.
- Delete: none. No `deploy/run-linux-production.sh` staging feature, custom command config, runtime package manager, public profile registry or plugin framework.

## Implementation Steps

1. Require all Phase 01 gates and Phase 02 tree lifecycle GO. Reconcile provisional module/layout choices with exact evidence before production code.
2. Encode tuple/lock/provenance plus hashes for all executable/package inputs; document permitted build-time fetching and reproducible cached/offline assembly. Reject mutable tags/ranges/unverified install scripts.
3. Integrate deterministic archive staging and existing manifest/SPDX generator. Update strict recognized-entry validation and role projection together so server/both receive the tuple and web-only does not.
4. Ensure installation ownership and modes prevent workspace mutation; verify the active release root and expected entrypoints/packages pass passive integrity checks. Never locate Node/TypeScript/TSLS through PATH, workspace package resolution, global npm or custom local config.
5. Use the existing installer local `--bundle` path for offline install, then qualify upgrade/activation/rollback with old and new complete releases. Preserve existing attestation trust policy; engine availability must not require npm/network at install/runtime.
6. Encode passed Phase 01 initial policy as finite production defaults. Apply pre-allocation checks/reservations and aggregate caps before process/session exposure; publish threshold/policy identity, not arbitrary client overrides.
7. Implement optional child-only Linux controls with tree ownership established before helpers can run. Qualify delegated/systemd and nondelegated paths; preserve API daemon service ownership and resources.
8. On unavailable/partial hard controls, clean partial setup, report prominent `portable-only` with actual applied/unavailable facts and run the same bounded portable owner. Do not claim an RSS ceiling from V8 or sampling.
9. Keep ON/startup passive. Test executable compatibility only through bounded qualification or first authorized lazy session; failures reap every descendant and leave semantic readiness false.
10. Run future packaged no-network/portable/hard fixtures: tamper/missing/incompatible entrypoint/package, read-only ownership, hook suppression, install/update/rollback, resource pressure and core responsiveness. Pass observed metrics/policy to Phases 04–09; no measurement invented here.

## Todo list

- [ ] Stage exact immutable Linux x64 tuple through existing release owner.
- [ ] Include all hashes/licenses/lock/provenance and SBOM relationships.
- [ ] Update strict inventory/role projection and qualify offline install/update/rollback.
- [ ] Separate passive zero-child integrity checks from bounded authorized protocol probe.
- [ ] Encode/enforce Phase 01 finite initial limits and adaptive threshold.
- [ ] Qualify semantic-tree hard controls and required runnable portable-only fallback.
- [ ] Confirm no custom command/profile or workspace-selected tool resolution exists.

## Success Criteria

- Fresh server/both local-bundle installs, update and rollback select the exact matching immutable tuple with verified inventory/digests/licenses/SBOM; web-only installs omit engine payload. No network/package-manager execution is needed for engine provisioning at install/runtime.
- Startup and OFF→ON integrity checks spawn zero children. First authorized lazy use validates capabilities boundedly within the owner, not an untracked probe process.
- Missing/tampered/incompatible tool produces safe explicit semantic failure and no orphan; existing API/terminal/filesystem functionality remains responsive.
- Every consumer receives enforced finite initial policy before admission. Threshold/cap constants are not delayed to Phase 09, and clients cannot request larger limits.
- Hard mode constrains TSLS and actual descendants only. Forced hard-control absence/failure runs the mandatory portable-only semantic path with warning, true capabilities and bounded cleanup; no unmeasured hard RSS assertion.
- No custom executable, argv/environment selection, imported profile or project TypeScript plugin path; Rust returns unsupported. Native/Windows/Android remain unqualified and nonblocking.

## Risk Assessment

- Large Node/package inventory may exceed existing manifest limits: measure entries/bytes and minimally update approved layout/validators; never waive strict inventory or omit transitive files.
- Partial cgroup attachment can leak helpers: establish ownership before serving, prove descendant coverage; portable cleanup failure blocks exposure even if hard controls are optional.
- Node heap is not RSS and portable mode cannot cap project indexing memory absolutely: label limits accurately and preserve core-first admission/termination policy.
- Split tuple/binary rollback breaks compatibility: release owner activates/restores them as one immutable unit; browser never selects old engines independently.

## Security Considerations

- Bundled integrity and release permissions protect against workspace mutation, not a malicious OS operator controlling the server account/release files. Workspaces remain trusted and child filesystem authority remains server-account authority, not a sandbox.
- Minimal explicit execution environment suppresses inherited Node/dynamic-loader/package-manager hooks; fixed TypeScript/tsserver path and server-owned configuration preserve passed hostile-loading restrictions.
- Never expose executable paths, args, environment, source, stderr or private target paths in capability telemetry/logs.

## Next steps

- Phase 04 consumes verified immutable launch artifact, tree owner and enforced initial policy; Phases 05–08 consume the same limits before exposure.
- Phase 06 implements admin-only runtime enabled intent, not engine/profile switching. Phase 09 tunes numeric limits/threshold from measured evidence and records only measured bounds.
- Validation status: documentation revision only; no packaging, install, update/rollback, build, lint, test, formatter or runtime qualification executed.
- Unresolved gates: exact G1 tuple/layout, G6 hostile-loading restrictions and G7 portable cleanup/control mechanism await Phase 01 proof; resource values remain initial candidates until measured qualification.
