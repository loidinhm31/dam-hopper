# Code Review: Phase 01 — Scope Baseline and Contract Freeze

**Score**: 9.5/10  
**Status**: APPROVED (Documentation baseline frozen; unlocks Phase 02: Gradle KMP Android Foundation)  
**Date**: 2026-10-15  
**Phase**: Phase 01 — Scope baseline and contract freeze  
**Plan**: `plans/261015-1647-android-native-app/plan.md`  

---

## Code Review Summary

### Scope
- Files reviewed:
  - `docs/android-native-acceptance.md` (Scope baseline, 30 included requirements, 9 exclusions, 81 wire contracts, performance & security matrix, gate definitions)
  - `native-app/README.md` (Native project overview, architectural invariants, planned module layout, planned verification commands)
  - `docs/system-architecture.md` (Proposed native client section introduction)
  - `docs/architecture/android-native-client.md` (Proposed architectural specification)
  - `plans/261015-1647-android-native-app/plan.md` (Master implementation plan)
  - `plans/261015-1647-android-native-app/phase-01-scope-baseline-and-contract-freeze.md` (Phase 01 ledger)
  - `plans/reports/qa-261015-1907-phase-01-scope-baseline.md` (QA test report)
- Lines of code analyzed: ~1,200 lines across 7 files.
- Review focus: Phase 01 scope baseline, contract freeze, REST/WS/SSE/Media protocol fidelity, source tree isolation, security, performance budgets, licensing compliance, YAGNI/KISS/DRY.
- Updated plans:
  - `plans/261015-1647-android-native-app/phase-01-scope-baseline-and-contract-freeze.md`
  - `plans/261015-1647-android-native-app/plan.md`

### Overall Assessment
Phase 01 deliverables establish an implementable first-release contract and scope baseline. The acceptance ledger in `docs/android-native-acceptance.md` catalogs 30 included remote features (`A01`-`V01`) and 9 approved exclusions (`B01`-`B09`) with explicit owning phases and observable test journeys. Server wire protocols match authoritative Rust contracts (`router.rs` 21/21 endpoints, `ws_protocol.rs` 60/60 frame kinds) without synthetic additions. Presentation invariants (TERMINAL mode, Traditional terminal only, single top button row, zero floating action buttons, single content area) are rigorously preserved. Source isolation is pristine: zero modifications in `server/`, `apps/web/`, `apps/native/`, `packages/ui/`, or `packages/shared/`. Gate naming has been separated into `GATE-A1` (Scope freeze) and `GATE-A2` (Foundation/toolchain). Runtime/library feasibility remains explicitly gated for Phase 05/18.

---

## Critical Issues
None. No security vulnerabilities, data integrity risks, or breaking changes.

---

## High Priority Findings
None. Wire protocols, cryptographic suites (OPAQUE PAKE), and memory/startup performance budgets are precisely defined.

---

## Warnings List / Medium Priority Improvements
1. **LGPL 2.1 Compliance for AAR Dependencies (Phase 05 Gate)**:
   - *Observation*: `docs/android-native-acceptance.md:280` previously implied that consuming an LGPL library via Gradle AAR constituted dynamic linking. In Android Gradle builds, AAR bytecode is directly merged into APK DEX files, which can implicate LGPL 2.1 section 6 relinking/replacement obligations.
   - *Status*: Remediated in `docs/android-native-acceptance.md:280` by requiring a version-specific licensing audit covering copyright notices, corresponding source, and compliant relinking/replacement mechanisms prior to approving Sora Editor or any LGPL dependency in Phase 05.
2. **Physical Hardware Gate vs Interim Emulator Qualification**:
   - *Observation*: Physical device (Google Pixel 7 ARM64-v8a) availability is noted for Phase 18 qualification, but GATE-B requires real-device proof of terminal/IME and JNI crypto-bridge in Phase 05.
   - *Status*: Remediated in `docs/android-native-acceptance.md:255` to clarify that physical ARM64 hardware confirmation is a prerequisite for completing Phase 05 GATE-B; an Android 15 `x86_64` AVD with 16 KiB page size serves as interim companion, not a substitute.
3. **WebSocket Token Query Parameter Exposure**:
   - *Observation*: Server WS handshake (`docs/android-native-acceptance.md:126`) mandates `GET /ws?token=<bearer_token>` without HTTP header-based bearer extraction support.
   - *Recommendation*: Phase 03 networking layer must configure custom HTTP logging interceptors that redact the `token` parameter from connection URLs to prevent leaking tokens into Android Logcat.
