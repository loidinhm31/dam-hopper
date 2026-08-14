// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshForwardHostProvider, SshForwardScopeBridge } from "./SshForwardHostContext.js";
import type { SshForwardHost } from "@/lib/ssh-forward-host.js";
import type { ServerProfileChange } from "@/api/server-config.js";

const { profileChanges, activeProfileId } = vi.hoisted(() => ({ profileChanges: new Set<(event: ServerProfileChange) => void>(), activeProfileId: { value: "33333333-3333-4333-8333-333333333333" } }));
vi.mock("@/api/server-config.js", () => ({
  getActiveProfileId: () => activeProfileId.value,
  readServerProfiles: () => ({ status: "available", profiles: [{ id: "33333333-3333-4333-8333-333333333333" }] }),
  subscribeToProfileChanges: (listener: (event: ServerProfileChange) => void) => { profileChanges.add(listener); return () => profileChanges.delete(listener); },
}));

let root: Root | null = null;
const host = (): SshForwardHost => ({
  openClient: vi.fn().mockResolvedValue({}), activateScope: vi.fn().mockResolvedValue({ scopeId: "33333333-3333-4333-8333-333333333333" }), snapshot: vi.fn(), createProfile: vi.fn(), updateProfile: vi.fn(), deleteProfile: vi.fn(), start: vi.fn(), stop: vi.fn(), restart: vi.fn(), listKeys: vi.fn(), approveHost: vi.fn(), purgeScope: vi.fn().mockResolvedValue({}), subscribe: vi.fn(() => () => {}), dispose: vi.fn(),
});
afterEach(() => { act(() => root?.unmount()); root = null; profileChanges.clear(); activeProfileId.value = "33333333-3333-4333-8333-333333333333"; });

describe("SshForwardScopeBridge", () => {
  it("deactivates an active deletion before purging with known scopes", async () => {
    const value = host(); const container = document.createElement("div"); root = createRoot(container);
    await act(async () => root?.render(<SshForwardHostProvider host={value} environment={{ kind: "nativeDesktop" }}><SshForwardScopeBridge>ok</SshForwardScopeBridge></SshForwardHostProvider>));
    await act(async () => {});
    activeProfileId.value = null;
    await act(async () => { for (const listener of profileChanges) listener({ type: "deleted", deletedProfileId: "33333333-3333-4333-8333-333333333333", knownProfileIds: { status: "available", ids: [] } }); });
    expect(value.activateScope).toHaveBeenLastCalledWith(null);
    expect(value.purgeScope).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", { status: "available", ids: [] });
  });
  it("does not purge when known profiles are unavailable", async () => {
    const value = host(); const container = document.createElement("div"); root = createRoot(container);
    await act(async () => root?.render(<SshForwardHostProvider host={value} environment={{ kind: "nativeDesktop" }}><SshForwardScopeBridge>ok</SshForwardScopeBridge></SshForwardHostProvider>));
    await act(async () => { for (const listener of profileChanges) listener({ type: "deleted", deletedProfileId: "other", knownProfileIds: { status: "unavailable" } }); });
    expect(value.purgeScope).not.toHaveBeenCalled();
  });
});
