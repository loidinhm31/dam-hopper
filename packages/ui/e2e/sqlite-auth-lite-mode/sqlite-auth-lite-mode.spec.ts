import { createHmac } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";

function decodeBase32(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = base32.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid Base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secretBase32: string, stepOffset = 0): string {
  const key = decodeBase32(secretBase32);
  const step = BigInt(Math.floor(Date.now() / 1000 / 30) + stepOffset);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(step);
  const digest = createHmac("sha1", key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function assertBoxInsideBodyAndViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  bodyBox: { x: number; y: number; width: number; height: number } | null,
  viewportWidth: number,
  viewportHeight: number,
): void {
  expect(box).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(bodyBox!.x - 2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    bodyBox!.x + bodyBox!.width + 2,
  );
  expect(box!.y).toBeGreaterThanOrEqual(bodyBox!.y - 2);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    bodyBox!.y + bodyBox!.height + 2,
  );
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASE_DIR = __dirname;

test.describe("SQLite Authentication Lite Mode Real Application Journey", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.use({
    viewport: { width: 1440, height: 900 },
    servicesConfig: { authBackend: "sqlite" },
  });

  test("boots containerized server in SQLite lite mode without MongoDB, enforces auth & disabled-by-default registration, and renders authenticated admin workbench", async ({
    appServices,
    authenticatedPage: page,
  }) => {
    // 1. Verify no MongoDB container was started and SQLite auth.db exists inside the container
    expect(appServices.mongoContainerId).toBe("");
    expect(appServices.databaseName).toBe(
      "/e2e/home/.config/dam-hopper/auth.db",
    );
    const dbStat = await appServices.statContainerFile(
      "/e2e/home/.config/dam-hopper/auth.db",
    );
    expect(dbStat.size).toBeGreaterThan(0);

    // 2. Verify unauthenticated REST access is rejected (not --no-auth)
    const unauthRes = await fetch(`${appServices.appOrigin}/api/projects`);
    expect(unauthRes.status).toBe(401);

    // 3. Verify authenticated status against SQLite session store
    const statusRes = await appServices.fetchApi("/api/auth/status");
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as {
      authenticated: boolean;
      user: string;
      role: string;
      devMode?: boolean;
    };
    expect(statusBody.authenticated).toBe(true);
    expect(statusBody.user).toBe("admin");
    expect(statusBody.role).toBe("admin");
    expect(statusBody.devMode).toBeUndefined();

    // 4. Verify registration endpoint is disabled (404 Not Found)
    const regRes = await fetch(`${appServices.appOrigin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "pending_e2e_user",
        password: "StrongPassword123!",
      }),
    });
    expect(regRes.status).toBe(404);
    const loginRes = await fetch(`${appServices.appOrigin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "pending_e2e_user",
        password: "StrongPassword123!",
      }),
    });
    expect(loginRes.status).toBe(401);
    const loginBody = (await loginRes.json()) as { code: string };
    expect(loginBody.code).toBe("INVALID_CREDENTIALS");

    // 5. Navigate to Settings and verify healthy surviving controls backed by SQLite auth
    await page.goto(`${appServices.appOrigin}/settings`);
    const targetSelect = page.locator("#settings-target-select");
    await expect(targetSelect).toBeVisible({ timeout: 15_000 });
    const options = await targetSelect.locator("option").all();
    if (options.length > 1) {
      const val = await options[1].getAttribute("value");
      if (val) {
        await targetSelect.selectOption(val);
      }
    }

    // 6. Navigate to Workspace, assert workbench rendered healthy root tools (explorer / terminal), and capture visual checkpoint
    await page.goto(`${appServices.appOrigin}/workspace`);
    const explorerBtn = page
      .locator('button[aria-label="Explorer"]')
      .first();
    await expect(explorerBtn).toBeVisible({ timeout: 15_000 });
    const terminalBtn = page
      .locator('button[aria-label="Terminal"]')
      .first();
    await expect(terminalBtn).toBeVisible({ timeout: 15_000 });
    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
    });

    // 7. Mobile viewport (375x667) MFA enrollment & verification flow in ServerSettingsDialog
    await page.setViewportSize({ width: 375, height: 667 });

    const showMenuBtn = page.locator('button[title="Show menu"]').first();
    if (await showMenuBtn.isVisible()) {
      await showMenuBtn.click();
    }

    const connectionsBtn = page
      .locator('button[title^="Server connections:"]')
      .first();
    await expect(connectionsBtn).toBeVisible({ timeout: 10_000 });
    await connectionsBtn.click();

    const editProfileBtn = page.locator('button[title="Edit profile"]').first();
    await expect(editProfileBtn).toBeVisible({ timeout: 10_000 });
    await editProfileBtn.click();

    const dialogBody = page.getByTestId("server-settings-dialog-body");
    await expect(dialogBody).toBeVisible({ timeout: 10_000 });

    const passwordInput = dialogBody.locator('input[type="password"]');
    await passwordInput.fill("StrongPassword123!");

    const testConnBtn = dialogBody.getByRole("button", {
      name: "Test connection",
    });
    await testConnBtn.click();

    // Enrollment challenge opens with QR code, code input, and Confirm & Enroll button visible inside mobile scroll body
    const qrCode = dialogBody.getByTestId("mfa-qr-code");
    await expect(qrCode).toBeVisible({ timeout: 10_000 });
    const codeInput = dialogBody.locator("#mfa-code-input");
    const confirmEnrollBtn = dialogBody.getByRole("button", {
      name: "Confirm & Enroll",
    });
    await expect(codeInput).toBeVisible();
    await expect(confirmEnrollBtn).toBeVisible();

    // Reveal manual setup key to compute valid TOTP confirmation code
    const showManualKeyBtn = dialogBody.getByRole("button", {
      name: /Show setup key/i,
    });
    await showManualKeyBtn.click();
    const manualKeyInput = dialogBody.locator("#mfa-manual-key");
    await expect(manualKeyInput).toBeVisible();
    const base32Secret = await manualKeyInput.inputValue();
    expect(base32Secret.length).toBeGreaterThanOrEqual(16);

    // Focus code input and enter TOTP code (stepOffset = 0), verifying both input and Confirm & Enroll are within mobile scroll body bounds
    await codeInput.focus();
    await codeInput.fill(generateTotpCode(base32Secret, 0));

    const bodyBoxEnroll = await dialogBody.boundingBox();
    const inputBoxEnroll = await codeInput.boundingBox();
    const confirmBoxEnroll = await confirmEnrollBtn.boundingBox();
    assertBoxInsideBodyAndViewport(inputBoxEnroll, bodyBoxEnroll, 375, 667);
    assertBoxInsideBodyAndViewport(confirmBoxEnroll, bodyBoxEnroll, 375, 667);

    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "mobile-mfa-enrollment",
    });

    await confirmEnrollBtn.click();
    await expect(dialogBody.getByText("Reachable")).toBeVisible({
      timeout: 10_000,
    });

    // 8. Re-run Test connection for the now-enrolled account to trigger mfaRequired verification flow on mobile (375x667)
    await passwordInput.fill("StrongPassword123!");
    await testConnBtn.click();

    const verifyContinueBtn = dialogBody.getByRole("button", {
      name: "Verify & Continue",
    });
    await expect(verifyContinueBtn).toBeVisible({ timeout: 10_000 });
    await codeInput.fill(generateTotpCode(base32Secret, 1));

    const bodyBoxVerify = await dialogBody.boundingBox();
    const inputBoxVerify = await codeInput.boundingBox();
    const verifyBox = await verifyContinueBtn.boundingBox();
    assertBoxInsideBodyAndViewport(inputBoxVerify, bodyBoxVerify, 375, 667);
    assertBoxInsideBodyAndViewport(verifyBox, bodyBoxVerify, 375, 667);

    await captureApplicationCheckpoint(page, {
      caseDir: CASE_DIR,
      checkpointName: "mobile-mfa-verify",
    });

    await verifyContinueBtn.click();
    await expect(dialogBody.getByText("Reachable")).toBeVisible({
      timeout: 10_000,
    });

    await page.setViewportSize({ width: 1440, height: 900 });
  });
});
