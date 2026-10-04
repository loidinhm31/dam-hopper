import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";

const requestedBrowserChannel = process.env.BROWSER_CHANNEL?.trim();
const requestedExecutablePath = process.env.BROWSER_EXECUTABLE_PATH?.trim();
if (requestedBrowserChannel && requestedExecutablePath) {
  throw new Error("Set only one of BROWSER_CHANNEL or BROWSER_EXECUTABLE_PATH");
}
if (requestedExecutablePath && !existsSync(requestedExecutablePath)) {
  throw new Error(
    `BROWSER_EXECUTABLE_PATH does not exist: ${requestedExecutablePath}`,
  );
}
const systemChromiumPath = [
  requestedExecutablePath,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].find((candidate): candidate is string =>
  Boolean(candidate && existsSync(candidate)),
);
const browserLaunchOptions = requestedBrowserChannel
  ? { channel: requestedBrowserChannel }
  : systemChromiumPath
    ? { executablePath: systemChromiumPath }
    : {};

interface AdvisorFixtureInfo {
  status: string;
  port: number;
  url: string;
  token: string;
  tempHome: string;
}

let fixtureProcess: ChildProcess | null = null;
let fixtureInfo: AdvisorFixtureInfo | null = null;

function cleanupFixture() {
  if (fixtureProcess && !fixtureProcess.killed) {
    try {
      fixtureProcess.stdin?.end();
      fixtureProcess.kill("SIGTERM");
    } catch {}
    fixtureProcess = null;
  }
}

process.on("exit", cleanupFixture);
process.on("SIGINT", cleanupFixture);
process.on("SIGTERM", cleanupFixture);

function advisorRoutingFixturePlugin(): Plugin {
  return {
    name: "advisor-routing-fixture-plugin",
    async configureServer(server) {
      const serverDir = fileURLToPath(new URL("../../server", import.meta.url));
      const binaryPath = fileURLToPath(
        new URL(
          "../../server/target/debug/examples/advisor_routing_browser_fixture",
          import.meta.url,
        ),
      );

      const spawnCommand = existsSync(binaryPath) ? binaryPath : "cargo";
      const spawnArgs = existsSync(binaryPath)
        ? ["--cors-origin", "http://localhost:15174,http://127.0.0.1:15174"]
        : [
            "run",
            "--manifest-path",
            `${serverDir}/Cargo.toml`,
            "--example",
            "advisor_routing_browser_fixture",
            "--",
            "--cors-origin",
            "http://localhost:15174,http://127.0.0.1:15174",
          ];

      const {
        promise: readyPromise,
        resolve,
        reject,
      } = Promise.withResolvers<void>();
      const proc = spawn(spawnCommand, spawnArgs, {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: serverDir,
      });
      proc.unref();
      fixtureProcess = proc;

      let stdoutBuffer = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{") && trimmed.includes('"status":"ready"')) {
            try {
              fixtureInfo = JSON.parse(trimmed) as AdvisorFixtureInfo;
              resolve();
              return;
            } catch {
              // Keep waiting for full JSON
            }
          }
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });

      proc.on("exit", (code) => {
        if (!fixtureInfo) {
          reject(
            new Error(`Fixture process exited prematurely with code ${code}`),
          );
        }
      });
      await readyPromise;

      server.httpServer?.on("close", () => {
        cleanupFixture();
      });

      server.middlewares.use("/api/advisor-fixture-info", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(fixtureInfo));
      });
    },
    transformIndexHtml(html) {
      if (fixtureInfo) {
        return html.replace(
          "<head>",
          `<head><script>window.__ADVISOR_FIXTURE__ = ${JSON.stringify(fixtureInfo)};</script>`,
        );
      }
      return html;
    },
    buildEnd() {
      cleanupFixture();
    },
    closeBundle() {
      cleanupFixture();
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), advisorRoutingFixturePlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["@tanstack/react-query", "react", "react-dom"],
  },
  server: {
    port: 15174,
    strictPort: true,
  },
  test: {
    fileParallelism: false,
    include: ["browser-tests/advisor-routing.browser.tsx"],
    browser: {
      enabled: true,
      api: { port: 15174 },
      provider: playwright({ launchOptions: browserLaunchOptions }),
      instances: [{ browser: "chromium" }],
      headless: true,
    },
  },
});
