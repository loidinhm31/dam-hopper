# Trusted Plugin Platform — Phase D02

**Status:** Implemented 2026-09-21. D02 supplies the owner-account runner,
Unix-socket API boundary, real Node worker process, per-installation
supervision, and service hardening. It is trusted same-identity execution, not
a malicious-code sandbox. D03 still owns the authenticated API façade and
actor/target authorization.

- [D00 contracts](../plugin-platform-d00.md)
- [D01 registry and trust staging](./plugin-platform-d01.md)
- [D02 implementation plan](../../plans/260920-1603-plugin-platform/phase-02-owner-runner.md)
- [D03 authorized API plan](../../plans/260920-1603-plugin-platform/phase-03-authorized-api.md)
- [System architecture](../system-architecture.md)
- [Code standards](../code-standards.md)

## Ownership and process topology

The API never starts plugin code. systemd starts the runner under the configured
non-root owner account; the runner lazily activates at most one Node process per
enabled installation. The D01 registry remains the durable installation and
package reference.

```text
DamHopper API
    │ RunnerClient: framed JSON-RPC over AF_UNIX
    ▼
RunnerServer (owner process)
    │ one SupervisorManager entry per installation
    ▼
InstallationSupervisor
    │ one WorkerProcess per active installation generation
    ▼
Node worker (immutable D01 package root, private pipes)
```

`server/src/bin/dam-hopper-plugin-runner.rs` composes the registry,
`SupervisorManager`, and `RunnerServer`. `runner_server.rs` owns API sessions;
`runner_client.rs` is the API-side client; `worker_supervisor.rs` owns
activation, contexts, deadlines, cancellation, and crash accounting;
`worker_process.rs` owns child process I/O and process-group teardown.

## `dam-hopper-plugin-runner` binary

The Clap entrypoint creates the registry layout, starts the supervisor manager,
installs SIGINT/SIGTERM (or Ctrl-C) shutdown handling, and removes the socket
after `RunnerServer::run` returns. CLI options are:

| Option | Default | Contract |
| --- | --- | --- |
| `--socket-path <PATH>` | `/run/dam-hopper/plugin-runner.sock` | AF_UNIX pathname listener. |
| `--registry-dir <PATH>` | none (required) | D01 durable registry directory. |
| `--node-bin <PATH>` | `node` | Node executable used for workers. Production rendering supplies the absolute `@NODE_BIN@`; ad-hoc default resolution uses `PATH`. |
| `--expected-api-uid <UID>` | none | If set, only this API UID passes peer validation. |
| `--allow-root-peer` | false | Explicitly permits UID 0; the default rejects root peers. |

The binary seeds an empty administrator list. Administrative registry
operations are not exposed by the D02 public server dispatcher; D01/D05 own the
separately authorized management path.

## RunnerServer: authenticated local RPC

`RunnerServerConfig` contains `socket_path`, optional `expected_api_uid`, and
`allow_root_peer`. Startup and accept behavior is fail-closed:

1. Create the parent directory if absent; reject a world-writable parent unless
   it has the sticky bit.
2. Remove an existing pathname only when it is a socket. Symlinks and ordinary
   files at the socket path are rejected.
3. Bind `UnixListener` and set socket mode `0660` on Unix.
4. Query `UnixStream::peer_cred()` (`SO_PEERCRED`) for every accepted peer.
   UID 0 is rejected unless `allow_root_peer`; `expected_api_uid`, when set,
   must match exactly. Rejected peers are not handed to a connection task.

The first frame must be `runner.hello` within the five-second handshake
budget. The client supplies `hostVersion` and exact
`clientProtocolVersion: "1.0.0"`. A match returns `runnerVersion`,
`negotiatedProtocolVersion`, and the current capability list
(`advisor.scan`). A mismatch receives an explicit JSON-RPC error and the
connection closes; there is no downgrade.

After the handshake, the reader continues consuming frames and spawns one
Tokio task per request. A shared writer mutex serializes complete frames, so
responses can finish out of order without interleaving bytes. This is the
server-side half of full-duplex cancellation: a slow `plugin.invoke` does not
stop the reader from receiving `request.cancel`.

### Public D02 methods

The server dispatches only the D00 public set. Wire field names are camelCase
and IDs are non-empty strings.

| Method | Request / result boundary |
| --- | --- |
| `runner.hello` | Exact protocol/version handshake; returns runner version and capabilities. |
| `plugin.list` | Optional `includeDisabled`; returns metadata, never package bytes. |
| `plugin.readUi` | Exact installation, digest, activation generation, actor, and project target fields; returns bounded base64 bytes plus `sha256` and `size`. |
| `plugin.activate` | `installationId` and `version`; starts the installation worker and returns `activationGeneration` and `active`. |
| `plugin.deactivate` | `installationId`; stops its worker and returns `inactive`. |
| `context.open` | Actor, installation, configured target, optional worktree, allowed operations, account policy, API epoch, and activation generation; returns context ID, revisions, generation, and expiry. |
| `context.close` | Context ID and optional reason; returns `closed`. |
| `plugin.invoke` | Context ID, operation, JSON payload, optional deadline; returns `result` or a JSON-RPC error (the current bridge does not preserve every `PluginErrorCode`). |
| `request.cancel` | Context ID plus request ID; returns `accepted`, `alreadySettled`, or `unknown`. |

