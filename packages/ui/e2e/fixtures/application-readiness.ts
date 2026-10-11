/**
 * Polls application health endpoint until HTTP 200 is returned.
 */
export async function waitForHealth(appOrigin: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${appOrigin}/api/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // Continue polling
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 300);
    await promise;
  }
  throw new Error(`Timeout waiting for application health at ${appOrigin} after ${timeoutMs}ms`);
}

/**
 * Validates security invariants before test execution:
 * 1. Unauthenticated request rejected (401)
 * 2. Authenticated user status verified
 * 3. Safe home points to container root (/e2e/home)
 */
export async function verifyServiceSafety(appOrigin: string, token: string): Promise<void> {
  const unauthRes = await fetch(`${appOrigin}/api/projects`);
  if (unauthRes.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated request, got ${unauthRes.status}`);
  }

  const authStatusRes = await fetch(`${appOrigin}/api/auth/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!authStatusRes.ok) {
    throw new Error(`Authenticated status check failed: ${authStatusRes.status}`);
  }

  const pathsRes = await fetch(`${appOrigin}/api/agent-status/paths`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!pathsRes.ok) {
    throw new Error(`Paths verification check failed: ${pathsRes.status}`);
  }
  const pathsData = (await pathsRes.json()) as { effectiveHome?: string | null };
  if (pathsData.effectiveHome !== "/e2e/home") {
    throw new Error(`Server resolved unsafe home path: ${pathsData.effectiveHome}`);
  }
}
