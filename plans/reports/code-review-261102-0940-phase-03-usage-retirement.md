# Code Review — Phase 03: P0b Usage Retirement

## Code Review Summary

**Score: 7/10 — changes required; not release sign-off.**

Server/web/Android retirement is largely a clean deletion, not a compatibility layer. No Critical vulnerability found in inspected changes. One High security/performance regression in the Android SSE adjustment; V6 documentation and release-evidence acceptance remain incomplete. Passing targeted tests does not close those findings.

### Scope

- Reviewed working-tree Phase 03 changes against `plans/261101-1738-ai-dev-os-redesign/phase-03-usage-retirement.md` and `acceptance.md:7-9,43-48`.
- Read product requirements, code standards, published development rules and `code-review` skill directly.
- Change inventory: 147 tracked changed files, +106/-15,998 lines at initial inspection; new `db_paths.rs` and `usage_retirement.rs` reviewed separately. Approximately 2,500 relevant code/test/context lines inspected; deletion inventories and removed-test boundaries additionally inspected. Not a line-by-line audit of every deleted implementation.
- Ownership: review/report only. No implementation, operator deletion, publication, or plan/task-state edits. Main retains plan reconciliation and final verification ownership.

## Critical Issues

- **None identified.** This is not a claim that unexecuted production/platform gates passed.

## Warnings / Findings

### W1 — High: SSE fix removes the pre-allocation bound

**Evidence:** `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/HostResourceSseClient.kt:104-107,148-167`; overflow test at `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/host/HostResourceModelsTest.kt:124-149`.

`readUTF8Line(MAX_DATA_EVENT_BYTES)` became `readUTF8Line()`. Installed Ktor 3.1.0 bytecode confirms the omitted limit defaults to **2,147,483,647**. The event cap runs only after a complete line has been buffered, converted to a String, sliced, and encoded again. A huge or unterminated `data:`, comment, or unknown-field line can therefore consume the Android heap before rejection. The 300,000-character test passes by allocating the oversized line, not by proving bounded parsing. Existing socket timeout does not limit memory for continuously arriving bytes.

**Impact:** Remote-stream denial of service when this client is used. Current three-screen Android root does not mount the panel-shell SSE client (`docs/code-standards.md:59-60`), which limits current reachability, not the defect in retained functionality.

**Correction:** Keep a finite transport-level bound. If oversized frames must be skipped and streaming resumed, discard oversized lines/events incrementally with bounded storage, clear pairing state, and resume only at a verified event boundary. Otherwise terminate the stream explicitly on oversize and allow existing fallback behavior; do not merely raise/remove the limit. Preserve valid maximum-sized payloads including SSE framing overhead. Add boundary/unterminated-line coverage that verifies bounded reading, not just non-emission.

**Confidence:** High; source plus installed dependency bytecode. No OOM experiment performed.

### W2 — Medium: V6 scrub leaves live Usage authority in current docs

**Evidence:**

- `docs/codebase-summary.md:105-106`: deleted repositories/controllers/screens and Fleet/Usage switcher still described as current.
- `docs/android-native-acceptance.md:745,784,787`: deleted Usage implementations and qualification remain advertised.
- `docs/architecture/preferences-settings-and-host-resources.md:1-8,21-24,36-49,78-82`: maintained specification still defines Usage setup/storage/page/polling, queries and source map.
- `docs/project-overview-pdr.md:40,103,106`: removed Usage remains a product requirement/current implementation.
- `docs/frontend-components.md:12`, `docs/frontend-components/workbench.md:194-197`, `docs/user-guide-multi-server-profiles.md:279-280`: removed settings/routes still documented.
- `docs/project-roadmap.md:18,21`, `docs/testing.md:255`, `native/android-app/README.md:165`: stale feature/test/file claims.
- `docs/architecture/authentication-state-and-cryptography.md:134`: startup still said to check collision with retired telemetry state; actual `main.rs` now checks session only.

**Impact:** Fails explicit phase V6 acceptance (`phase-03-usage-retirement.md:13,411-417`); users and future implementers are directed to nonexistent behavior. `docs/CHANGELOG.md` itself was scrubbed of feature-specific Usage/OTLP entries with no new Usage entry in the inspected diff/search; that narrower success is not a complete docs scrub.

