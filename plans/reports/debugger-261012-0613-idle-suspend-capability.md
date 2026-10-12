# Root cause: idle-suspend capability 503

## Executive summary

**Incident:** `POST https://api-hop.qm-hub-v001.cloud/api/system/idle-suspend/v1/force-suspend` returns HTTP 503, code `idleSuspendCapabilityUnavailable`, message `host lacks RTC alarm or suspend capability`.

**Primary finding — verified runtime/configuration evidence:** obsolete `dam-hopper-plugin-runner.service` remains installed and continually auto-restarts after its v0.8.4 executable disappeared. Its successful `ExecStartPre` reapplies an obsolete tmpfiles rule assigning `/run/dam-hopper` to `root:dam-hopper-plugins`, mode `3770`. Current API/helper deployment expects group `loidinh`. API process UID/GID 1000 lacks plugin GID 979; it cannot traverse the directory. Helper daemon and Unix listener are active, but unprivileged socket metadata lookup returns `EACCES`.

**Failure-chain conclusion [INFERENCE from verified access failure + inspected source]:** `HelperClient::is_socket_present()` calls `Path::exists()`, which collapses inaccessible metadata to `false`; executor returns `false` before opening IPC; coordinator returns capability unavailable; API emits the hardcoded hardware-looking 503. This explains the incident without absent RTC hardware. Five actual server audit records show `rejected_capability`; no new force-suspend request was issued during investigation.

**Host/domain linkage:** live cloudflared journal reports this hostname routed to `http://localhost:4801`; socket listing ties port 4801 to the inspected API PID 1673. This establishes configured local origin linkage. It does not independently prove which connector served the user's exact request or exclude other replicas. The disk tunnel config still says port 3000 and is not reliable active-routing evidence.

**Impact:** manual sleep blocked before handoff; misleading hardware diagnosis; obsolete service generates restart churn. Detailed failure cause lost at multiple server boundaries. Existing helper audit observability exists, but is unreachable for a probe rejected before IPC.

**Priority:** P0 scoped retirement of conflicting obsolete runtime producer and canonical ownership repair by authorized operator. P1 typed probe failures, correlated internal logs, safe status diagnostics. Do not weaken peer authentication or bypass preflight.

## Scope, method, safety

- Investigation only. Source/configuration reads, service metadata, journal reads, sysfs reads, socket/process inspection, unauthenticated read-only status GETs.
- Debugging/root-cause tracing and problem-solving assumption inversion applied: a `.cloud` hostname is not evidence of a VM, and a capability error is not proof of hardware absence.
- No source changes, service stops/restarts, permission changes, RTC writes, or force-suspend calls. No build/test suite run; this report is not a remediation-validation claim.
- Report path follows explicit assignment, not later default naming hook.
- Observation window approximately 06:14–06:17 Asia/Saigon. Journald local times below; API/helper embedded timestamps are UTC.

## 1. Exact execution path

```text
Protected Axum route (router.rs:380–395)
  -> idle_suspend::force_suspend (api/idle_suspend.rs:327–478)
     -> JSON/cookie-origin guard; configured authentication; enabled actor
     -> body <=16 KiB; strict DTO; wake 0 or 60..=86400
     -> coordinator obtained; ForceSuspendCommand submitted
  -> IdleSuspendCoordinator::force_suspend (coordinator.rs:600–611)
     -> command channel + oneshot result
  -> command worker (coordinator.rs:1166–1242)
     -> handle_force_suspend (coordinator.rs:3739 onward)
        -> actor/wake validation; attempt correlation/event
        -> reject active handoff before probing
        -> timeout(3 seconds, executor.check_capability())
  -> SystemdIdleSuspendExecutor::check_capability (executor.rs:82–92)
     -> HelperClient::is_socket_present (helper_client.rs:28–30)
     -> UnixStream::connect + framed ProbeCapability request
  -> helper daemon accepts connection; kernel SO_PEERCRED
  -> HelperServer::handle_connection (helper_server.rs:46–131)
     -> enrolled UID/PID policy; request decode/validation
     -> SysfsPreflightChecker::run_all (preflight.rs:175–179)
        -> suspend state -> RTC alarm -> sleep inhibitors, first failure wins
     -> Capability { supported, detail }; helper capability audit
  -> executor reduces reply/error to bool, dropping detail
  -> coordinator reduces timeout to false, emits generic rejection
  -> API CapabilityUnavailable(_detail) -> HTTP 503, fixed safe message
```

