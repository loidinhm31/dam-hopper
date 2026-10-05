# Retired Plugin Platform Archive Record

**Status:** Permanently Retired (2026-10-02)  
**Historical Design Reference:** Superseded by Native Evcrate Advisor (`server/src/advisor/` and `packages/ui/src/advisor/`)  

## 1. Retirement Overview

On 2026-10-02, the DamHopper trusted plugin platform and external Node.js runner daemon (`dam-hopper-plugin-runner`) were permanently decommissioned and deleted from the codebase. The previous plugin architecture ran trusted extension scripts in an external daemon communicating over a Unix domain socket (`/run/dam-hopper/plugin-runner.sock`) and rendered UI components inside opaque sandboxed iframes using `@dam-hopper/plugin-sdk`.

The platform was retired in favor of the in-process **Native Evcrate Advisor**:
- **Zero External Runner Daemon:** Advisor executes directly within the Rust server process with bounded CLI introspection (`omp`, `codex`, `claude`, `pi`) and in-memory caches.
- **Zero Sandboxed Iframes:** The Advisor UI runs natively inside `@dam-hopper/ui` React component trees (`packages/ui/src/advisor/`), eliminating postMessage serialization overhead and iframe sizing constraints.
- **Atomic File Routing & CAS Policy:** Model routing is governed by atomic compare-and-swap (CAS) updates to `$HOME/.evcrate/advisor-routing.json` with SHA-256 revision checking.
- **Direct History Discovery:** Consultation histories are discovered by walking `$HOME/.evcrate/advisor-history/` directly with symlink rejection and keyset pagination.

## 2. Former Architecture Summary (Design Provenance)

For historical and architectural reference, the retired platform consisted of:

### 2.1 Package & Protocol Stack
- **`@dam-hopper/plugin-sdk` (SDK foundation):** TypeScript SDK exposing `definePlugin`, capability manifests, and `PluginContext`.
- **Manifest v1 (Package manifest):** JSON manifest defining package metadata, required permissions (`capabilities: ["workspace:read", "terminal:execute"]`), backend runner entrypoints, and frontend iframe assets with SHA-256 integrity hashes.
- **Runner JSON-RPC Protocol (Socket protocol):** Length-prefixed framing (4-byte big-endian length + JSON-RPC 2.0) over Unix domain socket `/run/dam-hopper/plugin-runner.sock`. Supported namespaces `runner.*`, `plugin.*`, `context.*`, and `management.*`.
- **UI Iframe Bridge (Isolated UI bridge):** Host-to-iframe communication across isolated origins via `MessageChannel` and `window.postMessage`, with `host.bootstrap` handshakes and capability revocation.
- **Management REST APIs (Host management endpoints):** Endpoints under `/api/plugins/*` for installation, lifecycle state, and host administration.

### 2.2 Security & Isolation Model
- **Dual Linux Identity:** The API daemon ran as `dam-hopper:dam-hopper`, while the plugin runner ran as a distinct system user `dam-hopper-plugin-runner:dam-hopper-plugins`.
- **Socket Permissions:** Socket `/run/dam-hopper/plugin-runner.sock` was restricted to mode `0660` with group `dam-hopper-plugins`.
- **Cancellation & Resource Caps:** Worker processes were monitored by `WorkerCancellationTracker` with 5-second graceful SIGTERM timeouts before SIGKILL escalation.

## 3. Host Artifact Removal & Cleanup Operations

For production hosts upgrading from legacy releases that previously ran the plugin platform, a dedicated cleanup script is maintained in the repository:

```bash
sudo bash deploy/remove-plugin-platform.sh
```

### Supported Removal Actions
1. **Systemd Services:** Stops and disables `dam-hopper-plugin-runner.service`.
2. **Socket & Runtime Files:** Removes `/run/dam-hopper/plugin-runner.sock` and `/etc/tmpfiles.d/dam-hopper-plugin-runner.conf`.
3. **State Directories:** Cleans `/var/lib/dam-hopper-plugin-runner/` and `/var/log/dam-hopper/plugin-runner.log`.
4. **Service Accounts:** Removes system user `dam-hopper-plugin-runner` and supplementary group `dam-hopper-plugins` once no longer referenced.

For full operational procedures, refer to the [Linux systemd Operations Guide](../linux-systemd.md) (§ Operator Runbook: Native Advisor Migration & Plugin Platform Retirement).

## 4. Superseded Documents

This record supersedes and consolidates the following historical documents:
- `docs/plugin-platform-linux.md` (Linux runner deployment and DAC scenarios)
- `docs/plugin-platform-d00.md` (Plugin candidate specification)
- `docs/architecture/plugin-platform-d01.md` (Plugin manifest schema v1)
- `docs/architecture/plugin-platform-d02.md` (Runner JSON-RPC protocol)
- `docs/architecture/plugin-platform-d03.md` (UI iframe host bridge)
- `docs/architecture/plugin-platform-d05.md` (Plugin management REST API)

All active server routing, configuration, and frontend surfaces now use the [Native Advisor Architecture](../architecture/native-advisor.md).
