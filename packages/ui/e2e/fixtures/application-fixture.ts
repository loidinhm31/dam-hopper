import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  startApplicationServices,
  type ApplicationServices,
  type ApplicationServicesConfig,
} from "./application-services.js";
import { createBrowserStorageState } from "./application-data.js";

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

  appServices: async ({ servicesConfig }, use) => {
    const services = await startApplicationServices(servicesConfig);
    try {
      await use(services);
    } finally {
      await services.dispose();
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
