# Phase 01 — Scope baseline and contract freeze

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: None; start here after explicit implementation authorization.

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **completed** (2026-10-15 19:51:53 +07:00). Review status: **completed** (user review score 9.5/10; 4/4 test suites passed). Progress: **100%**.
- Scope: All scope IDs; GATE-A1.
- Goal: Freeze an implementable first-release contract and evidence baseline before selecting packages or coding features.
- Deliverables: Documentation baseline and contract freeze completed in `docs/android-native-acceptance.md`, `native-app/README.md`, and `docs/system-architecture.md`; runtime/library feasibility gates remain pending for Phase 05/18.

## Key Insights

- Embedded HTML/Mermaid browser rendering is the only waived feature parity. The user separately restricts presentation to TERMINAL + Traditional, one panel-button row and no floating buttons; other non-browser functions remain included as panels.
- Docs contain historical WS examples; Rust serde/router and actual TS serializers are authoritative.

## Requirements

- Map every included non-browser function to a requirement ID, source and owning phase, including small configuration/import/memory/integration actions; do not reproduce excluded IDE/Runtime shells or floating navigation.
- Freeze server0.13.2/protocol2 baseline, minSdk29, both ABI targets, named reference device and current/minimum OS matrix.
- Record dependency/license and native language-service uncertainty as hard gates, not default unsupported behavior.

## Architecture

Use scope-and-acceptance.md as release inventory; append exact routes/DTOs/events, capability denials and persistence policy to a branch-owned contract ledger. No backend changes or broad generated SDK required.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/project-overview-pdr.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/rest-endpoints.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/router.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws_protocol.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/api/ws-transport.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/MonacoHost.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/DiffViewer.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/MergeConflictEditor.tsx`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/android-native-acceptance.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/README.md`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Read this plan, architecture, reviewed research and scope; verify branch/base and preserve existing web/Tauri behavior.
2. Walk current navigation/settings/command consumers to inventory included functions, not to copy every web layout. Freeze TERMINAL + Traditional, the complete panel-row registry, single-line overflow behavior and no-floating rule; record exact first-release exclusions.
3. Inventory per-field REST/WS/SSE shapes, enum/error states, roles, request limits and server capability gates. Capture sanitized real frames against an isolated server.
4. Enumerate current editor behaviors and JSON/TS worker-provided features, not hypothetical full VSCode behavior; define native parity scenarios for each.
5. Name physical reference hardware, IMEs, API29/current-API/16KiB targets and acceptable memory/input/scroll performance budgets before measurement.
6. Choose independent Android version policy, application identity and supported server baseline; list signing custody and license obligations to validate in Phase02/05.
7. Review the frozen ledger against every phase and record GATE-A scope approval; do not mark library/runtime feasibility passed.

## Todo List

- [x] Complete source-to-scope/phase ledger.
- [x] Freeze device/server/performance/security acceptance matrix.
- [x] Record exact preview exception and unresolved dependency gates.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations (deferred to Phase 05/18 runtime qualification).

## Success Criteria

- Every included current behavior has a phase and an observable journey; no silent broad “later” buckets.
- Actual source disagreements with docs are recorded with exact source commit; no legacy terminal spawn/chunk protocol adopted.
- Reference hardware/budgets and server compatibility are explicit or marked blocking before qualification.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Incomplete inventory silently shrinks all-non-browser scope; require ledger review before feature work.
- Broad compatibility claims exceed baseline; fail incompatible-server UX explicitly.

## Security Considerations

- Use isolated accounts and projects for capture; no credentials, PTY/user content or private paths in ledger artifacts.
- No reading/transporting server-token signing secret; no public account-promotion feature invented.

## Next Steps

- Phase 01 completed 2026-10-15 19:51:53 +07:00 (user-approved review score 9.5/10; 4/4 test suites passed per assignment record).
- GATE-A scope entry enables Phase 02 (Gradle KMP Android foundation); Phase 02 is pending and unblocked for project setup.
- Later runtime gates remain pending: toolchain/launch verification in Phase 02, terminal/editor/crypto proofs in Phase 05, and device qualification in Phase 18.

## Unresolved Questions

- None within Phase 01 scope. Scope inventory, device matrix, presentation constraints, and contract freeze decisions are recorded in `docs/android-native-acceptance.md`, `native-app/README.md`, and `docs/system-architecture.md`. Dynamic runtime verification, library feasibility proofs, and live server integration obligations are explicitly transferred to their owning phases (Phase 02/05/18).