4. **TypeScript Semantic Parity as Hard Gate**:
   - *Observation*: Server lacks an LSP daemon. If client-side TypeScript worker parity is infeasible on Android, this cannot be quietly treated as an approved degraded UX.
   - *Status*: Clarified in Section 6.2 that failure of TypeScript semantic diagnostics is an architectural blocker in Phase 05 requiring an explicit user scope decision.

---

## Suggestions List / Low Priority Suggestions
1. **SSE Capacity Backoff Nonnegative Jitter**:
   - *Observation*: Section 5.4 specifies HTTP 429 Retry-After of 30 seconds for SSE stream cap exhaustion (`HOST_RESOURCE_STREAM_LIMIT`).
   - *Recommendation*: In Phase 15 fallback polling, add nonnegative randomized jitter (`30s + rand(0, 5s)`) rather than symmetric jitter that could retry prematurely before the 30s server window elapses.
2. **Clarify Executable Wrapper Status in README**:
   - *Observation*: `native-app/README.md` lists `./native-app/gradlew -p native-app ...` commands for verification.
   - *Recommendation*: Ensure developers note that `gradlew` wrapper will be generated during Phase 02 setup, preventing execution attempts prior to Phase 02.

---

## Positive Observations
- **Pristine Source Tree Isolation**: Zero modified, deleted, or untracked files across existing server, desktop, web, or shared packages. Existing web/Tauri clients remain untouched.
- **Strict Presentation Invariants**: Fully captures user-mandated restrictions (single top horizontal button row, zero FABs, single content area on phones/tablets/foldables, TERMINAL mode only).
- **Exact Backend Correspondence**: Reuses existing Rust API endpoints and WebSocket frame tags directly without proposing breaking changes or bloated SDK abstractions (KISS/DRY).
- **Comprehensive Cryptographic Security**: Mandates AndroidKeystore AES-GCM wrapping, zero plaintext credentials, OPAQUE PAKE key derivation (`dam-hopper-aes-256-gcm-v1`), and offline private APK release signing custody.
- **Disambiguated Gate Architecture**: Distinct `GATE-A1` (Scope & Contract Freeze) and `GATE-A2` (Gradle Foundation) identifiers prevent confusion between documentation deliverables and future runtime builds.

---

## Recommended Actions
1. [Phase 02]: Proceed with Gradle KMP foundation setup (`GATE-A2`: `gradle/libs.versions.toml`, `settings.gradle.kts`, `shared/`, `androidApp/`, `gradlew` wrapper generation).
2. [Phase 03]: Ensure OkHttp/Ktor logging interceptors redact `?token=` query parameters on `/ws` handshakes.
3. [Phase 05]: Conduct LGPL 2.1 license/relinking compliance audit before adopting Sora Editor or any LGPL dependency.
4. [Phase 05]: Confirm physical ARM64 device availability and configure 16 KiB page size emulator companion before attempting GATE-B qualification.

---

## Validation Commands & Results
- `git status --porcelain server apps/web apps/native packages/ui packages/shared`: Clean (0 lines).
- `git status -s`: Clean isolation; only expected docs, native-app README, and plans updated.
- `node .omp/evcrate/scripts/validate-docs.cjs`: Passed with 0 blocking errors (pre-existing legacy warnings noted).
- QA Test Report (`qa-261015-1907-phase-01-scope-baseline.md`): 4/4 suites passed (Markdown links, source isolation, requirements catalog, wire contracts).

---

## Metrics
- Type Safety: N/A (Documentation & contract freeze phase; 81 enumerated wire contracts match Rust server definitions).
- Test Coverage: 4/4 QA verification suites passed.
- Linting / Format Issues: 0 blocking errors.

---

## Unresolved Questions
1. **Physical Device Acquisition Timing for Phase 05**: Reference physical device Google Pixel 7 (Tensor G2, ARM64) is required for Phase 05 GATE-B terminal/IME and crypto-bridge qualification. Will physical hardware access be established by Phase 05 kickoff, or should Phase 05 proceed under a blocked gate until physical hardware arrives?
2. **LGPL Relinking Strategy for Sora Editor**: If Sora Editor is selected in Phase 05, will distribution rely on shared object / DEX dynamic loading or user-relinkable object archives to satisfy LGPL 2.1 relinking obligations for private APK distribution?