**Correction:** Remove retired-feature prose and source entries from maintained documents, retaining host metrics, Traditional/runtime usage-mode, remote Git SSH, and unrelated terminology. Some omissions are outside the plan's literal writable list: coordinator should reconcile ownership before assigning the additional docs, not silently declare V6 complete. `docs/archive/CHANGELOG-v1.md:25-35` also retains feature history; whether historical archives are included in V6's history scrub is a remaining scope question, not needed to establish this finding.

**Confidence:** High.

### W3 — Medium: deleting the two desktop guides breaks retained documentation links

**Evidence:** deleted `docs/native-browser-debug-support.md` and `docs/architecture/native-ssh-forwarding.md`; inbound links remain in:

- `docs/README.md:34`
- `docs/project-overview-pdr.md:37`
- `docs/project-roadmap.md:56`
- `docs/frontend-components/platform-integrations.md:63`
- `docs/api/system-services.md:120`
- `docs/architecture/agent-store-ports-and-browser.md:66`
- `docs/user-guide-multi-server-profiles.md:187`
- `docs/CHANGELOG.md:662,681`

**Impact:** Documentation navigation now resolves to deleted files; violates phase requirement to fix links while preserving separate Tauri/SSH retirement handling.

**Correction:** Point retained Browser Debug material to an existing current web architecture/component guide; remove dead historical-guide links while retaining concise Tauri/SSH retirement notices. Do not restore retired implementation docs or introduce redirect shims just to hide broken links.

**Confidence:** High; deletion inventory and inbound-reference search.

### W4 — High acceptance/evidence gap: P0 receipt overstates qualification and does not establish shipment

**Evidence:** `plans/261101-1738-ai-dev-os-redesign/reports/p0-release.md:6-7,13,25-47` claims delivered/qualified preparation, but provides no frozen-source identifier/artifact digest, publication/install receipt, or actual stopped-writer/manual-deletion result. Its “cleanup receipt” is only a future operator command. Line 35 attributes nine-location verification to a checker that reads only `server/Cargo.toml` and `apps/web/package.json` (`deploy/release/check-version-alignment.mjs:90-106`); other version paths require separate evidence.

The inspected tester report explicitly limits its evidence to working-tree targeted checks, not an isolated source-pinned P0 artifact (`plans/reports/tester-261102-0925-phase-03-usage-retirement.md:105-113`). Phase acceptance requires an independently shipped P0 artifact and operator receipt, not tests/version edits alone (`acceptance.md:7-8,43-48`).

**Impact:** Phase completion/release claims could be made without the required operational and reproducibility gates. This is not evidence that installation failed; it is missing evidence that it occurred.

**Correction:** Label receipt as preparation/qualification pending until actual gates have evidence. Record frozen source/artifact identity, command outputs and scope, publication/install result, and authorized human cleanup result. Keep operator-only actions human-owned; do not perform external deletion or invent a receipt. The nine version values are aligned to 0.15.6 by this review's static inspection, but the alignment command alone does not prove that breadth.

**Confidence:** High for missing evidence and checker scope.

### W5 — Medium: new “startup” regression does not exercise startup or its claimed paths

**Evidence:** `server/tests/usage_retirement.rs:26-29,209-220` constructs `AppState`/router without launching `main`, isolates neither HOME nor XDG config, and checks only the workspace temporary directory. It checks `telemetry-key`, not the authorized historical `telemetry-hmac-key`. No check observes listener 4811, reads of exporter/user data, or preservation of pre-existing exporter files.

**Impact:** The named startup/privacy regression can pass even if binary startup creates a collector in HOME or mutates exporter config. It does not satisfy phase's no4811/startup no-read/no-write proof. The 404, legacy TOML/PUT and Unix link-alias tests are useful and should remain.

**Correction:** Add hermetic binary-startup evidence with child-process HOME/XDG paths, legacy-enabled config and pre-existing sentinels; check exact protected paths unchanged and no collector listener. For the “never reads” claim, use appropriate access observation/instrumentation or source-audit evidence rather than absence-of-file assertions. Include authenticated route probes and embedded-web fallback as release qualification; current source retains `/api` 404 isolation (`router.rs:594-601`).

