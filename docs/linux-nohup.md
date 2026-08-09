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
release image.

Start with a canary host, observe source-availability states and alert rate for
the monitor cadence, then broaden only after the cached endpoint latency and
resource budget are acceptable. In containers, treat the reported data as that
container's namespace view. Cgroup v1 and non-Linux deep metrics are expected
to show unsupported rather than a fabricated zero.

If deep collection regresses, roll back the release binary while retaining
`GET /api/system/metrics`. Confirm the legacy endpoint remains authenticated
and cached, the browser diagnosis shows its compatible basic-metrics fallback,
and no alert subscription remains bound to the replaced server profile. Do not
use rollback to enable any deferred remediation capability.

## Uninstall

```bash
pnpm server:stop
rm -rf ~/.config/dam-hopper/bin ~/.config/dam-hopper/server.pid ~/.config/dam-hopper/output.log
```
