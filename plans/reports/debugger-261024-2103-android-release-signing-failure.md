# Android release CI failure — run 40100239915

## Executive summary

**Confirmed immediate cause: release signing alias/keystore mismatch.** Android packaging could not find the configured signing alias inside the supplied release keystore. Compilation reached APK packaging; this is not a Kotlin, Rust, Node, SDK, or dependency-resolution failure.

The masked alias visibly carries a trailing space in both the step environment and the exception. **Accidental trailing whitespace in `DAMHOPPER_KEY_ALIAS` is the leading explanation, not conclusively proven:** the true alias and keystore entries are unavailable in public logs, and uploading the wrong keystore secret can produce the same mismatch.

**Priority P1:** Operator verifies the established release signing certificate and its private-key alias, then corrects the mismatched repository secret. Do not regenerate the signing key or fall back to debug signing. No source change is necessary to repair a wrong secret. A small workflow preflight is recommended separately to reject this mismatch before Gradle compilation.

**Status:** Diagnosis complete. No secrets changed, repair applied, build rerun, or resolution claimed. Only this report created.

## Run, failing job, and impact

| Field | Evidence |
| --- | --- |
| Workflow | `Release Android Native App` |
| Run | https://github.com/loidinhm31/dam-hopper/actions/runs/40100239915 |
| Trigger / tag | `push` / `v0.15.0`, attempt 1 |
| Commit | `87c8e96fbec2f64e6135c842abbec33d90dca985` |
| Failing job | `Build Signed Android Release APK`, job ID `120890755742` |
| Failing step | `Assemble Signed Android Release APK`, step 13 |
| Failing Gradle task | `:androidApp:packageRelease` |
| Process result | Exit code 1; `BUILD FAILED in 4m 41s` |
| Impact | Release APK security audit, staging, and artifact upload skipped; no uploaded signed release APK from this job |

`Validate Android Version & Metadata` succeeded. Rust cross-compilation, release signing presence check, Kotlin compilation, and `:androidApp:validateSigningRelease` completed before packaging failed. The diagnostic debug job was skipped, not failed. Temporary release keystore cleanup succeeded.

Local `git rev-parse HEAD` matched the run commit. Source references below are inspected working-tree files; the workflow command observed in the run agrees with the inspected workflow.

## Evidence collected

Commands exercised:

```text
gh run view 40100239915
gh run view --log-failed 40100239915
gh run view 40100239915 --json headSha,headBranch,workflowName,createdAt,startedAt,updatedAt,jobs,url,event,attempt
gh run view 40100239915 --json headSha,createdAt,startedAt,updatedAt,jobs,url --jq '{headSha,createdAt,startedAt,updatedAt,url,jobs:[.jobs[]|{name,conclusion,startedAt,completedAt,failedSteps:[.steps[]|select(.conclusion == "failure")|{name,number,startedAt,completedAt}]}]}'
git rev-parse HEAD
```

An initial metadata query included unsupported JSON fields `path` and `startedTime`; CLI rejected that query. Corrected query above succeeded. This was an investigation CLI error, unrelated to the CI failure.

### Failing command

From `.github/workflows/release-android.yml:182-195`, observed in failed-step logs:

```bash
KEYSTORE_PATH="${RUNNER_TEMP}/damhopper-release.jks"
echo "$KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE_PATH"
chmod 600 "$KEYSTORE_PATH"

cd native/android-app
DAMHOPPER_KEYSTORE="$KEYSTORE_PATH" \
DAMHOPPER_KEY_ALIAS="$KEY_ALIAS" \
DAMHOPPER_STORE_PASSWORD="$STORE_PASSWORD" \
DAMHOPPER_KEY_PASSWORD="$KEY_PASSWORD" \
./gradlew :androidApp:assembleRelease \
  -PappVersion="$VERSION" \
  -PappVersionCode="$VERSION_CODE" \
  --dependency-verification=off
```

