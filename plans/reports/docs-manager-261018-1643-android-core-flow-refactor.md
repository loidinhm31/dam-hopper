# Documentation Manager Report: Android Core Flow Refactor

- **Date:** 2026-10-18
- **Plan:** `plans/261018-1643-android-core-flow-refactor/plan.md`
- **Scope:** `native-app/README.md`, `docs/`, and this report
- **Status:** Core-flow and physical-device network setup documented; live-server/device qualification remains open.

---

## Current State Assessment

The repository had extensive historical Android workbench and panel-shell documentation, but the active app root had changed to a focused Profile Login → Project List → Project Terminal flow. Several current-facing documents still described the separate 12-panel `WorkbenchScreen` shell as if it were mounted, and debug cleartext configuration was described as loopback-only despite its `base-config` allowing cleartext to any host.

The active flow and navigation lifecycle were cross-checked against `MainActivity`, `AppFlowState` / `AppFlowNavigation`, `DamHopperMobileApp`, and the three screen implementations. The retained panel contract is now explicitly separated from the mounted root flow. The documentation does not claim live-server, physical-device, or release qualification.

## Changes Made

- `native-app/README.md`: documented the three screens and their behaviors, state/repository ownership, back transitions and selection preservation, terminal local-detach behavior, inline terminal controls, panel-shell reachability boundary, and physical Android Wi-Fi setup. Added shell and Windows PowerShell debug-install commands; clarified the host LAN address, firewall/bind needs, emulator-only `10.0.2.2`, debug cleartext breadth, HTTPS requirement for authenticated Wi-Fi, user-CA trust, loopback-only `--no-auth`, and TLS-only release policy.
- `docs/architecture/android-native-client.md`: replaced proposal-era status with current implementation status and added the active navigation state table, back/selection lifecycle, repository generation replacement, terminal session lifetime, and explicit retained/unmounted panel-shell boundary. Corrected the debug security-audit description.
- `docs/system-architecture.md`: added the active root flow and lifecycle, distinguished it from the retained panel subsystem, corrected current debug-network policy and the stale security-audit description, and updated the architecture link label.
- `docs/project-overview-pdr.md`: updated the Android product vision and PR-029 status to the current three-screen entry flow and open qualification boundary.
- `docs/code-standards.md`: documented active navigation ownership, unmounted panel-shell scope, and accurate debug/release network-security expectations.
- `docs/android-native-acceptance.md`: added a prominent current-root status note so the historical panel registry and broader product scope are not mistaken for reachable screens; corrected the Phase 02 debug network statement.
- `docs/codebase-summary.md`: updated the native-client map and reachability boundary, and recorded that its summary was reviewed against the generated Repomix snapshot. Historical repository counts remain explicitly dated as historical.
- `docs/README.md`: changed the Android architecture entry from “proposed” to the implemented flow/lifecycle description.
- Generated `repomix-output.xml` with Repomix 1.18.1 and refreshed `docs/codebase-summary.md` against that snapshot.

The project roadmap and changelog are owned by ProjectManager and were not edited here. Their stale current-facing loopback-only statement was referred to that owner; historical entries should remain clearly historical.

## Gaps Identified

1. **Debug network scope:** `native-app/androidApp/src/debug/res/xml/network_security_config.xml` permits cleartext to any host. `audit-apk-security.sh` checks for common development-domain entries but does not assert that cleartext is limited to them. Reconcile the audit's scope with the actual debug base policy; documentation warns that the config is not a security boundary.
2. **HTTPS for authenticated Wi-Fi:** Use an HTTPS profile URL whose certificate hostname matches the host address and a trusted certificate chain. The debug build trusts system and user-installed CAs; this does not relax hostname validation. No authenticated HTTP/LAN setup is recommended.
3. **Qualification:** Unit-level flow coverage does not establish a live login → project fetch → PTY journey on an Android device. No runtime or physical-device qualification was performed for this documentation task.
4. **Credential-guard evidence:** Source review shows `ApiClient.shouldAttachBearerToken()` adds bearer headers only for HTTPS or loopback, and `buildWsHandshakeUrl()` adds a query token only for HTTPS/WSS or loopback. The updated `HostResourceSseClient` request builder likewise adds bearer headers only for HTTPS or loopback. These are initial request-construction guards, not complete transport-security proof; redirect behavior and focused regression-test results were not verified here. ProjectManager's focused REST guard coverage caveat remains.
5. **Panel reachability:** The broader 12-panel subsystem remains present in source and historical/acceptance records, but it is not mounted by the current `MainActivity` root. A future product decision to mount it would require another documentation update and separate qualification.
6. **Documentation validator warnings:** The validator reports one broken internal link in `docs/CHANGELOG.md` to a missing `plans/261009-1403-traditional-terminal-worktree-switching/progress.md`, plus 24 unverified environment-key mentions across docs outside the edited Android sections. These are outside the updated Android pages; the broken-link warning was sent to its owner.
7. **Windows validator output:** The validator printed `The system cannot find the path specified.` while attempting its code-reference check, then reported success. Its `git grep ... 2>/dev/null` call may be incompatible with the Windows shell; that subcheck is not treated as reliable evidence.

## Recommendations

1. Align the audit's reporting with the current debug policy; if host restriction is required, enforce it explicitly instead of relying on presence checks for common development domains.
2. Maintain focused regression coverage for the bearer-token request guards and verify redirect behavior before treating them as complete transport protection; ensure status reports distinguish source review from test evidence.
3. Keep physical-device Wi-Fi instructions HTTPS-only for authenticated access and complete a live-server login/project/PTY attach-and-detach journey before claiming runtime qualification.
4. Preserve the distinction between the active three-screen flow and the unmounted panel-shell contract in future roadmap, acceptance, and release updates.

## Metrics and Maintenance Status

- **Requested documentation scope:** 100% of the identified README and Android flow/lifecycle documentation targets updated; eight existing documentation files changed plus this report.
- **Whole-repository documentation coverage:** Not quantified; no complete coverage denominator exists for implementation behavior versus all repository docs.
- **Update date:** 2026-10-18.
- **Size:** All nine measured files (eight updated documentation targets plus this report) are under 800 LOC; the acceptance ledger is largest at 799 LOC.
- **Validation:** `node .omp/evcrate/scripts/validate-docs.cjs docs/` completed against 72 Markdown files with non-blocking warnings: one broken internal link outside the edited Android sections and 24 unverified environment-key mentions. Its code-reference search excludes `native-app/` and printed a Windows path error, so it does not validate Kotlin references. Focused review confirmed the README's internal link targets and balanced fences; the report contains no Markdown links. Android builds/tests were not run for this documentation task.

## Unresolved Questions

- None required to complete the documentation update. The audit's lack of an explicit host-scope assertion, qualification gates, validator warnings, and focused bearer-guard test-coverage caveat remain follow-ups rather than documentation blockers.
