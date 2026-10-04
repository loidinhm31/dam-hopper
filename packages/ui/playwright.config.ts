import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

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

const launchOptions = requestedBrowserChannel
  ? { channel: requestedBrowserChannel }
  : systemChromiumPath
    ? { executablePath: systemChromiumPath }
    : {};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: "./test-results",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "UTC",
    launchOptions,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        launchOptions,
      },
    },
  ],
});