### Admission and error mapping

`api/idle_suspend.rs:327–407` performs transport, actor, payload, wake bounds, and coordinator availability checks before the capability probe. These have distinct response codes. Receiving the reported capability code means this branch was reached, not a generic edge-proxy 503.

`api/idle_suspend.rs:450–456` explicitly discards `_detail` and returns:

```json
{"error":"host lacks RTC alarm or suspend capability","code":"idleSuspendCapabilityUnavailable"}
```

HTTP 503 and `Cache-Control: no-store`. Sanitization is intentional under Requirement 48; the message inaccurately implies hardware absence for transport/permission/authentication failures too.

`coordinator.rs:3862–3864` uses:

```rust
tokio::time::timeout(Duration::from_secs(3), executor.check_capability())
    .await
    .unwrap_or_default()
```

Both a negative probe and elapsed timeout become `false`. The original timeout distinction is lost. Rejection records `ManualAuditResult::RejectedCapability` best-effort and semantic `TerminalRejected` with `CapabilityUnsupported` (`3866–3902`). The result contains only the generic string `Host lacks required suspend capability or capability probe failed`, not the helper's original detail. No detailed tracing event is emitted here. No execution future or handoff is created.

Probe occurs before active-fleet confirmation (`3905 onward`): `force: true` cannot bypass it. `wakeAfterSeconds: 0` also runs the same RTC preflight; indefinite sleep is not an RTC-free escape.

### Helper client and transport failure points

`main.rs:979–989` constructs the Linux executor using `DAM_HOPPER_IDLE_SUSPEND_SOCKET` or `/run/dam-hopper/idle-suspend.sock`; it checks availability dynamically each request, not permanently latched at startup.

| Boundary | Behavior | Lost information |
| --- | --- | --- |
| `helper_client.rs:28–30` | `socket_path.exists()` | Missing path vs inaccessible parent; not even socket-type validation |
| `helper_client.rs:35` | Unix connect error propagates as `ProtocolError` | Refused/stale listener, permission denied, wrong endpoint |
| `helper_client.rs:37–38` | Frame write/read errors propagate | Broken pipe, EOF, malformed reply, frame bounds |
| `helper_client.rs:40–51` | Capability returns `(bool, String)`; helper Error becomes PermissionDenied I/O with code/message; unexpected payload becomes InvalidData | Structured helper code converted to error text |
| `executor.rs:85–91` | Missing/inaccessible socket => false; `Ok((supported, _))` drops detail; `Err(_)` => false | All causal distinctions |
| `coordinator.rs:3862–3897` | Timeout or false => generic capability rejection | Timeout vs helper negative/error |
| `api/idle_suspend.rs:450–456` | Drops remaining generic detail | No operator log at HTTP boundary |

IPC is a 4-byte big-endian length prefix and JSON, maximum 4096-byte payload (`protocol.rs:314–315,565–603`). EOF, zero/oversized frame, JSON parse and I/O errors propagate. Client has no own deadline; coordinator supplies the 3-second outer bound. Helper preflight uses synchronous filesystem reads and `std::process::Command::output()` for inhibitors: outer timeout does not itself terminate the helper's synchronous subprocess. No timeout was observed in this incident.

## 2. Verified live evidence and timeline

### Runtime evidence

