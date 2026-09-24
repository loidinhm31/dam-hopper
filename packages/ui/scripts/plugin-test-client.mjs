#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium, request as playwrightRequest } from "playwright";

function usage() {
  console.log(`Usage: node scripts/plugin-g2-client.mjs \\
  --session <g2-session.json> \\
  --evidence-dir <empty-directory> \\
  --client-label <device-name> \\
  --network-label <encrypted-lan-description> [--headed] [--allow-local-smoke]`);
}

function parseArgs(argv) {
  const result = { headed: false, allowLocalSmoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    if (argument === "--headed") {
      result.headed = true;
      continue;
    }
    if (argument === "--allow-local-smoke") {
      result.allowLocalSmoke = true;
      continue;
    }
    if (!argument.startsWith("--"))
      throw new Error(`Unexpected argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${argument}`);
    result[
      argument
        .slice(2)
        .replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    ] = value;
    index += 1;
  }
  for (const key of ["session", "evidenceDir", "clientLabel", "networkLabel"]) {
    if (!result[key])
      throw new Error(
        `--${key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`,
      );
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isLoopback(hostname) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

async function prepareEvidenceDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = await readdir(directory);
  assert(entries.length === 0, "evidence directory must be empty");
}

function sanitizedSession(session) {
  return {
    schemaVersion: session.schemaVersion,
    qualification: session.qualification,
    transportDeclaration: session.transportDeclaration,
    serverOrigin: session.serverOrigin,
    profileId: session.profileId,
    project: session.project,
    projectPath: session.projectPath,
    installationId: session.installationId,
    packageSha256: session.packageSha256,
    uiSha256: session.uiSha256,
    activationGeneration: session.activationGeneration,
    pluginUrl: session.pluginUrl,
    directAssetUrl: session.directAssetUrl,
  };
}

function profileSeed(session) {
  return {
    profile: {
      id: session.profileId,
      name: session.profileName,
      url: session.serverOrigin,
      authType: "basic",
      createdAt: Date.now(),
      autoConnect: true,
    },
    auth: {
      version: 2,
      serverUrl: session.serverOrigin,
      authType: "basic",
      token: session.token,
    },
    workspace: {
      state: {
        selectedProject: {
          profileId: session.profileId,
          project: session.project,
        },
      },
      version: 1,
    },
  };
}

async function seedBrowserStorage(page, session) {
  const seed = profileSeed(session);
  await page.goto(session.serverOrigin, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.evaluate((value) => {
    localStorage.setItem(
      "damhopper_server_profiles",
      JSON.stringify([value.profile]),
    );
    localStorage.setItem("damhopper_active_profile_id", value.profile.id);
    localStorage.setItem(
      `damhopper_profile_auth_v2_${value.profile.id}`,
      JSON.stringify(value.auth),
    );
    localStorage.setItem(
      "dam-hopper:workspace-state",
      JSON.stringify(value.workspace),
    );
  }, seed);
}

async function waitForReady(page) {
  await page
    .locator(".plugin-frame-status")
    .getByText("Connected", { exact: true })
    .waitFor({ timeout: 30_000 });
  const iframe = page.locator("iframe.plugin-frame");
  await iframe.waitFor({ state: "attached", timeout: 30_000 });
  return iframe;
}

async function currentPluginFrame(page) {
  const handle = await page.locator("iframe.plugin-frame").elementHandle();
  assert(handle, "plugin iframe is unavailable");
  const frame = await handle.contentFrame();
  assert(frame, "plugin iframe content frame is unavailable");
  return frame;
}

async function assertFrameIsolation(page, iframe, childRequests) {
  assert(
    (await iframe.getAttribute("sandbox")) === "allow-scripts",
    "iframe sandbox is not exactly allow-scripts",
  );
  assert(
    (await iframe.getAttribute("src")) === null,
    "opaque iframe unexpectedly has a src URL",
  );
  const hostAccess = await iframe.evaluate((element) => ({
    contentDocumentIsNull: element.contentDocument === null,
    locationReadable: (() => {
      try {
        void element.contentWindow.location.href;
        return true;
      } catch {
        return false;
      }
    })(),
  }));
  assert(
    hostAccess.contentDocumentIsNull,
    "host can read opaque frame contentDocument",
  );
  assert(!hostAccess.locationReadable, "host can read opaque frame location");

  const frame = await currentPluginFrame(page);
  const probe = await frame.evaluate(async () => {
    const access = (operation) => {
      try {
        return { blocked: false, value: operation() };
      } catch (error) {
        return { blocked: true, name: error?.name ?? "Error" };
      }
    };
    const fetchResult = await fetch("/api/health")
      .then(() => ({ blocked: false }))
      .catch((error) => ({ blocked: true, name: error?.name ?? "Error" }));
    return {
      localStorage: access(() => localStorage.length),
      sessionStorage: access(() => sessionStorage.length),
      cookie: access(() => document.cookie),
      fetch: fetchResult,
    };
  });
  assert(probe.localStorage.blocked, "opaque frame can access localStorage");
  assert(
    probe.sessionStorage.blocked,
    "opaque frame can access sessionStorage",
  );
  assert(
    probe.cookie.blocked || probe.cookie.value === "",
    "opaque frame can read cookies",
  );
  assert(probe.fetch.blocked, "opaque frame bypassed connect-src 'none'");
  assert(
    childRequests.length === 0,
    `opaque frame emitted ${childRequests.length} network request(s)`,
  );
  return probe;
}

async function runQualification(page, context, session, evidenceDir) {
  const scenarios = [];
  const screenshot = async (name) => {
    const filename = `${name}.png`;
    await page.screenshot({
      path: path.join(evidenceDir, filename),
      fullPage: true,
    });
    return filename;
  };
  const pass = (name, detail) =>
    scenarios.push({ name, status: "passed", detail });

  const start = Date.now();
  await page.goto(session.pluginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const iframe = await waitForReady(page);
  pass("authenticated remote plugin load", { elapsedMs: Date.now() - start });

  const isolation = await assertFrameIsolation(
    page,
    iframe,
    context.childRequests,
  );
  pass("opaque frame storage and network isolation", isolation);

  const frame = await currentPluginFrame(page);
  await frame
    .getByRole("heading", { name: "EVCrate Advisor Metrics Explorer" })
    .waitFor();
  await frame.getByText("Embedded Plugin Container", { exact: true }).waitFor();
  assert(
    (await frame
      .getByRole("button", { name: /choose history directory/i })
      .count()) === 0 && (await frame.locator('input[type="file"]').count()) === 0,
    "embedded plugin exposed standalone source-selection controls",
  );
  pass("embedded E03 identity", { provider: "dam-hopper" });

  await frame.getByRole("button", { name: "Refresh History" }).click();
  await frame.getByText("Fresh Snapshot", { exact: true }).waitFor({
    timeout: 30_000,
  });
  await frame
    .getByRole("tab", { name: /History Records [1-9][0-9]*/ })
    .waitFor({ timeout: 30_000 });
  const overviewScreenshot = await screenshot("01-overview");
  pass("overview refresh", { screenshot: overviewScreenshot });

  await frame.getByRole("tab", { name: "History Records" }).click();
  const inspect = frame
    .getByRole("button", { name: /Inspect consultation/ })
    .first();
  await inspect.waitFor({ timeout: 15_000 });
  await inspect.click();
  await frame
    .getByRole("button", { name: /Back|Close/ })
    .first()
    .waitFor({ timeout: 15_000 });
  const historyScreenshot = await screenshot("02-history-detail");
  pass("history list and detail", { screenshot: historyScreenshot });

  await frame.getByRole("tab", { name: "Configuration" }).click();
  await frame
    .getByRole("heading", { name: "Configuration & Route Comparisons" })
    .waitFor();
  await frame
    .getByText("Primary Route:", { exact: true })
    .waitFor({ timeout: 15_000 });
  await frame
    .getByText("Backup Route:", { exact: true })
    .waitFor({ timeout: 15_000 });
  const configurationScreenshot = await screenshot("03-configuration");
  pass("current policy configuration", { screenshot: configurationScreenshot });

  await frame.getByRole("tab", { name: "Evaluations" }).click();
  await frame
    .getByRole("heading", { name: /Counsel Evaluations \(/ })
    .waitFor({ timeout: 15_000 });
  assert(
    (await frame
      .getByRole("heading", { name: "No Counsel Evaluations Loaded" })
      .count()) === 0,
    "evaluation source is not configured",
  );
  const evaluationsScreenshot = await screenshot("04-evaluations");
  pass("counsel evaluations", { screenshot: evaluationsScreenshot });

  const authenticated = await context.authenticatedRequest.get(
    session.directAssetUrl,
  );
  assert(
    authenticated.status() === 200,
    `authenticated asset returned ${authenticated.status()}`,
  );
  const assetBytes = await authenticated.body();
  const observedHash = createHash("sha256").update(assetBytes).digest("hex");
  assert(
    observedHash === session.uiSha256,
    "authenticated asset digest differs from staged UI digest",
  );
  assert(
    (authenticated.headers()["content-type"] ?? "").startsWith("text/html"),
    "asset is not inert HTML bytes",
  );
  const anonymous = await context.anonymousRequest.get(session.directAssetUrl);
  assert(
    anonymous.status() === 401,
    `anonymous asset returned ${anonymous.status()}, expected 401`,
  );
  pass("protected inert asset", {
    authenticatedStatus: 200,
    anonymousStatus: 401,
    observedHash,
  });

  const initialFrameSession = await frame.evaluate(
    () => window.__FRAME_SESSION__,
  );
  const websocketCount = context.websockets.length;
  const navigationLink = page.getByRole("link", { name: "Advisor Metrics" });
  if ((await navigationLink.count()) > 0) {
    await navigationLink.first().click();
    await page.waitForTimeout(250);
    assert(
      context.websockets.length === websocketCount,
      "same-route navigation opened a duplicate WebSocket",
    );
    const sameFrame = await currentPluginFrame(page);
    assert(
      (await sameFrame.evaluate(() => window.__FRAME_SESSION__)) ===
        initialFrameSession,
      "same-route navigation replaced the active frame session",
    );
  }
  pass("same-route connection reuse", { websocketCount });

  await page.evaluate(
    ({ invalidProfile, project }) => {
      localStorage.setItem(
        "dam-hopper:workspace-state",
        JSON.stringify({
          state: { selectedProject: { profileId: invalidProfile, project } },
          version: 1,
        }),
      );
    },
    {
      invalidProfile: "00000000-0000-4000-8000-000000000000",
      project: session.project,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  assert(
    (await page.locator("iframe.plugin-frame").count()) === 0,
    "stale plugin frame survived owner switch",
  );
  pass("profile owner switch revocation", { switchedToUnavailableOwner: true });

  await page.evaluate(
    ({ profileId, project }) => {
      localStorage.setItem(
        "dam-hopper:workspace-state",
        JSON.stringify({
          state: { selectedProject: { profileId, project } },
          version: 1,
        }),
      );
    },
    { profileId: session.profileId, project: session.project },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForReady(page);
  const reloadedFrame = await currentPluginFrame(page);
  const reloadedFrameSession = await reloadedFrame.evaluate(
    () => window.__FRAME_SESSION__,
  );
  assert(
    reloadedFrameSession !== initialFrameSession,
    "full reload reused a stale frame session fence",
  );
  pass("reload creates fresh frame fence", { changed: true });

  return scenarios;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await prepareEvidenceDirectory(args.evidenceDir);
  const startedAt = new Date().toISOString();
  const session = JSON.parse(await readFile(args.session, "utf8"));
  assert(
    session.schemaVersion === 1 && session.qualification === "D04-E03-G2",
    "unsupported session descriptor",
  );
  assert(
    typeof session.token === "string" && session.token.length > 0,
    "session token is missing",
  );
  const serverUrl = new URL(session.serverOrigin);
  const localSmoke = session.transportDeclaration === "LocalSmoke";
  assert(
    !localSmoke || args.allowLocalSmoke,
    "LocalSmoke sessions require --allow-local-smoke and do not satisfy G2",
  );
  if (!localSmoke) {
    assert(
      !isLoopback(serverUrl.hostname),
      "G2 requires a server reachable from a separate client host",
    );
    assert(
      session.transportDeclaration === "Https" ||
        session.transportDeclaration === "TrustedEncryptedLan",
      "G2 requires an encrypted transport declaration",
    );
  }

  const evidence = {
    schemaVersion: 1,
    qualification: "D04-E03-G2",
    status: "running",
    startedAt,
    completedAt: null,
    client: {
      label: args.clientLabel,
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    network: {
      label: args.networkLabel,
      transportDeclaration: session.transportDeclaration,
    },
    session: sanitizedSession(session),
    browser: null,
    scenarios: [],
    diagnostics: {
      consoleErrors: [],
      pageErrors: [],
      childFrameRequests: [],
      websockets: [],
      rttMs: [],
    },
    error: null,
  };

  let browser;
  let authenticatedRequest;
  let anonymousRequest;
  try {
    browser = await chromium.launch({ headless: !args.headed });
    evidence.browser = {
      name: "chromium",
      version: browser.version(),
      headed: args.headed,
    };
    authenticatedRequest = await playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${session.token}` },
    });
    anonymousRequest = await playwrightRequest.newContext();
    for (let index = 0; index < 3; index += 1) {
      const start = performance.now();
      const response = await authenticatedRequest.get(
        `${session.serverOrigin}/api/health`,
      );
      assert(response.ok(), `health probe returned ${response.status()}`);
      evidence.diagnostics.rttMs.push(
        Math.round((performance.now() - start) * 10) / 10,
      );
    }

    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    await seedBrowserStorage(page, session);
    const context = {
      authenticatedRequest,
      anonymousRequest,
      childRequests: evidence.diagnostics.childFrameRequests,
      websockets: evidence.diagnostics.websockets,
    };
    page.on("console", (message) => {
      if (message.type() === "error")
        evidence.diagnostics.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) =>
      evidence.diagnostics.pageErrors.push(error.message),
    );
    page.on("websocket", (socket) => {
      const url = new URL(socket.url());
      if (url.searchParams.has("token")) {
        url.searchParams.set("token", "[REDACTED]");
      }
      evidence.diagnostics.websockets.push(url.toString());
    });
    page.on("request", (request) => {
      try {
        if (request.frame().parentFrame())
          context.childRequests.push(request.url());
      } catch {
        context.childRequests.push("detached-frame-request");
      }
    });

    evidence.scenarios = await runQualification(
      page,
      context,
      session,
      args.evidenceDir,
    );
    evidence.status = localSmoke ? "local-smoke-passed" : "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    evidence.completedAt = new Date().toISOString();
    await writeFile(
      path.join(args.evidenceDir, "g2-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { mode: 0o600 },
    );
    await anonymousRequest?.dispose();
    await authenticatedRequest?.dispose();
    await browser?.close();
  }

  console.log(
    `G2_CLIENT_PASS evidence=${path.join(args.evidenceDir, "g2-evidence.json")} status=${evidence.status}`,
  );
}

await main();
