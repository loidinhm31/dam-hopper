# Local development API evidence

## Authority and boundary
- Planning-only request explicitly asks running local API. No product/source/tests/config of the user's workspace modified.
- Own fixture root: `C:/Users/loidi/AppData/Local/Temp/damhopper-android-plan-261107-0305`; own workspace `workspace/sample`, sample `hello.txt`; selected config `config/dam-hopper/config.toml`; own sessions DB. XDG_CONFIG_HOME redirects daemon global config/token, NOT Windows OPAQUE storage: source `server/src/crypto/opaque.rs:41-55` uses `dirs::config_dir()`. The server loaded existing `AppData/Roaming/dam-hopper/opaque-server-setup`; metadata checked after shutdown: creation/last-write both 2026-05-26, 128 bytes; no generated-setup startup log. Contents never printed/copied; existing setup not deleted or rotated. Do not call this full secret-storage isolation or assume environment APPDATA overrides native known-folder resolution.
- Existing workstation loopback 4803 is owned by Termius PID 21388; its responses identify Linux `/home/loidinh/WS`, not a newly started Windows server. Preserve it, no mutation. Source/version identity of tunneled server not established by its version string.
- First owned service `android-plan-dev-api-261107` stopped while compiling: double-quoted shell expanded PowerShell `$env` incorrectly; startup isolation assignment failed. No owned server startup observed. Incorrect ready result came from the pre-existing 4803 listener. Preserved as failed setup, not API success.
- Corrected service `android-plan-isolated-api-261107` compiles current source with `cargo run -j 1`, explicit absolute manifest/config, port 4804, bind `127.0.0.1`; process-local removal of inherited Mongo/web/workspace environment; CWD is disposable fixture (avoids repository dotenv). Existing Mongo variable presence was checked without reading its value. This is a local-only bypass, not authenticated/TLS/MFA qualification.

## Observed existing tunnel (read-only)
Commands used Node `fetch` locally, not a fabricated fixture. Endpoint behavior corroborates current source, but remote source revision is unproven.

| Method/path | Observed | Interpretation |
|---|---|---|
| GET `/api/health` | 200 `{schemaVersion:1,status:"ok",version:"0.15.6",role:"api"}` | Existing tunneled development API reachable. |
| GET `/api/auth/status` | 200 authenticated/dev_mode/devMode true, user dev-user, role user, workbenchProtocol 2, authProtocol 2 | Existing tunnel is no-auth dev; no credential copied. |
| GET `/api/workspace` | 200 root/configPath/projectCount/workspaceEpoch | Workspace epoch is separate from PTY and agent epochs. |
| GET `/api/terminal` | 200 `[]`; `X-DamHopper-PTY-Epoch` UUID header | Correct singular terminal route; empty inventory cannot prove any pending create absent. |
| GET `/api/agent-status/v1/snapshot` | 200 version 1, numeric serverEpoch/revision, availability ready, terminals `[]` | Correct versioned status path. |
| GET `/api/fs/list?targetType=workspace&path=` | 200 entries | Explicit workspace REST target supported; names not retained in report. |
| GET `/api/fs/list?path=` | 400 `{error:"missing filesystem target",code:"INVALID_FS_TARGET"}` | Android old project-only/missing-target serializers must adapt. |
| GET `/api/config` | 200 top keys workspace/server/projects/features/ui; camelCase UI keys include appShortcuts and OS placement fields | Android must preserve fields it does not present. No write attempted. |
| GET `/api/terminals`, `/api/agent-status`, `/api/agent-status/snapshot` | 404 | Exploratory wrong route attempts, not removed functionality; canonical paths verified afterward. |
| GET `/api/fs/list?targetType=project&project=sample&path=` | 404 | Sample belongs only to own fixture, not existing tunnel. No claim of isolated fixture success. |

## Current-source startup and smoke
- Initial readiness timeout after 30s: still compiling dependencies, process alive. A subsequent early health attempt returned `ECONNREFUSED` (exit 2); retained as not-ready observation, not API-contract failure.
- Current-source Windows server subsequently started on own loopback 4804. Node fetch scenario exited 0 and checked the fixture's `sample` project before accepting evidence. Build emitted Windows-specific unused/dead-code warnings; no warning repair or test suite was attempted.