| Observation | Actual result | Meaning |
| --- | --- | --- |
| `namei -l /run/dam-hopper/idle-suspend.sock` | Parent `drwxrws--T root dam-hopper-plugins`; child `Permission denied` | Directory lacks others traversal; API cannot access socket pathname |
| `stat /run/dam-hopper/idle-suspend.sock` as loidinh | `Permission denied (os error 13)` | Not evidence of missing socket |
| `stat /run/dam-hopper` | `root:dam-hopper-plugins`, mode 3770 | Conflicts with canonical API group |
| `getent group dam-hopper-plugins` | `dam-hopper-plugins:x:979:` | Conflicting numeric group |
| `/proc/1673/status` | UID/GID all 1000; Groups `10 39 63 982 1000` | API has no GID 979 and no effective capabilities |
| `systemctl show dam-hopper-api` | active/running, MainPID 1673, User/Group loidinh | Credential evidence is actual production process, not only investigator shell |
| `systemctl show dam-hopper-idle-suspend-helper` | active/running, MainPID 4885, User root, Group loidinh | Daemon installed and alive |
| `ss -xl` | LISTEN `/run/dam-hopper/idle-suspend.sock` | Real Unix listener exists despite failed pathname stat |
| Helper process argv/unit | v0.13.0 helper; `--enrolled-uid 1000 --enrolled-pid-file /run/dam-hopper/server.pid` | Intended peer enrollment matches API UID; PID-file contents not readable from this account |
| Canonical `/etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf` | `d /run/dam-hopper 3770 root loidinh -` | Correct expected directory group already rendered |
| Obsolete `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf` | `d /run/dam-hopper 3770 root dam-hopper-plugins -` | Conflicting rule remains installed |
| Obsolete service properties | activating/auto-restart; NRestarts 7566; successful ExecStartPre running obsolete tmpfiles config | Conflicting rule is actively reapplied, not an inert leftover |
| Obsolete service journal | v0.8.4 runner executable missing; status `203/EXEC`; repeated restart scheduling | Explains persistent repair reversal and restart churn |

**Socket inode owner/group/mode not verified:** parent traversal denied; non-interactive `sudo -n stat` required a password. Do not claim socket itself is `root:loidinh` or `root:dam-hopper-plugins`. Current helper runs root:loidinh and code sets socket mode 0660, but parent is setgid, so actual socket group may inherit the conflicting directory group [INFERENCE]. Parent denial alone is sufficient to block API metadata/connection.

### Host capabilities observed

- `/sys/power/state`: `freeze mem disk`; required `mem` advertised.
- `/sys/class/rtc/rtc0/wakealarm`: exists, mode `-rw-r--r-- root:root`; contents empty.
- Host `/sys` mount: sysfs, `rw`.
- `systemd-detect-virt`: `none`; DMI vendor/product `GPD` / `G1618-04`. Evidence favors physical workstation, not cloud VM.
- `systemd-inhibit --list --no-legend`: ModemManager, NetworkManager, UPower entries are `sleep ... delay`; OMP entries are `idle ... block`. Parser blocks only WHAT containing `sleep` AND MODE `block`, so these observed entries do not block preflight.
- Mode-bit writability is not a tested write. Helper mount namespace, SELinux, capability policy, and actual RTC wake reliability remain unvalidated. No alarm was programmed.

### Domain origin evidence

- Cloudflared service active on inspected host.
- Live cloudflared journal `Updated to new configuration` parsed without printing credentials: ingress entry `{hostname: api-hop.qm-hub-v001.cloud, service: http://localhost:4801}`.
- `ss -ltnp`: port 4801 owned by API PID 1673, same inspected v0.13.0 process.
- Disk `/etc/cloudflared/config.yml` instead maps hostname to `http://localhost:3000`; no listener on 3000, GET connection refused. Disk config is stale relative to live journal configuration.
- Public status GET returned `401 AUTH_REQUIRED`; local 4801 status GET likewise returned 401. Authenticated status snapshot not collected. No credentials extracted or authentication bypass attempted.
- **Conclusion:** configured hostname-to-host linkage verified; exact user-request connector/replica attribution remains [INFERENCE], not proven by identical 401 responses.

### Supporting timeline

