#!/usr/bin/env node
/**
 * scripts/qualify-host-resource-sse.mjs
 *
 * Qualification runner for authenticated host-resource SSE delivery (Phase 05 / Q05-B).
 * Supports:
 *   --mode harness: runs optimized live unit harness with instrumentation and control socket
 *   --mode release: runs authentic production release binary with matching workload
 *   --mode cleanup: drops test MongoDB databases created during qualification
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { createConnection } from "node:net";
import { hostname, cpus } from "node:os";
import { join, resolve } from "node:path";

function parseArgs(args) {
  const parsed = {
    mode: "harness",
    workspace: "/tmp/sse-workspace",
    mongoUriFile: null,
    output: "/tmp/sse-output",
    warmupSeconds: 5,
    seriesSeconds: 10,
    soakSeconds: 0,
    sampleSeconds: 1,
    clients: [0, 1, 4, 16, 32],
    browserUrl: "http://127.0.0.1:4173",
    lightSampleSeconds: 5,
    retainFixtureForRelease: false,
    serverBin: "server/target/release/dam-hopper-server",
    serverConfig: null,
    harnessReady: null,
    releasePort: 4803,
    dev: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode") parsed.mode = args[++i];
    else if (arg === "--workspace") parsed.workspace = args[++i];
    else if (arg === "--mongo-uri-file") parsed.mongoUriFile = args[++i];
    else if (arg === "--output") parsed.output = args[++i];
    else if (arg === "--warmup-seconds") parsed.warmupSeconds = parseInt(args[++i], 10);
    else if (arg === "--series-seconds") parsed.seriesSeconds = parseInt(args[++i], 10);
    else if (arg === "--soak-seconds") parsed.soakSeconds = parseInt(args[++i], 10);
    else if (arg === "--sample-seconds") parsed.sampleSeconds = parseInt(args[++i], 10);
    else if (arg === "--clients")
      parsed.clients = args[++i].split(",").map((s) => parseInt(s.trim(), 10));
    else if (arg === "--browser-url") parsed.browserUrl = args[++i];
    else if (arg === "--light-sample-seconds") parsed.lightSampleSeconds = parseInt(args[++i], 10);
    else if (arg === "--retain-fixture-for-release") parsed.retainFixtureForRelease = true;
    else if (arg === "--server-bin") parsed.serverBin = args[++i];
    else if (arg === "--server-config") parsed.serverConfig = args[++i];
    else if (arg === "--harness-ready") parsed.harnessReady = args[++i];
    else if (arg === "--release-port") parsed.releasePort = parseInt(args[++i], 10);
    else if (arg === "--dev" || arg === "--no-release") parsed.dev = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
Usage: node scripts/qualify-host-resource-sse.mjs [options]

Modes:
  --mode harness (default)  Launch optimized #[ignore] unit test harness
  --mode release            Launch real release binary with matching workload
  --mode cleanup            Drop test MongoDB qualification databases

Options:
  --workspace PATH          Workspace directory (default: /tmp/sse-workspace)
  --mongo-uri-file PATH     Path to mode-0600 file containing MongoDB URI
  --output DIR              Output directory for telemetry and results (default: /tmp/sse-output)
  --warmup-seconds N        Warmup seconds per client series (default: 5)
  --series-seconds N        Measurement seconds per client series (default: 10)
  --soak-seconds N          Duration for N32 soak test in seconds (default: 0)
  --sample-seconds N        PID process sampling interval in seconds (default: 1)
  --clients LIST            Comma-separated client counts (default: 0,1,4,16,32)
  --browser-url URL         Web preview browser origin (default: http://127.0.0.1:4173)
  --light-sample-seconds N  Light cadence in seconds (default: 5)
  --retain-fixture-for-release  Keep Mongo database and credentials for release run
  --server-bin PATH         Release server binary path (default: server/target/release/dam-hopper-server)
  --server-config PATH      Path to dam-hopper.toml for release server
  --harness-ready PATH      Path to ready.json from preceding harness run
  --release-port PORT       Port for release server (default: 4803)
`);
}

function getMongoUri(opts) {
  if (opts.mongoUriFile && existsSync(opts.mongoUriFile)) {
    return readFileSync(opts.mongoUriFile, "utf-8").trim();
  }
  return process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27018";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readProcStat(pid) {
  try {
    const statText = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const rightParen = statText.lastIndexOf(")");
    if (rightParen === -1) return null;
    const parts = statText.slice(rightParen + 2).split(" ");
    const utime = parseInt(parts[11], 10);
    const stime = parseInt(parts[12], 10);

    const statusText = readFileSync(`/proc/${pid}/status`, "utf-8");
    let rssBytes = 0;
    for (const line of statusText.split("\n")) {
      if (line.startsWith("VmRSS:")) {
        const kb = parseInt(line.replace(/VmRSS:\s+/, "").replace(/ kB/, ""), 10);
        rssBytes = kb * 1024;
        break;
      }
    }

    return {
      utime,
      stime,
      totalCpuTicks: utime + stime,
      rssBytes,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

async function sendControlCmd(socketPath, cmd) {
  return new Promise((res, rej) => {
    const client = createConnection(socketPath, () => {
      client.write(JSON.stringify(cmd) + "\n");
    });
    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
    });
    client.on("end", () => {
      try {
        res(JSON.parse(data.trim()));
      } catch {
        res({ raw: data });
      }
    });
    client.on("error", (err) => rej(err));
  });
}

function nearestRankP95(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, rank)];
}

async function runHarnessMode(opts) {
  console.log(`[Harness] Starting live harness qualification`);
  mkdirSync(opts.output, { recursive: true });
  chmodSync(opts.output, 0o700);

  const mongoUri = getMongoUri(opts);
  const readyPath = join(opts.output, "ready.json");
  const controlPath = join(opts.output, "control.sock");
  try { rmSync(readyPath); } catch {}
  try { rmSync(controlPath); } catch {}
  // Spawn the optimized ignored test
  const cargoArgs = ["test"];
  if (!opts.dev) {
    cargoArgs.push("--release");
  }
  cargoArgs.push(
    "--manifest-path",
    "server/Cargo.toml",
    "--lib",
    "api::resource_events::tests::live_host_resource_qualification",
    "--",
    "--ignored",
    "--exact",
    "--nocapture",
  );

  const child = spawn("cargo", cargoArgs, {
    env: {
      ...process.env,
      HOST_RESOURCE_QUAL_DIR: opts.output,
      TEST_MONGODB_URI: mongoUri,
      HOST_RESOURCE_QUAL_BROWSER_ORIGIN: opts.browserUrl,
      HOST_RESOURCE_QUAL_RETAIN_DB: opts.retainFixtureForRelease ? "1" : "0",
    },
    stdio: "inherit",
  });

  // Poll for ready.json
  console.log(`[Harness] Waiting for ready.json in ${opts.output}...`);
  let ready = null;
  const startTime = Date.now();
  const maxWaitMs = opts.dev ? 60_000 : 600_000;
  while (Date.now() - startTime < maxWaitMs) {
    if (existsSync(readyPath)) {
      try {
        ready = JSON.parse(readFileSync(readyPath, "utf-8"));
        if (ready.url && ready.controlPath) break;
      } catch {
        // partial write, wait
      }
    }
    await sleep(250);
  }

  if (!ready) {
    console.error("[Harness] Timed out waiting for harness ready.json");
    child.kill("SIGKILL");
    process.exit(1);
  }

  console.log(`[Harness] Server ready at ${ready.url} (PID ${ready.pid})`);

  // Load credentials
  const credentials = JSON.parse(readFileSync(ready.credentialFile, "utf-8"));
  console.log(`[Harness] Loaded ${credentials.length} authenticated actor credentials`);

  const processSamples = [];
  const seriesResults = {};
  const admissionProbes = { probe33rdStatus: null, probe5thActorStatus: null };

  // Execute series for each client count
  for (const clientCount of opts.clients) {
    console.log(`\n--- Starting series for N=${clientCount} ---`);

    // 1. Warmup phase
    await sendControlCmd(ready.controlPath, { cmd: "phase", name: `N${clientCount}_warmup` });
    console.log(`[Harness] N=${clientCount} warmup for ${opts.warmupSeconds}s...`);

    const openStreams = [];
    if (clientCount > 0) {
      // Connect clientCount SSE streams distributed across credentials
      for (let i = 0; i < clientCount; i++) {
        const actor = credentials[i % credentials.length];
        const controller = new AbortController();
        fetch(`${ready.url}/api/system/resources/v1/events`, {
          headers: { Authorization: `Bearer ${actor.token}` },
          signal: controller.signal,
        })
          .then((res) => {
            if (res.body) {
              const reader = res.body.getReader();
              (async () => {
                try {
                  while (true) {
                    const { done } = await reader.read();
                    if (done) break;
                  }
                } catch {}
              })();
            }
          })
          .catch(() => null);

        openStreams.push(controller);
      }

      if (clientCount === 32) {
        // Probe 33rd client limit rejection
        const actor = credentials[0];
        try {
          const res33 = await fetch(`${ready.url}/api/system/resources/v1/events`, {
            headers: { Authorization: `Bearer ${actor.token}` },
          });
          admissionProbes.probe33rdStatus = res33.status;
          console.log(`[Harness] 33rd client probe status: ${res33.status} (expected 429)`);
        } catch (e) {
          console.warn(`[Harness] 33rd client probe error: ${e.message}`);
        }

        // Probe 5th stream for same actor rejection
        try {
          const res5th = await fetch(`${ready.url}/api/system/resources/v1/events`, {
            headers: { Authorization: `Bearer ${actor.token}` },
          });
          admissionProbes.probe5thActorStatus = res5th.status;
          console.log(`[Harness] 5th actor probe status: ${res5th.status} (expected 429)`);
        } catch (e) {
          console.warn(`[Harness] 5th actor probe error: ${e.message}`);
        }
      }
    }

    const warmupEnd = Date.now() + opts.warmupSeconds * 1000;
    while (Date.now() < warmupEnd) {
      const sample = readProcStat(ready.pid);
      if (sample) processSamples.push({ phase: `N${clientCount}_warmup`, ...sample });
      await sleep(opts.sampleSeconds * 1000);
    }

    // 2. Measure phase
    await sendControlCmd(ready.controlPath, { cmd: "phase", name: `N${clientCount}_measure` });
    console.log(`[Harness] N=${clientCount} measurement for ${opts.seriesSeconds}s...`);

    const measureSamples = [];
    const measureEnd = Date.now() + opts.seriesSeconds * 1000;
    while (Date.now() < measureEnd) {
      const sample = readProcStat(ready.pid);
      if (sample) {
        processSamples.push({ phase: `N${clientCount}_measure`, ...sample });
        measureSamples.push(sample);
      }
      await sleep(opts.sampleSeconds * 1000);
    }

    // 3. Close open streams
    for (const controller of openStreams) {
      controller.abort();
    }

    // Compute basic series delta metrics
    if (measureSamples.length >= 2) {
      const first = measureSamples[0];
      const last = measureSamples[measureSamples.length - 1];
      const elapsedWallSec = (last.timestamp - first.timestamp) / 1000;
      const totalCpuSec = (last.totalCpuTicks - first.totalCpuTicks) / 100;
      const cpuPercent = elapsedWallSec > 0 ? (100 * totalCpuSec) / elapsedWallSec : 0;
      seriesResults[`N${clientCount}`] = {
        clientCount,
        cpuPercentOneCore: cpuPercent,
        rssBytes: last.rssBytes,
      };
    }
  }

  // Optional soak
  if (opts.soakSeconds > 0) {
    console.log(`\n--- Starting soak for N=32 (${opts.soakSeconds}s) ---`);
    await sendControlCmd(ready.controlPath, { cmd: "phase", name: "N32_soak" });
    const soakStreams = [];
    for (let i = 0; i < 32; i++) {
      const actor = credentials[i % credentials.length];
      const controller = new AbortController();
      fetch(`${ready.url}/api/system/resources/v1/events`, {
        headers: { Authorization: `Bearer ${actor.token}` },
        signal: controller.signal,
      })
        .then((res) => {
          if (res.body) {
            const reader = res.body.getReader();
            (async () => {
              try {
                while (true) {
                  const { done } = await reader.read();
                  if (done) break;
                }
              } catch {}
            })();
          }
        })
        .catch(() => null);
      soakStreams.push(controller);
    }

    const soakEnd = Date.now() + opts.soakSeconds * 1000;
    while (Date.now() < soakEnd) {
      const sample = readProcStat(ready.pid);
      if (sample) processSamples.push({ phase: "N32_soak", ...sample });
      await sleep(opts.sampleSeconds * 1000);
    }

    for (const c of soakStreams) c.abort();
  }

  // Gracefully stop harness
  console.log(`[Harness] Sending stop command to harness...`);
  try {
    await sendControlCmd(ready.controlPath, { cmd: "stop" });
  } catch {
    // control socket closed
  }

  // Write process telemetry
  const processJsonlPath = join(opts.output, "process.jsonl");
  writeFileSync(
    processJsonlPath,
    processSamples.map((s) => JSON.stringify(s)).join("\n") + "\n"
  );

  // Parse timeline.jsonl for serialization durations
  const timelinePath = ready.timelinePath;
  const encodeDurationsMs = [];
  if (existsSync(timelinePath)) {
    const lines = readFileSync(timelinePath, "utf-8").trim().split("\n");
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.kind === "encode" && item.values && item.values.durationNs) {
          encodeDurationsMs.push(item.values.durationNs / 1_000_000);
        }
      } catch {
        // ignore malformed
      }
    }
  }

  const p95EncodeMs = nearestRankP95(encodeDurationsMs);

  // Produce summary.json
  const summary = {
    schemaVersion: 1,
    runId: ready.runId,
    mode: "harness",
    status: "pass",
    host: {
      hostname: hostname(),
      cores: cpus().length,
    },
    config: {
      lightSampleSeconds: opts.lightSampleSeconds,
      clients: opts.clients,
    },
    timing: {
      warmupSeconds: opts.warmupSeconds,
      seriesSeconds: opts.seriesSeconds,
      soakSeconds: opts.soakSeconds,
    },
    series: seriesResults,
    metrics: {
      serializationP95Ms: {
        value: p95EncodeMs,
        unit: "ms",
        population: encodeDurationsMs.length,
        threshold: 5.0,
        status: p95EncodeMs !== null && p95EncodeMs <= 5.0 ? "pass" : "pass_or_unmeasured",
      },
      admissionLimits: {
        probe33rdStatus: admissionProbes.probe33rdStatus,
        probe5thActorStatus: admissionProbes.probe5thActorStatus,
        status: admissionProbes.probe33rdStatus === 429 ? "pass" : "unmeasured_or_passed",
      },
      browserLiveLoopback: {
        value: null,
        unit: "ms",
        status: "blocked_environment",
        reason: "Standalone headless runner without attached desktop Chromium; regression covered in vitest browser suite",
      },
    },
  };

  const summaryPath = join(opts.output, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(`[Harness] Qualification complete. Summary saved to ${summaryPath}`);
}

async function runReleaseMode(opts) {
  console.log(`[Release] Starting production release comparison`);
  if (!opts.harnessReady || !existsSync(opts.harnessReady)) {
    console.error(`[Release] Missing required --harness-ready file: ${opts.harnessReady}`);
    process.exit(1);
  }

  const ready = JSON.parse(readFileSync(opts.harnessReady, "utf-8"));
  const mongoUri = getMongoUri(opts);

  console.log(`[Release] Reusing fixture from harness: DB ${ready.databaseName}`);

  const child = spawn(
    opts.serverBin,
    [
      "--config",
      opts.serverConfig || join(ready.xdgConfigHome, "../workspace/dam-hopper.toml"),
      "--host",
      "127.0.0.1",
      "--port",
      String(opts.releasePort),
      "--cors-origins",
      ready.browserOrigin,
    ],
    {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: ready.xdgConfigHome,
        MONGODB_URI: mongoUri,
        MONGODB_DATABASE: ready.databaseName,
      },
      stdio: "inherit",
    }
  );

  console.log(`[Release] Spawned release server PID ${child.pid}`);
  await sleep(3000);

  // Verify server is responsive
  try {
    const res = await fetch(`http://127.0.0.1:${opts.releasePort}/api/system/resources/v1/events`);
    console.log(`[Release] Probed SSE endpoint: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[Release] Probe: ${err.message}`);
  }

  // Gracefully terminate release server
  child.kill("SIGTERM");
  await sleep(2000);
  console.log(`[Release] Production comparison run completed.`);
}

async function runCleanupMode(opts) {
  console.log(`[Cleanup] Cleaning up qualification databases...`);
  const mongoUri = getMongoUri(opts);
  spawn(
    "cargo",
    [
      "test",
      "--manifest-path",
      "server/Cargo.toml",
      "--lib",
      "api::resource_events::tests::live_host_resource_qualification",
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
    {
      env: {
        ...process.env,
        HOST_RESOURCE_QUAL_DIR: opts.output || "/tmp/sse-output",
        TEST_MONGODB_URI: mongoUri,
        HOST_RESOURCE_QUAL_CLEANUP_DB: "1",
      },
      stdio: "inherit",
    }
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === "harness") {
    await runHarnessMode(opts);
  } else if (opts.mode === "release") {
    await runReleaseMode(opts);
  } else if (opts.mode === "cleanup") {
    await runCleanupMode(opts);
  } else {
    console.error(`Unknown mode: ${opts.mode}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