Logged version inputs: `VERSION: 0.15.0`, `VERSION_CODE: 1`. Environment line displays `KEY_ALIAS: *** `, including a space after GitHub's masking token.

### Exact failure excerpt

Job/step prefixes omitted; timestamps and masked message text preserved:

```text
2026-10-24T14:02:15.9768655Z > Task :androidApp:packageRelease FAILED
2026-10-24T14:02:20.8769500Z FAILURE: Build failed with an exception.
2026-10-24T14:02:20.8772629Z * What went wrong:
2026-10-24T14:02:20.8773501Z Execution failed for task ':androidApp:packageRelease'.
2026-10-24T14:02:20.8775330Z > A failure occurred while executing com.android.build.gradle.tasks.PackageAndroidArtifact$IncrementalSplitterRunnable
2026-10-24T14:02:20.8778474Z    > com.android.ide.common.signing.KeytoolException: Failed to read key ***  from store "/home/runner/work/_temp/***.jks": No key with alias '*** ' found in keystore /home/runner/work/_temp/***.jks
2026-10-24T14:02:20.8780985Z > Run with --stacktrace option to get the stack trace.
2026-10-24T14:02:20.8784744Z BUILD FAILED in 4m 41s
2026-10-24T14:02:21.3481292Z ##[error]Process completed with exit code 1.
```

**Stack trace availability:** This exception chain is all the run emitted. There are no Java stack frames in the failed-step output because the invocation did not request `--stacktrace`. No stack trace invented or reconstructed. If the corrected credentials still fail, include `--stacktrace` in the next authorized run.

### Timeline (UTC)

| Time | Event |
| --- | --- |
| 13:55:43 | Run created/started |
| 13:55:46–13:55:54 | Version validation job succeeded |
| 13:55:57 | Signed release job started |
| 13:57:39 | Assemble step started; decoded keystore and invoked Gradle |
| 14:00:01 | `:androidApp:validateSigningRelease` logged |
| 14:01:10–14:01:30 | Shared and app Kotlin compilation advanced successfully |
| 14:02:15 | `:androidApp:packageRelease FAILED` |
| 14:02:20 | Alias-not-found `KeytoolException` emitted |
| 14:02:21 | Assemble step ended with exit code 1 |
| 14:02:24 | Release job completed as failure |

## Root cause and propagation

1. `.github/workflows/release-android.yml:161-172`: `Enforce Release Signing Custody` verifies only that four secrets are nonempty. It does not validate their relationship. A wrong alias, or alias with an accidental suffix, passes.
2. `.github/workflows/release-android.yml:178-195`: Keystore is decoded from `DAMHOPPER_KEYSTORE_BASE64`; `DAMHOPPER_KEY_ALIAS` is mapped to `KEY_ALIAS` and passed unchanged to Gradle. Shell quoting preserves whitespace; it does not create it.
3. `native/android-app/androidApp/build.gradle.kts:29-49`: `System.getenv("DAMHOPPER_KEY_ALIAS")` takes precedence over the `damhopperKeyAlias` project property. The value is assigned verbatim through `keyAlias = keyAliasName` at line 47. An environment secret correction, not a property override, is required for this workflow.
4. `native/android-app/androidApp/build.gradle.kts:121-145`: Custom release guard verifies file existence and nonblank credential fields, not keystore contents or alias identity. A nonblank but incorrect alias passes.
5. During `:androidApp:packageRelease`, Android Gradle Plugin attempts to obtain the configured signing key. The keystore has no key under that alias, so packaging fails with `KeytoolException`.

**Proven:** The supplied alias did not resolve to a key in the supplied keystore. **Strong inference:** the visible space after `***` is accidental secret whitespace contributing to the mismatch. **Not established:** actual expected alias, whether the keystore secret is the intended release keystore, or whether key-password recovery would succeed after alias correction.

Do not interpret `validateSigningRelease` success as proof that the alias/private key pair is usable; this run shows the key lookup failed later.

## Concrete corrective actions

