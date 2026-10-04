import { test, expect } from "./application-fixture.js";
import { runEngine } from "./container-client.js";
import { startApplicationServices } from "./application-services.js";

async function verifyResourceRemoved(containerId: string, networkId: string): Promise<void> {
  const psOutput = await runEngine([
    "ps",
    "-a",
    "--filter",
    `name=${containerId}`,
    "--format",
    "{{.ID}}",
  ]);
  expect(psOutput.trim()).toBe("");

  const netOutput = await runEngine([
    "network",
    "ls",
    "--filter",
    `name=${networkId}`,
    "--format",
    "{{.Name}}",
  ]);
  expect(netOutput.trim()).toBe("");
}

test.describe("Phase 02: Isolated Application Services (L01-L06)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("L01: Full lifecycle, health, authenticated status, and readback", async ({
    appServices,
    authenticatedPage,
  }) => {
    // 1. Health check
    const healthRes = await appServices.fetchApi("/api/health");
    expect(healthRes.status).toBe(200);

    // 2. Authenticated user status check
    const authRes = await appServices.fetchApi("/api/auth/status");
    expect(authRes.status).toBe(200);
    const authJson = (await authRes.json()) as { authenticated: boolean; user: string };
    expect(authJson.authenticated).toBe(true);
    expect(authJson.user).toBe("admin");

    // 3. Advisor safe home verification
    const advisorRes = await appServices.fetchApi("/api/advisor/status");
    expect(advisorRes.status).toBe(200);
    const advisorJson = (await advisorRes.json()) as { path?: string | null };
    expect(advisorJson.path).toContain("/e2e/home/.evcrate/advisor-history");

    // 4. Container file readback
    const readme = await appServices.readContainerFile(
      "/e2e/workspace/fixture-project/README.md",
    );
    expect(readme).toContain("fixture-project");

    // 5. Policy file readback
    const policy = (await appServices.readPolicyFile()) as { version: number };
    expect(policy.version).toBe(2);

    // 6. Authenticated page loads SPA without crashing
    await expect(authenticatedPage).toHaveTitle(/Dam\s*Hopper/i);
  });
  test("L02: Intentional assertion failure disposes all resources in finally", async () => {
    const services = await startApplicationServices({ databaseName: "dam_hopper_l02_fail" });
    const { networkId, mongoContainerId, appContainerId } = services;
    let failed = false;
    try {
      expect(services.hostPort).toBeGreaterThan(0);
      // Simulate assertion failure during test execution
      throw new Error("Simulated failure in test assertion block");
    } catch (err) {
      failed = true;
      expect((err as Error).message).toContain("Simulated failure");
    } finally {
      await services.dispose();
    }
    expect(failed).toBe(true);
    await verifyResourceRemoved(appContainerId, networkId);
    await verifyResourceRemoved(mongoContainerId, networkId);
  });


  test("L03: Partial startup failure cleanly handled", async () => {
    let errorCaught = false;
    try {
      await startApplicationServices({
        mongoImage: "invalid-nonexistent-mongo-image:definitely-absent",
      });
    } catch {
      errorCaught = true;
    }
    expect(errorCaught).toBe(true);
  });
  test("L04: Runner interruption and shutdown signal disposes owned resources", async () => {
    const services = await startApplicationServices({ databaseName: "dam_hopper_l04_sig" });
    const { networkId, mongoContainerId, appContainerId } = services;
    // Verify services ready before simulated interrupt
    const healthRes = await services.fetchApi("/api/health");
    expect(healthRes.status).toBe(200);

    // Simulate interruption teardown
    await services.dispose();

    await verifyResourceRemoved(appContainerId, networkId);
    await verifyResourceRemoved(mongoContainerId, networkId);
  });


  test("L05: Concurrency isolation between separate instances", async () => {
    const [s1, s2] = await Promise.all([
      startApplicationServices({ databaseName: "dam_hopper_concurrent_1" }),
      startApplicationServices({ databaseName: "dam_hopper_concurrent_2" }),
    ]);

    try {
      expect(s1.networkId).not.toBe(s2.networkId);
      expect(s1.hostPort).not.toBe(s2.hostPort);
      expect(s1.token).not.toBe(s2.token);

      const [res1, res2] = await Promise.all([
        s1.fetchApi("/api/auth/status"),
        s2.fetchApi("/api/auth/status"),
      ]);
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    } finally {
      await Promise.all([s1.dispose(), s2.dispose()]);
    }

    await verifyResourceRemoved(s1.appContainerId, s1.networkId);
    await verifyResourceRemoved(s2.appContainerId, s2.networkId);
  });

  test("L06: Personal-state guard against host environment poisoning", async () => {
    const originalHome = process.env.HOME;
    try {
      process.env.HOME = "/tmp/poisoned-test-personal-home";
      const services = await startApplicationServices();
      try {
        const advisorRes = await services.fetchApi("/api/advisor/status");
        expect(advisorRes.status).toBe(200);
        const json = (await advisorRes.json()) as { path?: string | null };
        expect(json.path).toContain("/e2e/home/.evcrate/advisor-history");
        expect(json.path).not.toContain("poisoned");
      } finally {
        await services.dispose();
      }
    } finally {
      process.env.HOME = originalHome;
    }
  });
  test("Disposal check: zero orphaned test containers or networks remain", async () => {
    const activeContainers = await runEngine([
      "ps",
      "-a",
      "--filter",
      "name=dam-hopper-app-",
      "--filter",
      "name=dam-hopper-mongo-",
      "--format",
      "{{.Names}}",
    ]);
    expect(activeContainers.trim()).toBe("");

    const activeNetworks = await runEngine([
      "network",
      "ls",
      "--filter",
      "name=dam-hopper-net-",
      "--format",
      "{{.Name}}",
    ]);
    expect(activeNetworks.trim()).toBe("");
  });
});