**Confidence:** High; test structure directly inspected.

## Suggestions

1. **Low — remove obsolete normalizer, not a new compatibility abstraction.** `server/src/config/global.rs:137-159` still recognizes and normalizes telemetry JSON. It is now unreachable from typed `GlobalConfig.server: ServerConfig` (`schema.rs:1248-1256`), which no longer serializes that field. Delete branch/function as dead feature-only code. Legacy unknown-key tolerance already follows ordinary Serde behavior.
2. **Low — finish surgical stale-comment/test-name cleanup.** `server/src/api/tests.rs:132-133` references removed telemetry isolation; `server/src/auth/config.rs:669-708` still labels a generic second collision fixture telemetry. Retain collision assertions, use neutral fixture labels.
3. **Low — keep relocated API example faithful.** `docs/api/rest-endpoints.md:735-753` omits required `source` from its agent status row; `server/src/agent_status/types.rs:280-298` requires it. Include it or label the example explicitly partial; avoid weakening real DTOs.

## Positive Observations

- Runtime/collector/exporter owner code is deleted rather than moved into migration/cleanup machinery. No new migration shim or user-data mutation path found in inspected changes.
- Both telemetry-specific config guards removed; `ServerConfig` naturally ignores unknown legacy keys. Idle-suspend protection remains in the config handler.
- Neutral DB helper preserves previous canonicalization and Unix inode/Windows file-identity branches. Auth startup still checks its session database collision; only retired active telemetry entry dropped.
- Web retirement reaches DTOs, API methods, REST alias mapping, query hooks/keys, route, Settings, Dashboard and navigation. Android reaches active ViewModel and inactive panel-shell lifecycle callers; no live Usage client references found by targeted search.
- Dedicated retired tests removed without weakening inspected retained Git/auth/session test assertions. Generic legacy Android config roundtrip retained.
- Changes mostly reduce executable surface and polling/background work; architecture follows KISS/YAGNI. SSE limit removal is the material performance/security exception.

## Reviewed Files

- **Server core:** `server/src/{main.rs,lib.rs,state.rs}`, `auth/config.rs`, `utils/{db_paths.rs,mod.rs}`, `config/{schema.rs,parser.rs,replacement.rs,mod.rs,tests.rs,global.rs}`, `api/{config.rs,router.rs,mod.rs,tests.rs,resource_events.rs}`, `persistence/restore.rs`, `pty/tests.rs`, `server/Cargo.toml`; removed telemetry/API modules inventoried and original path helper compared against `HEAD`.
- **Server callers/tests:** `server/tests/usage_retirement.rs`; constructor diffs across `server/tests/{auth_lite_mode,auth_mfa_api,auth_no_auth,browser_debug_artifacts,fs_mutate,fs_upload,fs_write_streaming,git_blame_api,git_commit_message_api,git_conflict_discovery_api,git_conflict_operation_api,git_leased_publish_api,git_squash_api,host_resource_baseline,host_resource_events,idle_suspend,idle_suspend_phase07,plans_api,session_changes_api,session_changes_lifecycle,settings_import_export,transport_enforcement_phase03,workflow_api,ws_client_presence,ws_fs_subscribe}.rs`, `common/auth_fixtures.rs`, `examples/agent_free_consent_fixture.rs`, `scripts/qualify-phase09-workbench.mjs`.
- **Android:** `NativeWorkspaceViewModel.kt`, `HostResourceSseClient.kt`, `ResourcesUnifiedPanelScreen.kt`, `SettingsHostView.kt`, `WorkbenchScreen.kt`, `OwnershipAndReplayTests.kt`, `HostResourceModelsTest.kt`; eight Usage implementations/two JVM test deletions inventoried; `RemoteConfigEditorTest.kt` legacy-roundtrip assertions searched.
- **Web:** `packages/ui/src/api/{client.ts,queries.ts,queries.test.ts,query-client.ts,ws-transport.ts,ws-transport.test.ts}`, `components/pages/{SettingsPage.tsx,SettingsPage.test.tsx,DashboardPage.tsx}`, `lib/{navigation.ts,navigation.test.ts}`, `embed/dam-hopper-app.tsx`; Usage page/component/browser-test deletions inventoried.
- **Docs/release:** `README.md`, `docs/{project-overview-pdr.md,code-standards.md,CHANGELOG.md,android-native-acceptance.md,codebase-summary.md,system-architecture.md}`, `docs/api/rest-endpoints.md`, `docs/configuration/server-runtime-settings.md`, `docs/frontend-components/host-and-usage.md`, `docs/architecture/preferences-settings-and-host-resources.md`; additional reference-search evidence listed under W2/W3. `scripts/release-version-manifest.mjs`, `deploy/release/check-version-alignment.mjs`, nine synchronized version paths, phase/acceptance/P0 receipt and tester report.