1. **Oct 11 23:27:11 and 23:27:17:** helper startup fails `226/NAMESPACE`; journal says `ReadWritePaths=/run/dam-hopper` mount setup fails because directory does not exist. `ExecStartPre` cannot create it before namespace setup.
2. **23:27:18:** API startup trace logs helper socket path with `socket_exists=false`.
3. **23:27:22:** helper starts after retries; journal confirms enrolled UID/PID-file configuration and listener successfully bound.
4. **23:27:24:** runtime directory ctime observed; live directory ultimately belongs to obsolete plugin group. Attribution of this exact ctime event to one restart is not independently recorded.
5. **Oct 12:** server audit contains five capability rejections: three at wake 20000 seconds, two at wake 600 seconds; all requestedForce true, effectiveForce false. This proves actual admission failures but audit intentionally lacks causal detail.
6. **06:16:46–06:16:50:** obsolete unit repeatedly runs provisioning and fails missing executable; successful tmpfiles ExecStartPre confirmed in service metadata. Directory access denied to current API credentials.

Selected journal excerpts:

```text
dam-hopper-idle-suspend-helper.service: Failed to set up mount namespacing: /run/dam-hopper: No such file or directory
Helper listener bound successfully socket=/run/dam-hopper/idle-suspend.sock
dam-hopper-plugin-runner.service: Unable to locate executable '/opt/dam-hopper/releases/v0.8.4/both/bin/dam-hopper-plugin-runner': No such file or directory
dam-hopper-plugin-runner.service: Main process exited, code=exited, status=203/EXEC
```

## 3. Root cause analysis — four layers

### Layer A: socket/daemon lifecycle — primary incident cause

Verified: helper is alive; socket listener exists; API cannot traverse parent; obsolete producer continuously changes ownership to its own group. Therefore restarting helper alone or checking only service-active state is insufficient. A one-time ownership repair can be undone on the next obsolete-service restart.

Source-confirmed causal masking: `Path::exists()` converts metadata failure to false. This is an IPC access/provisioning failure presented as a hardware capability failure, before helper authentication or sysfs probes are reached [INFERENCE for each recorded request; no per-request detailed trace exists].

Separate verified startup defect: sandbox mount setup requires `/run/dam-hopper` before `ExecStartPre`; cold-boot provisioning is incorrectly ordered. Current `deploy/systemd/dam-hopper-idle-suspend-helper.service.in:10–11` preserves that ordering. `server/src/linux_release/activate.rs:566–575` starts helper before API provisioning and merely warns on helper startup failure. Not the immediate steady-state failure, but a distinct socket availability risk evidenced in this boot.

### Layer B: peer credentials — mandatory second gate, not current proven trigger

`peer_auth.rs:17–22` obtains Unix peer credentials through Tokio/Linux SO_PEERCRED. `verify_credentials():107–126` checks configured UID then resolved PID. GID is collected but not compared in this policy; filesystem group permissions are a separate gate. Documentation's claim of UID/GID equality is broader than this implementation.

- `--enrolled-pid`: fixed expected PID; stale after API restart unless updated.
- `--enrolled-pid-file`: read and parse current PID on every request; tracks restarts when file is correctly maintained. Fixed PID takes precedence if both supplied.
- Missing/unreadable PID file => `PidFileReadError` with path and OS detail; non-numeric => `InvalidPidFile`; wrong UID/PID => mismatch with expected/actual values.
- Helper authenticates before reading request. Rejection generates `permissionDenied` response and best-effort `PeerAuthenticationFailed` audit (`helper_server.rs:51–65`); client converts to PermissionDenied I/O; executor drops it.
- Policy fields are optional; absent UID/PID guards weaken authorization. Production template correctly sets enrolled UID and PID file. Preserve both, never make probe permissive to diagnose.

Live enrollment UID 1000 matches API. PID-file contents and ownership were inaccessible; no peer rejection verified. Manual probing from a shell would have a different PID than enrolled server, so shell rejection alone would not diagnose production enrollment.

### Layer C: sysfs/cloud environment — possible alternate cause, not evidenced here

