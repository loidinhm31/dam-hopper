# Code Review: Fix plugin admin profile binding and Linux installer identity conflict

## Score: 8.5/10

Target changes cleanly address the root causes identified in debugging: restoring active-profile bearer token fallback for null settings selections, classifying typed API errors without false "not an administrator" banners, enforcing distinct identities between API service and plugin runner, adding early installer warning, and updating Linux operator guides.

---

## Reviewed Files
1. `packages/ui/src/api/server-config.ts` (15 additions, 8 deletions)
2. `packages/ui/src/api/server-config.test.ts` (41 additions, 2 deletions)
3. `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx` (59 additions, 19 deletions)
4. `packages/ui/src/components/pages/settings-page/PluginManagementSection.test.tsx` (30 additions, 2 deletions)
5. `server/src/linux_release/account.rs` (2 additions, 2 deletions)
6. `server/tests/linux_release_plugin_runner.rs` (1 addition, 1 deletion)
7. `deploy/release/dam-hopper-install.sh` (15 additions, 0 deletions)
8. `docs/plugin-platform-linux.md` (44 additions, 4 deletions)

---

## Critical Issues (MUST FIX)
*None.* No security regressions, credential leaks, or breaking architectural issues identified.

---

## Warnings (SHOULD FIX)

### 1. Test Coverage Gap in `PluginManagementSection.test.tsx`
- **Location**: `packages/ui/src/components/pages/settings-page/PluginManagementSection.test.tsx`
- **Issue**: Phase 1, Item 4 of plan explicitly specified:
  > "mock two saved profiles with different tokens and active ID; assert no explicit prop uses active server URL and Bearer token on `/api/auth/status`, explicit prop uses only selected profile; switching profile clears stale role/installations."
  While tests for `BearerRequired` and 503 `RunnerUnavailable` were added, tests verifying profile switching, state clearing, and active vs explicit `profileId` propagation to `checkAuthStatus` were omitted in the component test file.
- **Remedy**: Add unit test in `PluginManagementSection.test.tsx` mocking `getProfiles()`, `getActiveProfileId()`, and `getAuthToken()`, re-rendering with switched `profileId` or changing active profile, asserting stale installations/status clear and correct bearer token sent.

### 2. Orphaned Token Endpoint Binding Check on Explicit ID in `getAuthToken`
- **Location**: `packages/ui/src/api/server-config.ts:278-304`
- **Issue**: In `getAuthToken`:
  ```ts
  // For an active ID absent from available profiles, fail closed rather than expose an orphaned token.
  if (!explicitId && profilesResult.status === "available" && !currentProfile) {
    return null;
  }
  ```
  If `explicitId` is passed for an ID absent from available profiles (`profilesResult.status === "available" && !currentProfile`), execution proceeds to check `v2Raw`. At lines 294-302:
  ```ts
  if (
    currentProfile &&
    parsed.serverUrl &&
    (normalizeServerUrl(currentProfile.url) !== normalizeServerUrl(parsed.serverUrl) ||
      currentProfile.authType !== parsed.authType)
  ) {
    return null;
  }
  return parsed.token;
  ```
  Because `currentProfile` is null, endpoint binding check is skipped and orphaned token is returned.
- **Remedy**: Fail closed whenever `profilesResult.status === "available" && !currentProfile`, regardless of `explicitId`.

---

## Suggestions (NICE TO HAVE)

### 1. Unnecessary Auth Call When `effectiveProfileId` Is Null
- **Location**: `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx:84-88, 106-113`
- **Observation**:
  ```ts
  const serverUrl = useMemo(() => {
    if (targetProfile?.url) return targetProfile.url;
    if (effectiveProfileId) return undefined;
    return getServerUrl();
  }, [targetProfile, effectiveProfileId]);
  ```
  When `effectiveProfileId` is null (no active profile and no prop), `serverUrl` falls back to `getServerUrl()`. It then runs `checkAuthStatus(serverUrl, null)` which sends a request to the server without auth headers. Plan noted: *"If no active/selected profile, show unavailable/unauthenticated state, never read credentials from another server."* Returning `undefined` for `serverUrl` when `!effectiveProfileId` avoids this unnecessary round-trip and immediately flags unauthenticated state.

### 2. Missing Blank Line in Markdown
- **Location**: `docs/plugin-platform-linux.md:118-119`
- **Observation**: Missing newline between code block closing ``` and `### Scenario B: Multi-User / Sandboxed Deployment`.

---

## Validation Commands & Results
- `pnpm --filter @dam-hopper/ui test src/api/server-config.test.ts src/components/pages/settings-page/PluginManagementSection.test.tsx`:
  - **Result**: 2 test files passed, 49 tests passed (0 failures).
- `pnpm --filter @dam-hopper/ui test`:
  - **Result**: 271 test files passed, 1902 tests passed.
- `pnpm --filter @dam-hopper/ui build`:
  - **Result**: `tsc -p tsconfig.json` passed with 0 errors.
- `cargo check --manifest-path server/Cargo.toml`:
  - **Result**: Finished `dev` profile with 0 errors.
- `cargo test --manifest-path server/Cargo.toml --test linux_release_plugin_runner`:
  - **Result**: 8 tests passed, 0 failed.
- `bash -n deploy/release/dam-hopper-install.sh`:
  - **Result**: Clean syntax validation (exit 0).
- Installer smoke CLI execution:
  - `--role both --plugin-owner-user <curr> --service-user unset`: Warning emitted on stderr, exit clean.
  - `--role both --service-user X --plugin-owner-user X`: Warning emitted on stderr, exit clean.
  - `--role both --service-user dam-hopper --plugin-owner-user <curr>`: No warning emitted, exit clean.
  - `--role web`: Warning suppressed for non-server role, exit clean.

---

## Unresolved Questions
1. Whether plugins operating under the workstation owner UID will eventually require write permissions in `/home/<user>`: `dam-hopper-plugin-runner.service` retains `ProtectHome=read-only`. If write access is required by future plugins, systemd hardening policy must be adjusted intentionally via separate review.
