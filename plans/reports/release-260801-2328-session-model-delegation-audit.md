# Session Model Delegation Audit — Release-Gate Evidence

Date: 2026-08-01 (Asia/Saigon)
Scope: Phase 07; Codex 0.146.0 flat OTel-only fallback.

## Confirmed behavior

- Exact app-server lineage remains disabled. The pinned 0.146.0 schema probe confirms `thread/list` has no content projection and retains the privacy-gate failure.
- OTel-only session rows remain flat and expose `lineage_unavailable`; no parent/child lineage is inferred.
- Terminal correlation remains separately opted in and opaque markers remain transient.

## Validation evidence

| Gate | Evidence | Result |
| --- | --- | --- |
| Rust suite | `cargo test` and `pnpm test` | 543 unit tests plus 56 executable integration tests passed; the default run leaves one manual pinned-contract probe ignored. |
| Pinned Codex contract | `CODEX_BIN="$(command -v codex)" cargo test --test codex_app_server_compatibility -- --ignored` | 1/1 manual 0.146.0 schema probe passed. |
| Privacy/API canaries | Focused privacy, session-protection, and aggregate-privacy tests; scoped static scan | Passed; no raw marker, provider ID, fixture secret, Codex session/rollout path, or resource-attribute value found outside deliberate test assertions. |
| Performance | 100k aggregate, summary/root-list, and legacy tree-detail tests | 4/4 passed, including indexed-query-plan assertions and the <200 ms p95 threshold. |
| UI unit | `pnpm --filter @dam-hopper/ui test` | 138 files / 752 tests passed. |
| Chromium UI | `pnpm --filter @dam-hopper/ui test:browser` | 16 files / 70 tests passed. |
| Alias/marker host smoke | Bash alias invokes installed Codex 0.146.0 while the opaque resource marker is inherited | Passed. |

## Command ledger

- `cargo test` — 543 unit tests passed; 56 executable integration tests passed; 1 manual Codex probe intentionally ignored.
- `pnpm --filter @dam-hopper/ui test` — 138 files / 752 tests passed.
- `pnpm --filter @dam-hopper/ui test:browser` — 16 files / 70 tests passed.
- `cargo test telemetry::privacy::tests::content_scan_rejects_fixture_secret --lib`, `cargo test api::tests::usage_sessions_are_protected_reconcile_and_exclude_private_fields --lib`, and `cargo test api::tests::usage_summary_requires_auth_and_never_exposes_event_fields --lib` — 3/3 passed.
- `! rg -n -i --hidden --glob '!node_modules' --glob '!target' --glob '!*.lock' --glob '!**/*.test.*' --glob '!server/src/telemetry/store.rs' --glob '!server/tests/codex_app_server_compatibility.rs' -e 'fixture-secret-token' -e 'dam_hopper\\.run_id=[A-Za-z0-9_-]{16,}' -e '/[h]ome/.+/.codex/(sessions|rollout)' -e 'OTEL_RESOURCE_ATTRIBUTES[=][^[:space:]]+' server packages docs plans/260801-1455-session-model-delegation-audit` — 0 matches. Runtime canaries exercise redacted marker output, persist no marker environment, protected API payloads, and retention storage.
- `CODEX_BIN="$(command -v codex)" cargo test --test codex_app_server_compatibility -- --ignored` — pinned schema probe passed. The Bash alias smoke verified the resource marker before evaluating `CODEXNSB` as `codex --version`.
- `pnpm lint` — passed with no warnings; `pnpm build` — passed with no Vite warnings.
- `pnpm exec prettier --check .` — passed. `pnpm check` — passed without warnings; its native stage packages Debian/RPM artifacts, matching the supported Linux release packages.

## Performance receipt

Release host: Linux 7.1.4-204.fc44.x86_64, AMD Ryzen 7 8840U with Radeon 780M, 16 CPUs.

| Test | Measured p95 |
| --- | ---: |
| 100k command aggregate | 88.064825 ms |
| 100k summary list | 1.236625 ms |
| 100k root-list API | 8.473889 ms |
| 100k legacy tree-detail API | 155.327530 ms |

The tree-detail fixture is deliberately legacy-shaped and marked `lineage_unavailable`. It proves the read path is bounded without permitting production OTel ingestion to infer a hierarchy. Migration 005 adds the root/parent/order frontier index used by its query-plan assertion.

## Environment limits

- Bash and `codex-cli 0.146.0` are installed.
- Zsh and Fish are not installed, so those external-shell checks remain unavailable and are not counted as passing coverage.
- ESLint, Prettier, and web/browser-extension production builds passed without warnings. The native release workflow intentionally produces Debian and RPM packages; AppImage is not a project release target, and its third-party `linuxdeploy` binary is incompatible with the Fedora 44 validation host.

## Unresolved questions

- None for the supported flat fallback. Future exact-lineage support requires a new pinned, metadata-only Codex app-server contract.