## Validation Commands / Results

**Reviewer-executed inspection, not builds/tests:** `git diff --stat`, `git status --short`, scoped `git diff -- <paths>`, original helper via `git show HEAD:server/src/telemetry/runtime.rs`, specialized source/reference searches, and `javap -classpath <installed ktor-io-jvm-3.1.0.jar> -c io.ktor.utils.io.ByteReadChannelOperationsKt`. Result: deletion scope confirmed; nine retained version locations show 0.15.6; V6/link audit found W2/W3; Ktor default limit confirmed. Dependency `hashbrown 0.15.5` in Cargo.lock is unrelated and not a release-version mismatch.

**Existing tester evidence, not rerun by reviewer:** `plans/reports/tester-261102-0925-phase-03-usage-retirement.md:35-113`:

| Command | Reported result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test usage_retirement` | PASS: 5 tests |
| `cargo test --manifest-path server/Cargo.toml --test auth_no_auth --test auth_lite_mode --test settings_import_export` | PASS: 28 tests |
| `pnpm --filter @dam-hopper/ui exec vitest run src/api/queries.test.ts src/api/ws-transport.test.ts src/components/pages/SettingsPage.test.tsx src/lib/navigation.test.ts` | PASS: 4 files, 78 tests; non-failing jsdom navigation warnings |
| `pnpm android:test` | PASS, 8 tasks up-to-date (cached) |
| `node scripts/run-gradle.mjs :shared:jvmTest --rerun-tasks` (Android cwd) | PASS, 8 executed tasks; overflow test passes; prior bounded-reader failure retained in tester report |
| `node deploy/release/check-version-alignment.mjs` | PASS: v0.15.6; checks server/web only |

Full build/typecheck/lint, full backend/browser suites, Android application compilation, isolated live daemon/no4811 checks and source-pinned release qualification were not run by this reviewer; final verification belongs to Main. Broad build/test claims in the P0 receipt were not independently substantiated by the inspected targeted tester report.

### Completeness / Metrics

- Server/web/Android cutover: substantially implemented; startup/no4811 proof incomplete, SSE regression open.
- V6 docs: incomplete. Primary CHANGELOG scrub observed; current documentation and links still fail contract.
- Manual cleanup/release: no actual operator/publication/install receipt established.
- Version: nine retained synchronized paths statically aligned to **0.15.6**.
- Plan task status intentionally unchanged under review-only/no-TODO-tracking ownership; report supplies findings for Main reconciliation.
- Type coverage and test coverage percentages: not measured. Lint issue count: not measured. No fabricated percentages or whole-suite pass claim.

## Recommended Actions

1. Fix W1 without unbounded reads; retain overflow semantics and add meaningful boundedness regression.
2. Complete V6 scrub and repair links (W2/W3); remove obsolete normalizer.
3. Replace misleading startup assertions with hermetic runtime/access evidence (W5).
4. Correct P0 receipt scope/status, run Main-owned final gates, and record actual artifact/operator/publication evidence before closing release tasks (W4).

## Unresolved Questions

- Does V6 history scrub extend to `docs/archive/CHANGELOG-v1.md`, or only the primary maintained CHANGELOG? Maintained-doc failures are definite regardless.
- Where are the frozen P0 artifact/source digest, full qualification evidence and actual installation/publication/operator receipts? They are absent from the inspected receipt; do not infer completion.
