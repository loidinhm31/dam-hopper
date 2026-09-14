# Research Report: idle-suspend runtime identity reconciliation

**Timestamp:** 2026-09-12

## Scope and boundary

Research only. The requested cutover is: rendered API systemd `User=`/`Group=` is the runtime identity authority; activation provisions the API audit path and API state parents before API start. Helper protocol v1, observer/collector upload, policy behavior, and Phase 02 are out of scope.

## Repository map / evidence

- `README.md:26-31` documents the privileged Linux systemd release installer and host prerequisites.
- `README.md:65-76` describes `start` as installing concrete units, reloading systemd, starting configured units, and applying the startup/health gate; this is the externally visible ordering boundary.
- `.github/workflows/ci.yml:64-67` shows deployment scripts and `tests/deploy/*.sh` are syntax/deployment validation surfaces; keep focused checks in that existing deployment test area.
- `deploy/release/dam-hopper-install.sh` is the installer/activation entry point to trace. `deploy/release/generate-release-manifest.mjs` and `deploy/release/check-release-assets.mjs` are the manifest/assets validation surfaces. [INFERENCE: exact function names and template filenames require confirmation in the owning files.]
- `API_SERVICE_IDENTITY` is the existing identity input named by the release contract; it must not remain a second runtime authority after rendering.

## Findings

### 1. Activation and startup ordering

1. Resolve/validate the requested identity once, render it into the API unit (`User=` and `Group=`), and treat the rendered unit as authoritative. Manifest validation must reject an identity that cannot be rendered or resolved, while not allowing a stale `API_SERVICE_IDENTITY` value to override the unit at runtime.
2. During privileged activation, before `systemctl start` (the `start` sequence documented at `README.md:65`), provision/repair all API-owned paths. Only then daemon-reload and start the API. A failed provisioning transaction must prevent API startup and health-gate success.
3. API process initialization remains a defense-in-depth check, not the ownership authority: it may open the already-provisioned file, but should not race activation by creating a root-owned file or broadening permissions.

### 2. Layout and secure filesystem primitives

The plan should reuse the existing release path/layout helpers in `deploy/release/dam-hopper-install.sh` (and any helper sourced by it), rather than duplicate `/etc`, `/var/lib`, or unit paths. Reusable primitive requirements:

- Open/check each path component without following symlinks (`O_NOFOLLOW`/`openat`-style semantics where the implementation permits); reject a symlink at the audit file or any managed parent.
- Create parents with mode `0700`, then explicitly verify and repair owner/group and mode. Do not rely on process umask or `mkdir -p` alone.
- Create the audit file as a regular file, API UID/GID, mode `0600`; use no-follow checks and atomic create/replace semantics. Never truncate or replace an unexpected non-regular object.
- Re-check with `lstat`/`fstat` after mutation. Avoid check-then-use path races; if the shell boundary cannot provide descriptor-relative safety, move the sensitive operation to an existing privileged Rust/helper primitive instead of adding an insecure shell approximation.

### 3. Current audit/state risk to reconcile

The server’s idle-suspend audit initialization and state-directory creation are the likely source of first-start ownership/mode drift. Trace the idle-suspend server module and its audit writer/open path, then remove any fallback that creates `/etc/dam-hopper/idle-suspend-audit.jsonl` or its parents under the API process identity. The API must consume the activation-created path and fail closed on wrong type, owner, group, or mode. [INFERENCE: exact server module/symbol names need confirmation in the server tree.]

Managed layout:

- `/etc/dam-hopper/idle-suspend-audit.jsonl`: API UID/GID, `0600`.
- `/var/lib/dam-hopper`: API UID/GID, `0700`.
- `/var/lib/dam-hopper/.config`: API UID/GID, `0700`.
- `/var/lib/dam-hopper/.config/dam-hopper`: API UID/GID, `0700`.

Use the same rendered numeric UID/GID for every item. Do not infer ownership from the installer’s effective UID, `API_SERVICE_IDENTITY` after rendering, or an unrelated service account.

### 4. Rollback/recovery

Treat provisioning as a transaction around activation. Record whether each object pre-existed and its original owner/group/mode; on a later failure, remove only objects created by this activation and restore metadata changed on pre-existing objects. Never recursively delete a pre-existing directory. Recovery must also refuse symlink substitution and partial/non-regular paths. A failed rollback must leave activation failed and must not start the API; surface the first provisioning error plus rollback errors. Re-running activation after a successful repair must converge without changing content or inode unnecessarily (idempotence).

## Focused behavioral tests

Add tests in the existing deployment test harness (`tests/deploy/*.sh`, exercised by `.github/workflows/ci.yml:64-67`) and the owning server unit-test module; test observable filesystem/service behavior, not implementation details:

1. **Default identity:** rendered default API UID/GID owns all four `0700` parents and the `0600` audit file before API start; a startup probe confirms the API can append.
2. **Custom identity:** configure a different valid API account; verify every object uses its rendered numeric UID/GID, not installer/root or stale `API_SERVICE_IDENTITY` metadata.
3. **Repair:** pre-create regular objects with wrong owner/group/mode; activation repairs exactly the managed metadata and preserves audit bytes.
4. **Symlink refusal:** replace the audit file and each managed parent, one at a time, with symlinks; activation fails, does not follow/truncate the target, and does not start the API.
5. **Idempotence:** activate twice; second activation succeeds with unchanged audit content and stable metadata/inode where no repair is needed.
6. **Failure rollback:** inject failure at each provisioning step; assert created objects are removed, pre-existing metadata/content restored, and API remains stopped.
7. **Startup ordering:** make API startup fail unless the audit file/parents already satisfy owner/mode; assert activation provisions first and only then invokes `systemctl start`/health gate.

Keep helper protocol v1 assertions unchanged. Do not add observer, upload, policy, or Phase 02 cases.

## Unresolved questions

- Confirm the exact server audit/state module and symbol names, installer helper names, systemd template filenames, and the existing deployment test scenario file before implementation.
- Confirm whether a no-follow, descriptor-relative privileged filesystem primitive already exists; if not, define the smallest safe boundary rather than weakening symlink/race guarantees.
