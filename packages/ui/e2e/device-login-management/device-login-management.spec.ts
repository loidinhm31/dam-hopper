import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures/application-fixture.js";
import { captureApplicationCheckpoint } from "../fixtures/capture-evidence.js";
import type { Page } from "@playwright/test";

async function openServerSettings(page: Page): Promise<void> {
  await expect(page.locator('button[title="Show menu"], button[title="Hide menu"]').first()).toBeVisible();
  const showMenu = page.locator('button[title="Show menu"]').first();
  if (await showMenu.isVisible()) await showMenu.click();
  await page.locator('button[title^="Server connections:"]').first().click();
  await page.locator('button[title="Edit profile"]').first().click();
  await expect(page.getByRole("region", { name: "Login devices" })).toBeVisible();
}

function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0; let value = 0;
  const bytes: number[] = [];
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(character); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const caseDir = fileURLToPath(new URL(".", import.meta.url));
test.use({ viewport: { width: 1440, height: 900 }, servicesConfig: {
  authBackend: "sqlite", additionalUsernames: ["foreign-device-user"],
} });

test("manages real SQLite account logins through the full app at desktop and 320px", async ({ appServices, authenticatedPage: page }) => {
  test.setTimeout(120_000);
  expect(appServices.mongoContainerId).toBe("");
  const origin = appServices.appOrigin;
  const hint = `Unverified client <script>not markup</script> ${"LongClientHint".repeat(34)}`;
  async function post(endpoint: string, body: object) {
    const response = await fetch(`${origin}/api/auth/${endpoint}`, { method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": hint }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    return response.json();
  }
  // Real MFA enrollment issues a second session for the seeded account. No intercepted responses.
  const challenge = await post("login", { username: appServices.username, password: "StrongPassword123!" });
  expect(challenge.state).toBe("enrollmentRequired");
  const setup = await post("mfa/setup", { challengeToken: challenge.challengeToken });
  const sibling = await post("mfa/confirm", { challengeToken: challenge.challengeToken, code: totp(setup.secret) });
  expect(sibling.state).toBe("authenticated");
  const listed = await appServices.fetchApi("/api/auth/sessions");
  expect(listed.status).toBe(200);
  const inventory = await listed.json() as { sessions: Array<{ id: string; current: boolean; userAgent: string | null }> };
  expect(inventory.sessions).toHaveLength(2);
  expect(inventory.sessions.filter((row) => row.current)).toHaveLength(1);
  const other = inventory.sessions.find((row) => !row.current)!;
  expect(other.userAgent).toContain("<script>not markup</script>");
  const foreign = appServices.additionalSessions[0];
  expect(inventory.sessions.some((row) => row.id === foreign.sessionId)).toBe(false);
  expect((await appServices.fetchApi(`/api/auth/sessions/${foreign.sessionId}`, { method: "DELETE" })).status).toBe(404);

  await page.goto(`${origin}/workspace`);
  await openServerSettings(page);
  const section = page.getByRole("region", { name: "Login devices" });
  await expect(section.getByText("This session", { exact: true })).toBeVisible();
  await expect(section.getByText("Unknown browser/client", { exact: true })).toBeVisible();
  const otherRow = section.locator(`li[data-session-id="${other.id}"]`);
  await expect(otherRow).toContainText("<script>not markup</script>");
  await expect(otherRow.locator("script")).toHaveCount(0);
  await otherRow.getByRole("button", { name: "Revoke access", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Revoke this login?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await fetch(`${origin}/api/projects`, { headers: { Authorization: `Bearer ${sibling.token}` } })).status).toBe(200);
  await captureApplicationCheckpoint(page, { caseDir, checkpointName: "desktop-login-devices" });

  // Reopen through the narrow navigation, without coupling to whether TopNav
  // happens to preserve or remount a dialog while crossing its breakpoint.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 667 });
  await openServerSettings(page);
  await expect(section.getByText("This session", { exact: true })).toBeVisible();
  await expect(section.getByText("Unknown browser/client", { exact: true })).toBeVisible();
  await otherRow.scrollIntoViewIfNeeded();
  expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await captureApplicationCheckpoint(page, { caseDir, checkpointName: "narrow-login-devices" });
  await otherRow.getByRole("button", { name: "Revoke access", exact: true }).click();
  await expect(confirmation).toBeVisible();
  await expect.poll(() => confirmation.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (const label of ["Cancel", "Revoke access"]) {
    const box = await confirmation.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  }
  await confirmation.getByRole("button", { name: "Revoke access", exact: true }).click();
  await expect(otherRow).toHaveCount(0);
  expect((await fetch(`${origin}/api/projects`, { headers: { Authorization: `Bearer ${sibling.token}` } })).status).toBe(401);
  expect((await appServices.fetchApi("/api/projects")).status).toBe(200);
  expect((await fetch(`${origin}/api/projects`, { headers: { Authorization: `Bearer ${foreign.token}` } })).status).toBe(200);

  const currentRow = section.locator(`li[data-session-id="${appServices.sessionId}"]`);
  await currentRow.getByRole("button", { name: "Revoke access", exact: true }).click();
  const selfConfirmation = page.getByRole("dialog", { name: "End this login?" });
  await expect(selfConfirmation).toContainText("This ends this login");
  await captureApplicationCheckpoint(page, { caseDir, checkpointName: "narrow-self-revoke-confirmation" });
  await selfConfirmation.getByRole("button", { name: "Revoke access", exact: true }).click();
  await expect(section.getByText("Log in and save this profile to manage its logins.", { exact: true })).toBeVisible();
  // Existing validation intentionally prevents Save without a tested token.
  // A revoked draft must not remain eligible to save/reconnect the dead login.
  await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => {
    const profileId = localStorage.getItem("damhopper_active_profile_id");
    return profileId ? localStorage.getItem(`damhopper_profile_auth_v2_${profileId}`) : "missing profile";
  })).toBeNull();
  expect((await appServices.fetchApi("/api/projects")).status).toBe(401);
  expect((await fetch(`${origin}/api/projects`, { headers: { Authorization: `Bearer ${foreign.token}` } })).status).toBe(200);
});