| Method/path on own 4804 | Observed |
|---|---|
| GET `/api/health` | 200 schemaVersion 1, status ok, version 0.15.6, role api. |
| GET `/api/auth/status` | 200 dev_mode/devMode true, workbenchProtocol 2, authProtocol 2. |
| GET `/api/workspace`, `/api/projects` | 200 exact disposable Windows fixture root/config and project sample; not user's workspace. |
| GET `/api/terminal` | 200 empty array; `X-DamHopper-PTY-Epoch` canonical UUID and `X-DamHopper-Termination-Version: 1`. |
| GET `/api/agent-status/v1/snapshot` | 200 version 1, numeric epoch/revision, availability `platform-unqualified`, no terminals. This is the honest Windows status, not ready/idle. |
| GET `/api/fs/list?targetType=workspace&path=` | 200 fixture directories. |
| GET `/api/fs/stat?targetType=project&project=sample&path=hello.txt` | 200 size 29, text/plain, isBinary false, `fileIdentity` with workspaceId, numeric workspaceEpoch, canonical Windows path. |
| GET `/api/fs/read?targetType=project&project=sample&path=hello.txt` | 200 exact `Android planning API fixture\n` bytes. |
| GET `/api/fs/list?path=` | 400 `INVALID_FS_TARGET`, missing filesystem target. |

- Startup command (PowerShell process-local environment; invoked from disposable fixture CWD):
  `powershell -NoProfile -Command '$ErrorActionPreference="Stop"; $env:XDG_CONFIG_HOME="C:/Users/loidi/AppData/Local/Temp/damhopper-android-plan-261107-0305/config"; Remove-Item Env:MONGODB_URI,Env:MONGODB_DATABASE,Env:DAM_HOPPER_WEB_DIR,Env:DAM_HOPPER_WORKSPACE -ErrorAction SilentlyContinue; cargo run -j 1 --manifest-path G:/ws/sharing/dam-hopper/server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port 4804 --no-auth --config C:/Users/loidi/AppData/Local/Temp/damhopper-android-plan-261107-0305/config/dam-hopper/config.toml --cors-origins http://127.0.0.1:5173,http://localhost:5173'`
- Read-only scenario used Node fetch over all paths above, captured response status/body and terminal headers; fixture project assertion rejects accidental connection to the existing tunnel. No terminal, Git, config or file mutation was sent.
- WebSocket read probe 1: sent `{kind:"fs:read",req_id:701,target:{type:"project",project:"sample"},path:"hello.txt"}`. Received `fs:read_result`, ok true, base64 `data` and snake-case `file_identity`; throwaway oracle mistakenly tested nonexistent plaintext `content`, exit 1. This was verification-script error, not evidence of failed file content.
- Corrected WebSocket probe 2 (`req_id:702`) decoded base64 and compared exact fixture bytes and identity keys: `exactBytes:true`, identity `workspaceId/workspaceEpoch/canonicalPath`. Explicit client `close(1000,"planning smoke complete")` then emitted `ws-error`, `closeCode:1006`, `clean:false`; command exited 1. Read interoperability observed; graceful WS closure FAILED in this Node/native-server boundary. Not rerun or suppressed. No Android Ktor/reconnect correctness inferred; future implementation qualification must distinguish read success from closure failure.
- Cleanup completed after probes: stopped only owned service `android-plan-isolated-api-261107`; workstation check observed zero listeners on 4804, then removed only the disposable fixture root. Existing Termius tunnel remained `127.0.0.1:4803`, same PID 21388. Current-source API was actually run and exercised, is not left running; commands above recreate the fixture only after recreating its config/workspace.
- No Gradle tests, instrumentation, physical Android, web surface or live notifications exercised by this planning run. Existing reported test totals are historical only.
- Session active-plan setter returned warning `EVCRATE_SESSION_ID not set`; explicit canonical path is carried in each handoff, no claim of persisted active plan.
- Device prerequisites inspected without installing/building/starting an emulator: `adb` absent PATH, `ANDROID_HOME` configured; discovered SDK binary `C:/Users/loidi/AppData/Local/Android/Sdk/platform-tools/adb.exe` reports ADB 1.0.41 / package 37.0.0. `adb devices` reported zero ready devices. Java found at `G:/env/jdk-21.0.9/bin/java.exe`. Missing connected device, not missing ADB installation, is the current device-journey prerequisite.

## Unresolved questions
- No missing API-startup prerequisite. Android connected-device/visual/TLS/MFA, mutation and active-agent event qualification remain future checks. Unclean Node/native-server WS close (1006) is an observed baseline limitation requiring scoped retirement/reconnect qualification; this planning request does not authorize server repair.
