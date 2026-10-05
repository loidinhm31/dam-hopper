# Client Transport and Events

Reconnect, terminal subscriptions, and transport event contracts moved from the [API reference index](../api-reference.md).
## Reconnection Flow

**Location:** `packages/ui/src/api/transport.ts`

The `Transport` interface abstracts WebSocket and REST communication. All frontend modules use `getTransport()` to access the singleton instance.

### Core Methods

**invoke<T>(channel: string, data?: unknown): Promise<T>**
Request/response messaging mapped to REST endpoints.

Example:

```ts
const sessions = await transport.invoke<Array<{ id: string }>>("terminal:list");
const newSession = await transport.invoke<SessionInfo>("terminal:create", {
  project: "api-server",
  worktreePath: "/worktrees/api-feature",
  cwd: ".",
  command: "npm run dev",
  cols: 80,
  rows: 24,
});
```

### Terminal Subscriptions

**onTerminalData(id: string, cb: (data: string) => void): () => void**
Subscribe to PTY output stream. Callback receives chunks of terminal data (plain text or ANSI codes).

Returns unsubscribe function.

**onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void**
Subscribe to basic PTY exit event.

Returns unsubscribe function.

**onTerminalExitEnhanced?(id: string, cb: (exit: {...}) => void): () => void** (Optional)
Subscribe to enhanced exit event with restart metadata.

Callback receives:

```ts
{
  exitCode: number | null;
  willRestart: boolean;
  restartIn?: number;       // milliseconds
  restartCount?: number;
  incarnation?: number;    // nonnegative safe integer identifying the PTY incarnation
}
```

Returns unsubscribe function.

The optional `incarnation` lets clients distinguish PTYs when a public session ID is
reused: a client may reject a delayed exit event from an older incarnation. Older
clients may ignore this field and continue handling exits by session ID.

**onProcessRestarted?(id: string, cb: (restart: {...}) => void): () => void** (Optional)
Subscribe to process restart event.

Callback receives:

```ts
{
  restartCount: number;
  previousExitCode: number | null;
}
```

Returns unsubscribe function.

### Session Attachment

**terminalAttach?(id: string, fromOffset?: number): boolean | void** (Optional)
Message to request buffer replay from server; returns `false` if not sent.
- `id` — Session UUID
- `fromOffset` — Optional byte offset for delta sync (omit for full buffer)

Must call `onTerminalBuffer()` listener BEFORE sending attach request to receive response.

Example:

```ts
// Setup listener first
transport.onTerminalBuffer(sessionId, ({ data, offset, reset, truncated, incarnation }) => {
  if (reset) {
    term.reset();
  }
  term.write(data); // Replay buffered content
  storeOffset(offset); // Save offset for next attach
});

// Then send attach
const sent = transport.terminalAttach(sessionId, lastKnownOffset);
```

**onTerminalBuffer?(id: string, cb: (buffer: { data: string; offset: number; reset: boolean; truncated: boolean; incarnation: number }) => void): () => void** (Optional)
Subscribe to buffer replay response from `terminal:attach` request.

Callback receives:

```ts
{
  data: string;        // Terminal content chunk
  offset: number;      // Current byte offset
  reset: boolean;      // True if client should reset local terminal buffer
  truncated: boolean;  // True if requested offset was evicted or unserviceable
  incarnation: number; // Nonnegative safe integer identifying the PTY incarnation
}
```
Use case: On reconnect, request buffered terminal output to show user previous session content.

Returns unsubscribe function.

### Terminal Control

**terminalWrite(id: string, data: string): void**
Fire-and-forget message to send input to PTY stdin.

**terminalResize(id: string, cols: number, rows: number): void**
Fire-and-forget message to resize PTY dimensions.

#### PTY, process, TCP, and automatic admission observation (server-internal)

The REST and WebSocket terminal contracts do not expose activity snapshots,
root identities, raw-output counters, input revisions, watcher revisions,
process evidence, socket ownership, TCP counters, or diagnostic payloads.
`terminalWrite` remains fire-and-forget: nonempty input passes through the
manager's handoff/closing/disposal/session admission gate, while empty input is
a no-op. Rejected input has no acknowledgement or replay path.

`ProcessDiscovery`/`ProcessSource`, `SocketDiagnosticsSource`/`LinuxSocketDiagnostics`,
and the idle-suspend transactional sampler and manager admission are private server
seams. The only public activity surface is the bounded `activity` member of
`GET /api/system/idle-suspend/v1/status`; it does not expose an endpoint,
WebSocket message, process arguments, socket details, or raw diagnostics.
See [PTY Activity Observation](../pty-activity-observation.md),
[Configured-Agent Process Discovery](../agent-activity-process-discovery.md),
[Owned TCP Byte Observation](../tcp-activity-observation.md), and [Agent Activity
Automatic Admission](../agent-activity-automatic-admission.md).

### Event Subscriptions

**onEvent(channel: string, cb: (payload: unknown) => void): () => void**
Subscribe to push events (git:progress, workspace:changed, etc.).

Returns unsubscribe function.

**onStatusChange?(cb: (status: string) => void): () => void** (Optional)
Subscribe to WebSocket connection status changes.

Status values: `"connecting"`, `"connected"`, `"disconnected"`, `"error"`

Returns unsubscribe function.


