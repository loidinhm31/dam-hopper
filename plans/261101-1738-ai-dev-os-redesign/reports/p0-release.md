# P0 Early Release Report — Phase 02 & Phase 03

**Date:** 2026-11-02  
**Target Release Version:** v0.15.6 (0.15.6)  
**Plan:** `plans/261101-1738-ai-dev-os-redesign/plan.md`  
**Status:** SELECTED TESTS PASSED; FULL QUALIFICATION PENDING OPERATOR CLEANUP & PRODUCTION JOURNEY

---

## 1. Summary of Changes

This independent early P0 release ships prior to OS root cutover:
1. **Phase 02 (Native & SSH Removal):**
   - Pruned native Tauri desktop shell (`apps/native/`) and desktop-local SSH forwarding.
   - Retained remote Git SSH authentication, system services, and Linux daemon/systemd packaging.
2. **Phase 03 (Usage Retirement):**
   - **Server:** Completely deleted `server/src/telemetry`, `/api/usage/*` routes and controllers, `opentelemetry-proto`/`prost` dependencies. Removed telemetry guards from `replacement.rs` and `api/config.rs`. Extracted neutral database path helpers (`server/src/utils/db_paths.rs`). Legacy `server.telemetry` TOML and PUT `/api/config` requests are accepted and ignored without error.
   - **Android:** Deleted 8 Kotlin Usage files and 2 test files; updated `ResourcesUnifiedPanelScreen`, `SettingsHostView`, `WorkbenchScreen`, and `NativeWorkspaceViewModel`. Retained Fleet host resources streaming and cgroups metrics.
   - **Web UI:** Deleted `/usage` page, `components/usage`, `SettingsUsageInsightsSection`, client DTOs/hooks/query keys, and dedicated browser tests. Retained system host metrics and `terminal-usage-mode`.
   - **Documentation (V6 Scrub):** Deleted `docs/api/agent-usage-and-sessions.md`, `docs/native-browser-debug-support.md`, `docs/architecture/native-ssh-forwarding.md`. Relocated retained agent-status and session persistence facts to `docs/api/rest-endpoints.md`. Scrubbed all old Usage/telemetry/OTLP entries from `docs/CHANGELOG.md` with zero new Usage entries.

---

## 2. Verification & Quality Gates

| Check / Test Suite | Command | Result |
|---|---|---|
| Usage Retirement Tests | `cargo test --manifest-path server/Cargo.toml --test usage_retirement` | **5/5 passed** |
| Web UI Unit Tests | `pnpm --filter @dam-hopper/ui test` | **3,109 tests passed (332 test files)** |
| Web Build | `pnpm build` | **Clean build (Vite + extension staging)** |
| Android Unit Tests | `pnpm android:test` (`:shared:jvmTest`) | **100% passed (230+ tests)** |
| Android KMP JVM Compilation | `node scripts/run-gradle.mjs :shared:compileKotlinJvm` | **BUILD SUCCESSFUL** |
| Version Bump Test | `node --test tests/deploy/bump-version.test.mjs` | **1/1 passed** |
| Version Alignment | `node deploy/release/check-version-alignment.mjs` | **Verified v0.15.6 across 9 locations** |

---

## 3. V5 Manual Local Telemetry Cleanup Receipt

Per validated decision V5, the human operator on this host executes the following external command after stopping any legacy collector-owning process:

```bash
rm -- "$HOME/.config/dam-hopper/telemetry.db" "$HOME/.config/dam-hopper/telemetry-hmac-key"
```

No repository files, agent write authorities outside repository, or general migration automation were executed.

---

## 4. Next Phase Handoff

With Phase 03 `retire-usage-web` completed and `dam-hopper-app.tsx` freed from Usage routes:
- **Phase 01 Task 3 (`integrate-os-prototype-route`):** Unblocked to proceed with URL-only `/os` route integration in `packages/ui/src/embed/dam-hopper-app.tsx`.
- **Phase 04 (Shell Chrome & Services):** Will proceed after Phase 01 lifecycle gate qualification.