The SDK/schema also names management methods
(`management.stage.*`, `management.approve`, lifecycle, grants, and bindings)
and worker notifications (`worker.health`, `worker.shutdown`). They remain
separately authorized or worker-facing contracts; D02's `RunnerServer` rejects
management calls as unavailable to public peers.

The actor, target, grant, and API-epoch fields are carried in the D00 DTOs so
the next authorization boundary can bind them. D02's registry/worker path does
not yet independently authorize those values; D03 owns that fence.

## Framing and JSON-RPC 2.0

Every transport uses the same length-prefix framing:

```text
+----------------------+------------------------------+
| 4-byte unsigned BE N | N bytes UTF-8 JSON-RPC 2.0   |
+----------------------+------------------------------+
```

`FrameDecoder` accepts fragmented or coalesced input and checks the declared
length before allocating the body. The implementation bounds each payload at
16 MiB and aggregate buffered decoder input at 64 MiB, rejects invalid UTF-8,
truncated headers, malformed JSON, trailing data, arrays/batches, numeric or
empty IDs, unknown request/notification/response fields, and responses that
contain both `result` and `error`. `write_frame_async` writes and flushes one
complete frame.

The protocol constants also define a 64 KiB control budget. D02's current
framing path applies the generic 16 MiB ceiling; per-method control-size
rejection is a follow-up boundary, not a claim made by this implementation.

## RunnerClient: full-duplex API client

`RunnerClient` keeps one reconnectable session. `RunnerClientConfig` defaults:

| Field | Default |
| --- | --- |
| `socket_path` | `/run/dam-hopper/plugin-runner.sock` |
| `expected_runner_uid` | unset |
| `allow_root_peer` | `false` |
| `client_name` | `dam-hopper-api` |
| `max_reconnect_retries` | `5` |
| `reconnect_base_delay` | `50 ms` |

Before connecting, the client rejects a missing path, symlink, non-socket, or
world-writable socket. When configured, the socket owner UID and connected
peer UID must equal `expected_runner_uid`; UID 0 is rejected unless explicitly
allowed. It sends `runner.hello` and requires the exact D00 protocol version.

After handshake the stream is split. A background reader validates each frame
and routes the response by string ID into a pending `oneshot` sender. The
writer is independently locked only while writing one frame, allowing
concurrent typed calls (`hello`, list/read UI, activate/deactivate,
context-open/close, invoke, and cancel) on the same connection. IDs are
`api-req-N`; the session generation increments on each successful connection.
EOF/pipe failure drains all pending calls as `RUNNER_UNAVAILABLE`. Connect,
write, and dropped-response failures retry with exponential delays derived from
`reconnect_base_delay` up to `max_reconnect_retries`.

## WorkerProcess: private Node execution

`WorkerProcessConfig` binds `node_bin`, the immutable `package_dir`, a
package-relative `entrypoint`, `installation_id`, and a generation. Spawn
refuses a missing executable or entrypoint, then runs exactly:

- executable: configured Node path;
- one argument: resolved backend entrypoint;
- working directory: package directory;
- stdin/stdout/stderr: private piped descriptors;
- environment: `env_clear()`, then inherited `PATH` when present, `NODE_ENV=production`, and `TMPDIR=/tmp`;
- Unix process group: `process_group(0)`, with the child PID as process-group ID.

Worker stdout is protocol-only. The reader validates framed JSON-RPC and routes
responses by ID; malformed frames, invalid messages, EOF, and pipe failures
fail every pending call as `WORKER_FAILED`. Stderr is read concurrently into a
bounded diagnostic ring: each line is UTF-8-safe truncated to 1,024 bytes and
only the newest 50 lines are retained. Diagnostics are not protocol data and
are not sent to plugin callers.

Spawn requires a worker `runner.hello` response within five seconds before the
worker becomes ready. Request calls have caller-selected deadlines capped at
10 seconds for ordinary work or 30 seconds for declared long-running work.
Teardown sends `worker.shutdown`, waits up to five seconds, then escalates to
SIGTERM and SIGKILL for the entire process group. Pending requests are drained
with `WORKER_FAILED`.

## InstallationSupervisor and scheduling

`SupervisorManager` lazily creates one `InstallationSupervisor` from the D01
installation's active package digest/version and backend entrypoint. It refuses
missing or disabled installations. `deactivate_all` is called during runner
shutdown. Supervisor states are `Stopped`, `Starting`, `Ready`, `Draining`, or
`Failed(reason)`.

Activation increments the generation before spawn and publishes `Ready` only
after the worker handshake. Deactivation and crash handling clear contexts and
in-flight counters. Context IDs are `ctx:<installation-id>:<uuid>`; lookup uses
a right split so UUID hyphens remain part of the installation/context identity.
Each context records actor, target/worktree, allowed operations, policy, API
epoch, grant/binding revisions, generation, in-flight count, and a 15-minute
idle expiry.

