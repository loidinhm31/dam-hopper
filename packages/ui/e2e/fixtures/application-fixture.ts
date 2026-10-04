import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  startApplicationServices,
  type ApplicationServices,
  type ApplicationServicesConfig,
} from "./application-services.js";
import { createBrowserStorageState } from "./application-data.js";
import {
  initEvidenceSession,
  finalizeEvidenceSession,
} from "./capture-evidence.js";

export interface ApplicationFixtureOptions {
  servicesConfig?: ApplicationServicesConfig;
}

export interface ApplicationFixtures {
  appServices: ApplicationServices;
  authenticatedContext: BrowserContext;
  authenticatedPage: Page;
}

/**
 * Extended Playwright test runner providing isolated containerized backend services,
 * deterministic database seeds, and preauthenticated browser contexts per test.
 */
export const test = base.extend<ApplicationFixtures & ApplicationFixtureOptions>({
  servicesConfig: [undefined, { option: true }],

  appServices: async ({ servicesConfig }, use, testInfo) => {
    const services = await startApplicationServices(servicesConfig);
    initEvidenceSession({
      seedDigest: services.seedDigest,
    });
    try {
      await use(services);
    } finally {
      let disposeErr: unknown = null;
      try {
        await services.dispose();
      } catch (err) {
        disposeErr = err;
        throw err;
      } finally {
        await finalizeEvidenceSession({
          testPassed: testInfo.status === "passed" && !disposeErr,
          cleanupPassed: !disposeErr,
        });
      }
    }
  },

  authenticatedContext: async ({ browser, appServices }, use) => {
    const profileId = randomUUID();
    const storageState = createBrowserStorageState({
      appOrigin: appServices.appOrigin,
      profileId,
      token: appServices.token,
      username: appServices.username,
    });

    const context = await browser.newContext({
      storageState,
      baseURL: appServices.appOrigin,
    });

    try {
      await use(context);
    } finally {
      await context.close();
    }
  },

  authenticatedPage: async ({ authenticatedContext, appServices }, use) => {
    const page = await authenticatedContext.newPage();
    await page.goto(appServices.appOrigin);
    await use(page);
    await page.close();
  },
});

export { expect };
export type { ApplicationServices } from "./application-services.js";
