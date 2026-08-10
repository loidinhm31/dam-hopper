# Linux Nohup Setup

Use this setup to keep all DamHopper runtime files under `~/.config/dam-hopper/` and run the server with `nohup`.

## Install And Start

Build the server:

```bash
pnpm build:server
```

Copy the binary to `~/.config/dam-hopper/bin/` and restart the background process:

```bash
pnpm server:restart
```

Equivalent direct command:

```bash
deploy/run-linux-nohup.sh restart --bin server/target/release/dam-hopper-server
```

## Runtime Files

- Binary: `~/.config/dam-hopper/bin/dam-hopper-server`
- Config: `~/.config/dam-hopper/server.conf`
- Log: `~/.config/dam-hopper/output.log`
- PID: `~/.config/dam-hopper/server.pid`
- Token: `~/.config/dam-hopper/server-token`

## Configuration

Edit `~/.config/dam-hopper/server.conf`:

```ini
# Optional. Omit to use ~/.config/dam-hopper/dam-hopper.toml.
DAM_HOPPER_CONFIG="/home/user/.config/dam-hopper/dam-hopper.toml"
# Legacy directory-discovery override:
# DAM_HOPPER_WORKSPACE="/path/to/workspace"
DAM_HOPPER_HOST="0.0.0.0"
DAM_HOPPER_PORT="4800"
RUST_LOG="info"

# Optional MongoDB auth.
MONGODB_URI="mongodb://localhost:27017"
MONGODB_DATABASE="dam_hopper"
```

Restart after changes:

```bash
pnpm server:restart
```

Only bind to `0.0.0.0` when the host is protected by a trusted network, firewall, or Tailscale. DamHopper exposes terminal, file, git, and tunnel operations for the configured registry projects.

## Operate

```bash
pnpm server:status
pnpm server:start
pnpm server:stop
pnpm server:restart
tail -f ~/.config/dam-hopper/output.log
```

## Update

```bash
pnpm build:server
pnpm server:restart
```

The restart command copies the newly built binary into `~/.config/dam-hopper/bin/`, stops the old process using the pid file, and starts the new process with `nohup`.

## Host Resource Monitoring Release and Rollback

This deployment path ships read-only host-resource monitoring only. It adds no
privileged helper, IPC socket, enrollment, action lifecycle, re-authentication,
or host-mutation control. Before a staged rollout, verify that authenticated
`GET /api/system/metrics` still returns its compatible basic CPU, memory, disk,
and temperature shape; then check the versioned snapshot and alerts routes.

Container builds serve the compiled browser assets from `/opt/dam-hopper/web`.
For a nohup deployment that serves the browser from the same process, set
`DAM_HOPPER_WEB_DIR` to a separately built, readable `apps/web/dist`; otherwise
use an external browser-asset host.

Build the container from the repository `Dockerfile`; its Rust builder is pinned
to the ABI-compatible Bookworm toolchain and includes the server asset bundle.
The web stage also copies the root TypeScript configuration required by the
workspace build. Keep these inputs in the build context when producing a
release image. The Dockerfile pins its amd64 base image digests; record the
resulting image digest and deploy that immutable digest, rather than an
unqualified mutable tag. Retain the prior digest for rollback. The image must
contain monitoring-only server/web assets and must not package deferred
remediation helpers or action controls.

Build the amd64 release image explicitly on multi-platform hosts:

```bash
docker build --platform linux/amd64 --tag dam-hopper-host-resource-monitoring:release .
```

Start with a canary host, observe source-availability states and alert rate for
the monitor cadence, then broaden only after the cached endpoint latency and
resource budget are acceptable. In containers, treat the reported data as that
container's namespace view. Cgroup v1 and non-Linux deep metrics are expected
to show unsupported rather than a fabricated zero.

Before promoting a Linux canary, run the collector-only profiler from the
release checkout and attach its one-line JSON result to the change record:

```bash
bash scripts/profile-host-resource-deep-scan.sh 100 /path/to/workspace
```

It measures CPU only while deep collection runs, the largest per-collection
wall time, retained RSS delta over the requested iterations, snapshot size,
and deadline counts. Compare the CPU and wall-time peaks with the configured
deep-sampling interval and 150 ms process deadline, and keep retained RSS below
the 5 MiB Phase 03 budget. This does not replace a real non-Linux CI run, staged
canary, rollback rehearsal, or release-owner sign-off.

The Phase 07 release check set is:

```bash
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo check --manifest-path server/Cargo.toml --features vendored
cargo test --manifest-path server/Cargo.toml --features vendored
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui exec tsc -p tsconfig.json
pnpm lint
pnpm --filter @dam-hopper/ui build
pnpm build:server
docker build --platform linux/amd64 --tag dam-hopper-host-resource-monitoring:release .
```

The measured shutdown target is for no-tunnel servers only; active tunnel
disposal retains its separate three-second child-process grace period.

If deep collection regresses, roll back to the recorded prior image digest (or
release binary) while retaining `GET /api/system/metrics`. Confirm the legacy
endpoint remains authenticated and cached, the browser diagnosis shows its
compatible basic-metrics fallback, and no alert subscription remains bound to
the replaced server profile. Do not use rollback to enable any deferred
remediation capability.

## Uninstall

```bash
pnpm server:stop
rm -rf ~/.config/dam-hopper/bin ~/.config/dam-hopper/server.pid ~/.config/dam-hopper/output.log
```