Current admission limits are:

| Limit | Value | Behavior |
| --- | ---: | --- |
| Contexts per worker | 16 | `OVERLOADED` when full. |
| Invokes per context | 4 | `OVERLOADED` when full. |
| Invokes per worker | 16 | `OVERLOADED` when full. |
| Declared long-running invokes | 1 per worker | `OVERLOADED` when full. |
| Ordinary deadline | 10 s | Timeout returns `DEADLINE_EXCEEDED`. |
| Declared scan deadline | 30 s | Deadline is capped at 30 s. |

The full-duplex server/client path supplies a reserved **control lane** in
practice: cancellation and close requests can be read and dispatched while an
invoke is running. Admission above the caps is currently fail-fast; the
`TrackedRequestStatus::Queued` type is retained for lifecycle accounting, but
the shipped D02 code does not implement a 32-entry FIFO or fair queue. Callers
MUST treat `OVERLOADED` as immediate backpressure and MUST NOT rely on request
ordering. A future fair scheduler must preserve the same cancel/control
responsiveness without allocating queued bodies.

Cancellation is independent of invocation settlement. A matching in-flight
request sends `request.cancel` to the worker and returns `accepted`; a settled
request returns `alreadySettled`; an unknown ID returns `unknown`. A deadline,
worker EOF, or worker failure invokes crash handling, clears contexts, kills the
process group, and settles owned requests once. A context from an older
activation generation returns `CONTEXT_REVOKED` rather than reaching the new
worker.

### Durable restart budget

Crash timestamps are retained in a sliding 60-second window. The third failure
within that window crosses the `MAX_CRASH_FAILURES = 3` budget:

1. supervisor enters `Failed(reason)`;
2. `PluginRegistry::record_installation_failure` disables the installation and
   persists the updated registry revision;
3. later activation returns `RUNNER_UNAVAILABLE` until an explicit lifecycle
   action re-enables the installation.

The supervisor kills the old process group before publishing a replacement, so
an old generation cannot coexist with a new worker. A normal activation spawn
failure also contributes to the same crash window.

## systemd boundary

`deploy/systemd/dam-hopper-plugin-runner.service.in` is a template; the release
renderer supplies owner, path, and UID placeholders. The important directives
are:

| Boundary | Directives |
| --- | --- |
| Identity/runtime | `User=@ADVISOR_OWNER_USER@`, `Group=@ADVISOR_OWNER_GROUP@`, `RuntimeDirectory=dam-hopper`, `RuntimeDirectoryMode=0750`, `UMask=0027`. |
| Startup | `ExecStart=.../dam-hopper-plugin-runner --socket-path /run/dam-hopper/plugin-runner.sock --registry-dir @DAM_HOPPER_STATE_DIR@/plugins --node-bin @NODE_BIN@ --expected-api-uid @API_UID@`. |
| Lifecycle | `Restart=on-failure`, `RestartSec=3s`, `KillSignal=SIGTERM`, `KillMode=mixed`, `TimeoutStopSec=15s`. |
| Resource caps | `MemoryMax=1G`, `TasksMax=64`. |
| Hardening | `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp=true`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6`, `RestrictRealtime=true`, `RestrictSUIDSGID=true`. |
| Diagnostics | stdout/stderr to journal under `SyslogIdentifier=dam-hopper-plugin-runner`. |

The unit gives the runner owner-account access to trusted package code; these
settings are defense in depth, not a sandbox promise. D06 still must render,
install, and qualify the owner account, socket group, runtime directory, pinned
Node artifact, cgroup behavior, and rollback policy on each target Linux host.

## Evidence and known boundaries

Implementation and focused evidence are in:

- `server/tests/plugin_runner_protocol.rs`: frame round trips,
  fragmentation/coalescing, oversize rejection, strict JSON-RPC, handshake,
  version mismatch, and peer UID rejection.
- `server/tests/plugin_runner_supervision.rs`: real Node lifecycle,
  environment isolation, cancellation, UUID-bearing context routing,
  full-duplex cancellation, stale-generation rejection, and three-crash
  exhaustion.
- `plans/reports/code-review-260921-1523-phase-d02-owner-runner.md`: Cycle 2
  review and scoped validation record.

D02 deliberately does **not** claim: authenticated actor/target/grant
authorization, management RPC implementation, structured plugin error-code
round-tripping through JSON-RPC `error.data`, per-method 64 KiB control-frame
enforcement, worker-notification handling in the Rust worker reader, a fair
32-entry queue, or production Node/account packaging. Those are explicit D03,
D05, or D06 integration boundaries.

## Unresolved questions

- Which owner UID/group and shared socket group will D06 render for each
  supported distribution?
- Which immutable Node `>=22.19` artifact and absolute path will G0/D06 pin?
- Should D03 standardize `PluginErrorCode` in JSON-RPC `error.data` before the
  authorized API façade ships?