### P1 — repair signing configuration at its source

A trusted signing-key custodian should:

1. Inspect the authoritative existing release keystore in a secure local terminal, not CI logs. For example, `keytool -list -v -keystore "$KEYSTORE_PATH" -storepass:env STORE_PASSWORD` lists aliases and entry/certificate details without a password argument value. Supply the environment variable securely.
2. Identify the intended `PrivateKeyEntry` and verify its certificate SHA-256 fingerprint against the established release signing certificate / previously distributed trusted release APK. Do not merely select any alias that exists.
3. If the supplied keystore is correct, replace repository secret **`DAMHOPPER_KEY_ALIAS`** with the exact intended alias, removing accidental whitespace only if it is not part of the authoritative alias. If the keystore is wrong, restore **`DAMHOPPER_KEYSTORE_BASE64`** from the intended existing keystore instead. Ensure store/key password secrets correspond to that same key.
4. Keep private keys and passwords out of source control and logs. Do not blindly trim passwords or silently normalize alias values in Gradle. Do not generate a replacement key or use debug signing.
5. Rerun failed jobs after correcting the secret. A secret-only repair can use the existing tagged workflow. Confirm signed assembly, existing APK security audit, staging, and upload all succeed, and verify final APK certificate continuity against the expected fingerprint.

**Repository files required for immediate repair:** None if the defect is solely the mismatched repository secret.

### P2 — optional targeted early failure in the existing workflow

**File:** `.github/workflows/release-android.yml`, inside `Assemble Signed Android Release APK`, after decoded-keystore permissions at lines 183–185 and before Gradle at lines 187–195.

Recommended early alias-access check:

```bash
if ! keytool -list \
  -keystore "$KEYSTORE_PATH" \
  -storepass:env STORE_PASSWORD \
  -alias "$KEY_ALIAS" >/dev/null 2>&1; then
  echo "::error::Release signing keystore/alias validation failed. Verify the signing secrets against the established release key."
  exit 1
fi
```

The step already supplies `STORE_PASSWORD` and `KEY_ALIAS`. Keep the existing `always()` keystore cleanup. Avoid printing keystore contents or raw tool diagnostics. This check catches keystore access/alias failures earlier; it does **not** prove entry type, key-password recovery, or expected certificate identity and does not replace signed packaging or the security audit.

**Gradle file:** `native/android-app/androidApp/build.gradle.kts` explains propagation but needs no change for a correctly configured secret. Do not add trimming as a substitute for fixing the signing configuration.

**Documentation if preflight is implemented:** Update release-signing operator guidance in `native/android-app/README.md` to specify exact alias handling, expected certificate continuity, and secure troubleshooting. No implementation or documentation change beyond this diagnosis report performed here.

## Noncausal observations and validation limits

- Node 20 action deprecation / forced Node 24 notices, `setup-java@v4` deprecation, Ubuntu runner migration notice, Gradle 9 compatibility warnings, Kotlin expect/actual warnings, always-true conditions, and native-library strip warnings are not the reported failure. No toolchain upgrade recommended for this incident.
- Actual observed Java: Temurin 21.0.12; Gradle: 8.11.1. The workflow separately requests Node 20 at `.github/workflows/release-android.yml:132-135`; action-runtime Node 24 notices do not establish that every workflow command used Node 24.
- No local build/tests, CI rerun, secret mutation, or post-fix APK audit executed. Collected evidence is the existing failed run plus source inspection.
- Fixing this alias mismatch does not establish that later audit steps or all Android release qualification gates will pass.

## Unresolved questions

1. What is the exact authoritative private-key alias and expected release certificate fingerprint? Masked CI logs cannot establish them.
2. Is the supplied keystore the intended release keystore, and is the visible alias suffix accidental whitespace? Trusted operator inspection required.
3. After correcting the alias/keystore pair, do private-key recovery, release packaging, APK security audit, and certificate-continuity verification succeed? Not rerun in this diagnosis.