`SysfsPreflightChecker::new()` fixes mode `mem`, power path `/sys/power/state`, RTC path `/sys/class/rtc/rtc0/wakealarm`. `with_paths()` supports alternate mode/paths programmatically, but inspected helper CLI always calls `new()`; no runtime CLI mode option exists here.

`run_all()` stops at first failure. Thus a VM lacking `mem` never reaches RTC/inhibitor checks. Generated examples below are **source-derived failure scenarios, not incident log excerpts**:

| Situation | Generated detail / category |
| --- | --- |
| Power-state path absent | `Host does not support required suspend state: Power state file not found at /sys/power/state` |
| Only `freeze`, not `mem` | `Host does not support required suspend state: Configured mode 'mem' not in available modes: ["freeze"]` |
| RTC wakealarm absent | `Host lacks required RTC wakealarm device: RTC wakealarm device not found at /sys/class/rtc/rtc0/wakealarm` |
| Sysfs read denied | `Preflight probe error: Failed to read ...: Permission denied ...` |
| Foreign nonzero alarm | `RTC wakealarm is already in use: Non-empty RTC wakealarm detected at ...` |
| Sleep block inhibitor | `Sleep is blocked by active inhibitor: <who> (<why>) [mode=block]` |
| Container lacks systemd tool/bus | `Preflight probe error: Failed to execute systemd-inhibit: ...` or `Preflight probe error: systemd-inhibit failed: <stderr>` |

Helper prefixes failures with `Preflight check failed:` and returns `Capability { supported: false, detail }`, recording helper audit reason: `InhibitorPresent`, `CapabilityUnsupported`, `RtcBusy`, or `PreflightFailed`. Busy RTC and transient inhibitors are not permanent hardware incapability, but still map to the same HTTP 503 through the Boolean seam.

**Checklist correction:** `check_rtc_wakealarm()` checks existence, readability, and empty/zero contents — not writability. `check_suspend_state()` checks supported modes — not actual ability to suspend. RTC writes occur only in `backend.rs:90–162`, followed by fixed `systemctl suspend` (`165–189`). Read-only sysfs in a container/sandbox could pass capability probe then fail execution. These later failures become typed outcomes/status after an accepted request, not this immediate probe 503.

Cloud handling must diagnose actual guest/host restrictions. A hypervisor that exposes neither suspend-to-RAM nor reliable RTC wake cannot be fixed by retries, helper reinstall, `force:true`, or switching silently to `freeze`. Provider-managed stop/resume requires separate explicit provider integration and wake guarantees, not a fallback behind this hardware-RTC contract.

### Layer D: sanitization/diagnostic masking — confirmed architecture defect

Requirement 48 means external responses must not leak internal paths/credentials; it does **not** require deleting evidence before operator logs/diagnostics.

Confirmed gaps:

1. `executor.rs:89–90` throws away helper detail and transport error; no trace of failing stage.
2. Coordinator erases timeout distinction, substitutes generic text, and emits only generic audit/event reason.
3. API suppresses `_detail` without internal logging. Its safe message is misleading for IPC failures.
4. `GET status` serializes `IdleSuspendStatusV1` directly (`api/idle_suspend.rs:153–178`). `capabilityCode` is recomputed from immutable startup `capability_selection`, not live probe (`coordinator.rs:520,3041,3271`; fallback `status.rs:438`). `auto`/`rtcwake` is selection, not proven availability.
5. `detail` is actually exposed; it is not permanently unused. Initialized None; updated by completed suspend outcomes (`coordinator.rs:3672–3693`). Manual capability rejection does not receive/mutate this variable (`handle_force_suspend` parameters omit it); worker republishes existing detail/lastOutcome (`1222–1241`). Thus manual rejection can leave no new reason or a stale previous outcome.
6. Existing helper audit stores precise preflight/auth details (`helper_server.rs:53–59,119–125`), but reads require root here (`0600 root:loidinh`), writes for probe diagnostics are best-effort, and no helper audit is produced if API cannot reach socket.
7. Existing release diagnostic bundle is reusable: `server/src/linux_release/diagnostics/` collects helper/server audit, journals, unit metadata, host probes, and authenticated status. `redaction.rs:299–340` preserves typed helper reason but reduces freeform detail heuristically; unknown text becomes restrictedDetailOmitted. This loses distinctions such as missing RTC vs RTC programming, suspend mode vs probe error. `host_probes.rs:45–74` reports RTC supported from device directory existence alone, another overly optimistic indicator.
8. Probe request has no attempt/request correlation ID (`protocol.rs:411–414,426–436`); helper capability audit cannot be directly joined to coordinator attempt by request ID.

