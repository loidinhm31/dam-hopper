#!/usr/bin/env node
/**
 * scripts/run-semantic-browser-qualification.mjs
 *
 * Minimal test-only helper launched by `server/tests/semantic_resource_qualification.rs`
 * during `live_semantic_navigation_qualification`.
 *
 * Reads a 0600 temporary bootstrap file (`SEMANTIC_QUAL_BOOTSTRAP_FILE`), starts a
 * short-lived loopback HTTP control endpoint on `127.0.0.1:0` with a one-time random
 * path secret, and runs the focused Chromium Vitest browser qualification suite
 * (`packages/ui/browser-tests/semantic-threshold-qualification.browser.ts`) without
 * exposing tokens or secrets on command-line arguments or stdout/stderr logs.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
const UI_DIR = resolve(REPO_ROOT, "packages/ui");

async function main() {
  const bootstrapFile = process.env.SEMANTIC_QUAL_BOOTSTRAP_FILE;
  if (!bootstrapFile || !existsSync(bootstrapFile)) {
    throw new Error("SEMANTIC_QUAL_BOOTSTRAP_FILE is required and must exist");
  }

  const rawBootstrap = JSON.parse(readFileSync(bootstrapFile, "utf8"));
  const {
    serverUrl,
    wsUrl,
    token,
    project,
    configuredRoot,
    expectedThresholdBytes,
    candidateThresholdBytes,
    outputFile,
  } = rawBootstrap;

  if (!serverUrl || !wsUrl || !token || !project || !configuredRoot || !outputFile) {
    throw new Error("Bootstrap file is missing required fields");
  }

  const nonce = randomBytes(24).toString("hex");
  const bootstrapRoute = `/qual-bootstrap/${nonce}`;
  const resultRoute = `${bootstrapRoute}/result`;
  let receivedResult = null;

  const controlServer = createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin !== "http://127.0.0.1:15173" && origin !== "http://localhost:15173") {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === bootstrapRoute) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          serverUrl,
          wsUrl,
          token,
          project,
          configuredRoot,
          expectedThresholdBytes,
          candidateThresholdBytes,
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url === resultRoute) {
      let body = "";
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          res.writeHead(413).end();
          req.destroy();
          return;
        }
        body += String(chunk);
      });
      req.on("end", () => {
        if (res.writableEnded) return;
        try {
          receivedResult = JSON.parse(body);
          writeFileSync(outputFile, JSON.stringify(receivedResult, null, 2) + "\n", {
            mode: 0o600,
          });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const listenWait = Promise.withResolvers();
  controlServer.once("error", listenWait.reject);
  controlServer.listen(0, "127.0.0.1", () => listenWait.resolve());
  await listenWait.promise;

  const addr = controlServer.address();
  const controlPort = typeof addr === "object" && addr ? addr.port : 0;
  const controlBootstrapUrl = `http://127.0.0.1:${controlPort}${bootstrapRoute}`;

  try {
    const childEnv = { ...process.env };
    delete childEnv.SEMANTIC_QUAL_BOOTSTRAP_FILE;
    childEnv.VITE_DAM_HOPPER_SERVER_URL = controlBootstrapUrl;
    // Qualification publishes numeric aggregates, never source-bearing captures.
    childEnv.E2E_CAPTURE = "0";

    const runWait = Promise.withResolvers();
    const proc = spawn(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.browser.config.ts",
        "browser-tests/semantic-threshold-qualification.browser.ts",
      ],
      {
        cwd: UI_DIR,
        env: childEnv,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Drain without retaining raw diagnostics, source, paths, or credentials.
    proc.stdout.resume();
    proc.stderr.resume();
    const deadline = setTimeout(() => {
      try { process.kill(-proc.pid, "SIGKILL"); } catch {}
    }, 180_000);
    proc.on("error", (error) => {
      clearTimeout(deadline);
      runWait.reject(error);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(deadline);
      runWait.resolve({ code: code ?? 1, signal: signal ?? null });
    });

    const vitestResult = await runWait.promise;

    if (vitestResult.code !== 0 || !receivedResult || receivedResult.status !== "MEASURED") {
      const failurePayload = receivedResult ?? {
        status: "FAILED",
        expectedThresholdBytes,
        negotiatedThresholdBytes: null,
        error: `Vitest browser qualification exited with code ${vitestResult.code}`,
      };
      failurePayload.vitestExitCode = vitestResult.code;
      failurePayload.vitestSignal = vitestResult.signal;
      writeFileSync(outputFile, JSON.stringify(failurePayload, null, 2) + "\n", {
        mode: 0o600,
      });
      process.stderr.write(`Browser qualification failed (exit=${vitestResult.code}); aggregate preserved.\n`);
      process.exitCode = 1;
    }
  } finally {
    const closeWait = Promise.withResolvers();
    controlServer.close(() => closeWait.resolve());
    await closeWait.promise;
  }
}

main().catch((err) => {
  process.stderr.write(`run-semantic-browser-qualification error: ${err?.message ?? err}\n`);
  process.exit(1);
});
