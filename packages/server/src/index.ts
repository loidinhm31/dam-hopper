#!/usr/bin/env node
/**
 * @dev-hub/server — Entry point
 *
 * Usage:
 *   node dist/index.js [--workspace <path>] [--port <port>] [--host <host>] [--new-token]
 *
 * Or via pnpm:
 *   pnpm dev:server --workspace /path/to/ws
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadOrCreateToken } from "./auth/token.js";
import { WebSocketEventSink } from "./ws/ws-event-sink.js";
import { PtySessionManager } from "./pty/session-manager.js";
import { createServerContext } from "./context.js";
import { createServer } from "./server.js";

// ── Env var defaults ──────────────────────────────────────────────────────────

process.env["GIT_TERMINAL_PROMPT"] = "0";
process.env["GIT_SSH_COMMAND"] =
  (process.env["GIT_SSH_COMMAND"] ?? "ssh") + " -o BatchMode=yes";

// ── Parse CLI args ────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  options: {
    workspace: { type: "string", short: "w" },
    port: { type: "string", short: "p" },
    host: { type: "string" },
    "new-token": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  args: process.argv.slice(2),
});

if (values.help) {
  console.log(`
dev-hub-server — Serve Dev Hub as a standalone web application

Usage:
  dev-hub-server [options]

Options:
  -w, --workspace <path>   Workspace path (required, or set DEV_HUB_WORKSPACE env var)
  -p, --port <port>        Port to listen on (default: 4800, or PORT env var)
       --host <host>        Host to bind to (default: 0.0.0.0)
       --new-token           Generate a new auth token
  -h, --help               Show this help

Examples:
  dev-hub-server --workspace ~/projects/my-app
  dev-hub-server --workspace ~/projects --port 4800 --host 127.0.0.1
`);
  process.exit(0);
}

// ── Configuration ─────────────────────────────────────────────────────────────

const workspacePath =
  values.workspace ??
  positionals[0] ??
  process.env["DEV_HUB_WORKSPACE"] ??
  process.env["DEV_HUB_WORKSPACE_PATH"];

const port = Number(values.port ?? process.env["PORT"] ?? 4800);
const host = values.host ?? process.env["HOST"] ?? "0.0.0.0";

const TOKEN_FILE = join(
  process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
  "dev-hub",
  "server-token",
);

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  // Load or generate auth token
  const tokenPath = TOKEN_FILE;
  if (values["new-token"]) {
    // Force regeneration: write empty file so loadOrCreateToken creates new one
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, "", { encoding: "utf-8", mode: 0o600 });
  }
  const authToken = await loadOrCreateToken(tokenPath);

  // Build components
  const wsSink = new WebSocketEventSink();
  const ptyManager = new PtySessionManager(wsSink);
  const ctx = createServerContext(ptyManager, wsSink);

  // Load workspace if provided
  if (workspacePath) {
    const absPath = resolve(workspacePath);
    const home = homedir();
    if (absPath !== home && !absPath.startsWith(home + "/")) {
      console.error(`❌ Workspace path must be within home directory: ${absPath}`);
      process.exit(1);
    }
    console.log(`[server] Loading workspace: ${absPath}`);
    try {
      await ctx.loadWorkspace(absPath);
      console.log(`[server] ✓ Workspace ready: ${ctx.current!.config.workspace.name}`);
    } catch (e) {
      console.error(`[server] ✗ Failed to load workspace: ${e}`);
      process.exit(1);
    }
  }

  // Create and start server
  const app = await createServer({ host, port, ctx, getToken: () => authToken });

  try {
    const address = await app.listen({ host, port });

    // ── Startup banner ──────────────────────────────────────────────────────
    console.log("\n" + "═".repeat(60));
    console.log("  🚀 Dev Hub Server");
    console.log("═".repeat(60));
    console.log(`  URL:   http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
    if (!workspacePath) {
      console.log("  ⚠ No workspace loaded — open the UI to select one");
    }
    console.log("═".repeat(60));
    console.log("  🔑 Auth Token (copy and paste into the login page):");
    console.log(`\n     ${authToken}\n`);

    if (host === "0.0.0.0") {
      console.log("  ⚠  SECURITY WARNING: Server is bound to 0.0.0.0");
      console.log("     All network interfaces are exposed. Ensure this");
      console.log("     is only reachable on a trusted network (e.g. Tailscale).");
    }
    console.log("═".repeat(60) + "\n");

    // Graceful shutdown
    const shutdown = () => {
      console.log("\n[server] Shutting down...");
      ptyManager.dispose();
      void app.close().then(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (e) {
    console.error(`[server] Failed to start: ${e}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[server] Fatal:", e);
  process.exit(1);
});
