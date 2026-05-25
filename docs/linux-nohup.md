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
# Optional. Omit to use defaults.workspace from ~/.config/dam-hopper/config.toml.
DAM_HOPPER_WORKSPACE="/path/to/workspace"
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

Only bind to `0.0.0.0` when the host is protected by a trusted network, firewall, or Tailscale. DamHopper exposes terminal, file, git, and tunnel operations for the configured workspace.

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

## Uninstall

```bash
pnpm server:stop
rm -rf ~/.config/dam-hopper/bin ~/.config/dam-hopper/server.pid ~/.config/dam-hopper/output.log
```