**Security consequence:** blindly putting helper error strings into public `detail` would violate sanitization. Existing execution outcomes can already carry raw helper paths/messages and are serialized as `detail`/`lastOutcome`; assess that projection in the same diagnostics cutover. Authentication alone should not imply permission to see credentials or unrestricted internal paths.

## 4. Recommended remediation plan — concrete touchpoints

### P0 — scoped deployment repair, operator only; not executed

1. Preserve service/journal/tmpfiles/access evidence under release deployment lock. Confirm resolved API identity and helper identity; do not hardcode workstation group for other hosts.
2. Retire **only** obsolete `dam-hopper-plugin-runner.service`, its enablement link and obsolete tmpfiles rule. Stop/cancel pending restarts before repairing directory; removing a rule while its restart job remains active is insufficient.
3. Reuse/audit `deploy/remove-plugin-platform.sh` system-scope allowlist and lock behavior (`135–167,184–220`) rather than broad filesystem cleanup. Its service stop is gated by `systemctl is-active`; ensure auto-restart/activating units are cancelled too. Preserve shared directory, live helper socket, PID file, server configuration and audit logs. Script explicitly protects these shared paths.
4. Reapply canonical `/etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf` using rendered API group; expected `/run/dam-hopper = root:<API_GROUP>,3770`. Verify helper socket inode type/group/mode as root and enrolled PID equals current API MainPID. Parent group repair alone may not fix a socket that inherited old setgid group; make bounded socket ownership repair or planned helper restart under operator control, not recursive chmod/chown.
5. Harden release activation retirement: `server/src/linux_release/activate.rs:320–330,449–450,566–575`; `runtime_cleanup.rs:20–40`. Existing cleanup removes only stopped known IPC entries and does not retire obsolete unit/rule or repair shared ownership. Ensure conflict retirement and canonical provisioning are explicit, idempotent and transaction-safe before native services run.
6. Fix cold-boot ordering in `deploy/systemd/dam-hopper-idle-suspend-helper.service.in` and shipped service counterpart: provision fixed runtime directory before sandbox mount setup, with one canonical owner/group rule. Coordinate with existing API unit provisioning and release manager; do not reintroduce competing directory owners or unsafe broad access.

Do not add API account to obsolete plugin group or chmod 0777 as permanent remedy. That hides migration failure and broadens privileged IPC access. Do not enable legacy `.socket`: current daemon binds its own listener and does not consume inherited systemd activation sockets.

### P1 — preserve failure cause without leaking details

**Touchpoints:** `executor.rs`, `helper_client.rs`, `protocol.rs`, `coordinator.rs`, `status.rs`, `api/idle_suspend.rs`, existing diagnostics projection/model/host probes.

