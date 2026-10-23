/**
 * Deterministic LSP Test Server Fixture for Phase 02 Integration Tests.
 *
 * Supported modes (passed via CLI argument --mode=<name>):
 * - echo (default): standard LSP loop, replies to requests and logs notifications.
 * - fragment: sends fragmented chunks and coalesced frames.
 * - crash: exits immediately or after first request with exit code 42.
 * - delay: delays response by 5 seconds to test timeout handling.
 * - stderr-flood: emits rapid stderr lines to test bounded stderr drain without deadlocking stdout/stdin.
 * - stuck-shutdown: refuses to exit on shutdown/exit RPCs, requiring signal escalation (SIGKILL).
 * - spawn-descendants: spawns background node helpers to test process tree tracking and cleanup.
 */

import { spawn } from "node:child_process";

const args = process.argv.slice(2);
let mode = "echo";
for (const arg of args) {
  if (arg.startsWith("--mode=")) {
    mode = arg.split("=")[1];
  }
}
if (mode === "stuck-shutdown") {
  process.on("SIGTERM", () => {
    // Explicitly ignore SIGTERM to force SIGKILL signal escalation
  });
}

if (mode === "malformed-stdout") {
  process.stdout.write("InvalidHeaderWithoutColon\r\n\r\n{}");
}

// Stderr flood mode
if (mode === "stderr-flood") {
  for (let i = 0; i < 500; i++) {
    process.stderr.write(`[STDERR-LOG-FLOOD-${i}] testing bounded drain ring buffer\n`);
  }
}

// Crash immediately mode
if (mode === "crash-now") {
  process.exit(42);
}
// Spawn descendants mode
const spawnedChildren = [];
if (mode === "spawn-descendants") {
  for (let i = 0; i < 2; i++) {
    const child = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000); process.on('SIGTERM', () => process.exit(0));"
    ], {
      stdio: "ignore"
    });
    spawnedChildren.push(child);
  }
}

if (mode === "spawn-stubborn-descendants") {
  for (let i = 0; i < 2; i++) {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);"
    ], {
      stdio: "ignore"
    });
    // Do NOT add to spawnedChildren so handleMessage('exit') will NOT kill them
  }
}

function sendLspFrame(obj) {
  const json = JSON.stringify(obj);
  const len = Buffer.byteLength(json, "utf8");
  process.stdout.write(`Content-Length: ${len}\r\n\r\n${json}`);
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const delim = buffer.indexOf("\r\n\r\n");
    if (delim === -1) break;

    const header = buffer.slice(0, delim).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const len = parseInt(match[1], 10);
    const total = delim + 4 + len;
    if (buffer.length < total) break;

    const body = buffer.slice(delim + 4, total);
    buffer = buffer.slice(total);

    const msg = JSON.parse(body.toString("utf8"));
    handleMessage(msg);
  }
});

function handleMessage(msg) {
  if (mode === "crash-on-msg") {
    process.exit(42);
  }

  if (mode === "stuck-shutdown") {
    // Completely ignore shutdown/exit and loop forever
    return;
  }

  if (mode === "delay") {
    setTimeout(() => {
      if (typeof msg.id !== "undefined") {
        sendLspFrame({ jsonrpc: "2.0", id: msg.id, result: { delayed: true } });
      }
    }, 4000);
    return;
  }

  if (mode === "fragment") {
    // Send response fragmented across multiple chunks
    if (typeof msg.id !== "undefined") {
      const resp = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
      const frame = `Content-Length: ${Buffer.byteLength(resp, "utf8")}\r\n\r\n${resp}`;
      const half = Math.floor(frame.length / 2);
      process.stdout.write(frame.slice(0, half));
      setTimeout(() => {
        process.stdout.write(frame.slice(half));
      }, 50);
    }
    return;
  }

  // Default echo mode
  if (msg.method === "shutdown") {
    sendLspFrame({ jsonrpc: "2.0", id: msg.id, result: null });
  } else if (msg.method === "exit") {
    for (const child of spawnedChildren) {
      try { child.kill("SIGTERM"); } catch {}
    }
    process.exit(0);
  } else if (typeof msg.id !== "undefined") {
    sendLspFrame({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.params || {} } });
  }
}
