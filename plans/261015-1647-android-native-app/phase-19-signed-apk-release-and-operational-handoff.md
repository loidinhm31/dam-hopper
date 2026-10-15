# Phase 19 — Signed APK release and operational handoff

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 18](./phase-18-integrated-device-security-and-performance-qualification.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: GATE-D; private Android release.
- Goal: Deliver a signed installable private APK with secure upgrade/release documentation and truthful compatibility evidence.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

## Key Insights

- Existing13-file version-alignment invariant belongs to server/web/Tauri; do not silently modify it for Android.
- Private distribution avoids Play launch scope but not native-device/security/signing/license correctness.

## Requirements

- Deterministic release assembly/signing, protected key custody, monotonic versionCode, hash/license/build metadata.
- Fresh install and same-key upgrade of release APK with R8/JNI/security checks on supported devices.
- Native-specific build/run/check/release commands, runbooks, architecture/PDR/testing/changelog updates; no Tauri retirement.

## Architecture

Release artifact is produced by native-app Gradle using environment/CI-secret supplied signing, with independent Android version policy and explicit server compatibility. Existing product build/version scripts remain intact unless separately reviewed integration changes are necessary.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/README.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/package.json`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/deployment-guide.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/project-overview-pdr.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/system-architecture.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/testing.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/deploy/release/check-version-alignment.mjs`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/build.gradle.kts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/README.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/scripts/verify-release-apk.sh`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/.github/workflows/android-native.yml`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/package.json`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/android-native-deployment.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/android-native-acceptance.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/project-overview-pdr.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/testing.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/CHANGELOG.md`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Configure release signing from secret/environment inputs, fail closed when missing, document key backup/rotation consequences and never include keystore/passwords in repo/artifacts.
2. Assemble both supported ABI release outputs with verified dependencies, minification/keep rules and reproducible metadata; validate JNI/editor/crypto code paths under release optimization.
3. Verify signature/certificate, package/application identity, min/target SDK, manifest exports/backup/cleartext, browser-engine absence, licenses and native page-size alignment using actual packaged artifacts.
4. Install signed APK cleanly and upgrade an earlier same-key Android build; verify versionCode policy, profiles/vault readability, migration/failure recovery and no secret backup extraction. Uninstall/reinstall behavior documented without promising token survival.
5. Publish private artifact with SHA256, app version/build provenance, tested server/protocol/device/ABI/page matrix, release notes and unresolved non-blocking limitations; no untested desktop/Play/full-preview claims.
6. Add unambiguous native-app:* root commands and Android CI entrypoint; retain existing Tauri android:* and desktop commands unchanged unless a separate cutover is explicitly approved. Keep existing13-file version check passing; Android independent version declared separately.
7. Update current architecture/PDR/code/test/deploy guidance and changelog to observed implementation, converting proposed status only where actual features passed. Include side-by-side coexistence/rollback-to-previous-APK policy and no Tauri retirement.
8. Deliver final requirement/evidence manifest and operator/developer handoff; mark implementation phases completed only after their own gates and GATE-D actual install/upgrade pass.

## Todo List

- [ ] Produce and verify signed release APK and install/upgrade evidence.
- [ ] Publish private artifact/license/provenance and native runbooks.
- [ ] Verify existing product commands/version invariant remain intact.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

## Success Criteria

- Signed release APK installs/upgrades and exercises native terminal/editor/crypto/media on supported devices after optimization.
- No signing secret/browser engine/debug cleartext or secret backup path ships; exact artifact hash and license/provenance included.
- Documentation and compatibility claims match observed evidence; existing web/Tauri products and version alignment remain valid.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Lost signing key prevents normal upgrades; custody/backup is a release prerequisite.
- R8/JNI/reflective native widget behavior may differ from debug; debug proof cannot substitute signed release smoke.

## Security Considerations

- Use apksigner/signing verification and secret-free CI logs/artifacts; no auto-upload of diagnostics.
- Rollback may require data compatibility/uninstall with data loss; document exact supported path, not unsafe downgrade promises.

## Next Steps

Release handoff only. Desktop implementation, browser preview parity and Tauri retirement require separate explicit plans/decisions.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.