- Replace Boolean capability seam with typed probe outcome: hardware support, readiness/availability, stable safe reason code, plus internal diagnostic context. Model missing path, path permission denied, connect refused, IPC read/write/protocol, peer auth, suspend mode absent, RTC absent/busy, inhibitor, inhibitor query failure and timeout distinctly. Do not infer codes from error strings where typed errors exist.
- Replace opaque `exists()` precheck with fallible metadata/access handling or direct typed connect errors. Distinguish `NotFound` from `PermissionDenied`; verify socket type when inspecting metadata.
- Preserve helper typed preflight/peer error categories across IPC instead of only freeform `detail`. Keep internal path/errno/expected-vs-actual peer data on controlled internal channels.
- Match timeout explicitly in coordinator. Record elapsed/stage, reason, correlation ID and internal bounded diagnostic context using structured tracing; redact credentials. Rate-limit repeated background identical errors, not unique operator attempts.
- Log before sanitized HTTP mapping or inside coordinator with attempt context; retain audit/semantic events but enrich safe reason codes. HTTP message should say capability/helper availability check failed, not assert absent hardware for every failure.
- Persist latest manual probe result in coordinator-owned status; publish revision and timestamp/attempt correlation. Separate startup `capabilitySelection` from measured availability/support. Clear stale cause on successful reprobe. Surface safe `reasonCode`, checkedAt and public summary; never raw sysfs paths or helper stderr in external status.
- Apply explicit safe projection to `detail` and `lastOutcome` for GET/WebSocket status. Detailed operator diagnostics must be role/authorization gated and credential-redacted, not the normal authenticated status payload.
- Reuse `linux_release/diagnostics` bundle, not a second diagnostics system. Extend closed reason projection and socket/parent permission evidence; distinguish unreadable/missing files and RTC device/wakealarm readiness. Preserve detailed local root-readable audit and useful operator logs.
- Introduce probe correlation via existing protocol/attempt identity with a coordinated versioned change if schema requires it. Do not silently add fields against deny_unknown_fields or leave old clients/executors incompatible.

### P2 — accurate unsupported-host diagnosis and documentation

- Describe actual requirements in `docs/terminal-idle-suspend-security.md`, deployment docs and status/UI messaging: host systemd/logind, advertised `mem`, exposed RTC wakealarm, privileged service access and exclusive alarm ownership. Correct docs claiming GID equality, delay inhibitors blocking, or RTC writability checked by current preflight.
- Diagnose from helper execution namespace/privileges, not only developer shell. Use non-mutating metadata/access inspection and explicit unchecked/unknown state; do not prove writability by overwriting wakealarm.
- Unsupported cloud VM/container: mark hardware support unavailable with stable cause; keep automatic suspend disabled and reject manual sleep safely. A different cloud lifecycle backend is separate approved scope, not needed to repair this incident.

### Validation for remediation owner; not run here

1. Reboot/start lifecycle: helper starts without 226/NAMESPACE; no obsolete restart producer remains; canonical directory/socket group persists.
2. Production API UID/GID and enrolled PID can access/authenticate helper. Distinguish inaccessible parent from missing socket, stale socket, wrong PID and malformed PID file.
3. Fault matrix: absent mem, absent RTC, unreadable RTC, busy alarm, sleep block vs delay/idle-only inhibitors, inhibitor tool failure, protocol failure and timeout each produce specific internal trace and safe status reason; no handoff on rejected probe.
4. Security assertions: API errors/status/WebSocket/export contain no internal paths, credentials, raw helper stderr or unrestricted process metadata; authorized operators still obtain cause/stage and correlation.
5. Successful probe clears stale status; startup selection is not misrepresented as live support; existing executor callers/tests migrated together.
6. Review relevant coverage in `server/src/idle_suspend/tests.rs` (manual capability failure, peer auth, helper IPC), `server/src/api/tests.rs`, `server/tests/idle_suspend.rs`, and `server/tests/idle_suspend_diagnostics.rs`. Existing manual test asserts generic failure and no handoff, not diagnostic cause preservation.
7. Any real suspend/RTC-write canary only in approved maintenance window with out-of-band wake access; not part of this read-only investigation.

## Unresolved questions / evidence limits

- Exact user request's connector/replica provenance not captured; live configured ingress strongly links hostname to inspected local API, but multiple connectors are not excluded.
- Socket inode metadata and enrolled PID-file contents require authorized root access; `sudo -n` unavailable. Parent access failure already established.
- Actual helper-namespace RTC write access, SELinux policy and reliable physical wake not exercised. Current preflight does not establish them.
- Precise migration event that left obsolete service enabled not determined. Installed conflicting unit/rule and successful repeated application verified; current source includes separate scoped retirement tooling.
- Authenticated status payload not fetched; external/local GETs returned 401. Status deficiencies grounded in inspected implementation, not a fabricated live snapshot.
