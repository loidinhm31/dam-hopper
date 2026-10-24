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
import fs from "node:fs";

const args = process.argv.slice(2);
let mode = "echo";
for (const arg of args) {
  if (arg.startsWith("--tsserver-path")) {
    process.stderr.write(`error: unknown option '${arg}'\n`);
    process.exit(1);
  }
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

if (mode === "oversized-frame") {
  process.stdout.write("Content-Length: 5000000\r\n\r\n{}");
}

if (mode === "oversized-header") {
  process.stdout.write("X-Padding: " + "A".repeat(9000) + "\r\n\r\n{}");
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

// Memory hog mode for portable sampled RSS enforcement tests
const retainedBuffers = [];
if (mode === "memory-hog") {
  for (let i = 0; i < 12; i++) {
    const buf = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    retainedBuffers.push(buf);
  }
}

// Spawn descendants modes
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

if (mode === "spawn-grandchildren") {
  const child = spawn(process.execPath, [
    "-e",
    `
    import("node:child_process").then(({ spawn }) => {
      spawn(process.execPath, [
        "-e",
        "process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); setInterval(() => {}, 1000);"
      ], { stdio: "ignore" });
    });
    process.on("SIGTERM", () => {});
    process.on("SIGHUP", () => {});
    setInterval(() => {}, 1000);
    `
  ], {
    stdio: "ignore"
  });
  void child;
}

if (mode === "spawn-many-descendants") {
  for (let i = 0; i < 10; i++) {
    const child = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
    ], {
      stdio: "ignore"
    });
    spawnedChildren.push(child);
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

const openDocs = new Map();
let lastInitializeParams = null;
const pendingReplies = new Map();

function buildFrameString(obj) {
  const json = JSON.stringify(obj);
  const len = Buffer.byteLength(json, "utf8");
  return `Content-Length: ${len}\r\n\r\n${json}`;
}

function handleMessage(msg) {
  if (mode === "crash-on-msg") {
    process.exit(42);
  }

  if (mode === "stuck-shutdown") {
    // Completely ignore shutdown/exit and loop forever
    return;
  }

  if (mode === "slow-init" && msg.method === "initialize") {
    const helper = spawn(process.execPath, [
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"
    ], { stdio: "ignore" });
    spawnedChildren.push(helper);
    setTimeout(() => {
      sendLspFrame({
        jsonrpc: "2.0",
        id: msg.id,
        result: { capabilities: { textDocumentSync: 2, definitionProvider: true, implementationProvider: true } }
      });
    }, 5000);
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
      const frame = buildFrameString({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
      const third = Math.floor(frame.length / 3);
      process.stdout.write(frame.slice(0, third));
      setTimeout(() => {
        process.stdout.write(frame.slice(third, third * 2));
        setTimeout(() => {
          process.stdout.write(frame.slice(third * 2));
        }, 25);
      }, 25);
    }
    return;
  }

  if (mode === "coalesce") {
    if (typeof msg.id !== "undefined") {
      const f1 = buildFrameString({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: "coalesced-1" } });
      const f2 = buildFrameString({ jsonrpc: "2.0", id: msg.id, result: { coalesced: true, echo: msg.params || {} } });
      process.stdout.write(f1 + f2);
    }
    return;
  }

  if (mode === "duplicate-reply") {
    if (typeof msg.id !== "undefined") {
      sendLspFrame({ jsonrpc: "2.0", id: msg.id, result: { duplicate: 1, echo: msg.params || {} } });
      sendLspFrame({ jsonrpc: "2.0", id: msg.id, result: { duplicate: 2, echo: msg.params || {} } });
    }
    return;
  }

  // Track document overlays in default mode
  if (msg.method === "initialize") {
    lastInitializeParams = msg.params || null;
    sendLspFrame({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        capabilities: {
          textDocumentSync: 2,
          definitionProvider: true,
          implementationProvider: true
        },
        echo: msg.params || {}
      }
    });
    return;
  }

  if (msg.method === "textDocument/didOpen") {
    const td = msg.params?.textDocument;
    if (td?.uri) {
      openDocs.set(td.uri, {
        uri: td.uri,
        languageId: td.languageId,
        version: td.version,
        text: td.text || ""
      });
    }
    return;
  }

  if (msg.method === "textDocument/didChange") {
    const td = msg.params?.textDocument;
    const changes = msg.params?.contentChanges;
    if (td?.uri && Array.isArray(changes) && changes.length > 0) {
      const existing = openDocs.get(td.uri) || { uri: td.uri, languageId: "typescript", version: 0, text: "" };
      existing.version = td.version;
      existing.text = changes[changes.length - 1].text ?? existing.text;
      openDocs.set(td.uri, existing);
    }
    return;
  }

  if (msg.method === "textDocument/didClose") {
    const td = msg.params?.textDocument;
    if (td?.uri) {
      openDocs.delete(td.uri);
    }
    return;
  }
  if (msg.method === "$/cancelRequest") {
    const cancelId = msg.params?.id;
    if (cancelId !== undefined && pendingReplies.has(cancelId)) {
      const cancelFn = pendingReplies.get(cancelId);
      try { cancelFn(); } catch {}
      pendingReplies.delete(cancelId);
    }
    return;
  }

  // Default echo mode
  if (msg.method === "shutdown") {
    if (openDocs.has("file:///stuck-on-shutdown.ts")) {
      // Simulate a session whose child refuses to exit and spawns a stubborn process
      process.on("SIGTERM", () => {});
      return;
    }
    sendLspFrame({ jsonrpc: "2.0", id: msg.id, result: null });
  } else if (msg.method === "exit") {
    for (const cancelFn of pendingReplies.values()) {
      try { cancelFn(); } catch {}
    }
    pendingReplies.clear();
    for (const child of spawnedChildren) {
      try { child.kill("SIGTERM"); } catch {}
    }
    process.exit(0);
  } else if (typeof msg.id !== "undefined") {
    const srcUri = msg.params?.textDocument?.uri;
    const srcDoc = srcUri ? openDocs.get(srcUri) : null;
    if (srcDoc?.text && srcDoc.text.includes("__CRASH_NOW__")) {
      process.exit(42);
    }
    const delayMatch = srcDoc?.text ? srcDoc.text.match(/__DELAY_MS_(\d+)__/) : null;
    const snapshotDocs = Array.from(openDocs.values()).map((d) => ({
      uri: d.uri,
      version: d.version,
      text: d.text
    }));
    const payload = {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        echo: msg.params || {},
        openDocs: snapshotDocs,
        initializationOptions: lastInitializeParams?.initializationOptions || null
      }
    };
    const barrierMatch = srcDoc?.text ? srcDoc.text.match(/__BARRIER_FILE__:([^\s\r\n]+)/) : null;
    if (barrierMatch) {
      const barrierPath = barrierMatch[1];
      fs.appendFileSync(`${barrierPath}.seen`, `${msg.id}\n`);
      const timer = setInterval(() => {
        try {
          if (fs.existsSync(barrierPath)) {
            clearInterval(timer);
            pendingReplies.delete(msg.id);
            sendLspFrame(payload);
          }
        } catch {}
      }, 25);
      pendingReplies.set(msg.id, () => clearInterval(timer));
    } else if (delayMatch) {
      const delayMs = parseInt(delayMatch[1], 10);
      const timer = setTimeout(() => {
        pendingReplies.delete(msg.id);
        sendLspFrame(payload);
      }, delayMs);
      pendingReplies.set(msg.id, () => clearTimeout(timer));
    } else {
      sendLspFrame(payload);
    }
  }
}
