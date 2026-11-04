// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { PortsPanel } from "./PortsPanel.js";
import type { PortEntry } from "@/hooks/use-ports.js";

let mockPorts: PortEntry[] = [];

vi.mock("@/hooks/use-ports.js", () => ({
  portEntryKey: (entry: PortEntry) =>
    `${entry.profileId ?? "default"}:${entry.port}:${entry.sessionId ?? ""}:${entry.incarnation ?? 0}`,
  usePorts: () => ({
    ports: mockPorts,
    isLoading: false,
    isError: false,
    createTunnel: vi.fn(),
    stopTunnel: vi.fn(),
    endPortSession: vi.fn(),
    installCloudflared: vi.fn(),
    installState: { status: "idle", downloaded: 0, total: 0 },
  }),
}));

vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));

vi.mock("@/api/server-config.js", () => ({
  isLocalServer: () => true,
  subscribeToProfileChanges: () => () => {},
  getProfileChangeVersion: () => 0,
  getProfiles: () => [],
}));

describe("PortsPanel", () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderPanel = (ui: ReactElement) =>
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
    );

  beforeEach(() => {
    localStorage.clear();
    mockPorts = [
      {
        port: 3000,
        profileId: "default",
        project: "web",
        state: "listening",
        sessionId: "session-1",
        tunnel: {
          id: "tunnel-1",
          port: 3000,
          label: "web",
          driver: "cloudflared",
          status: "ready",
          url: "https://demo.trycloudflare.com",
          startedAt: 1,
          reminderDue: false,
        },
      },
    ];
  });

  it("renders a ready tunnel action for the embedded Browser without removing the external link", () => {
    const markup = renderPanel(
      <PortsPanel onOpenTunnelInBrowser={() => {}} />,
    );

    expect(markup).toContain(
      'aria-label="Open https://demo.trycloudflare.com in embedded Browser"',
    );
    expect(markup).toContain('href="https://demo.trycloudflare.com"');
    expect(markup).toContain('target="_blank"');
  });

  it("does not render an embedded Browser action without a callback", () => {
    const markup = renderPanel(<PortsPanel />);

    expect(markup).not.toContain("in embedded Browser");
    expect(markup).toContain('href="https://demo.trycloudflare.com"');
  });

  it("keeps URL and Stop available without inventing a terminal action for untracked origins", () => {
    mockPorts = [
      {
        port: 8080,
        profileId: "default",
        project: "api",
        state: "unknown",
        sessionId: null,
        tunnel: {
          id: "tunnel-untracked",
          port: 8080,
          label: "api",
          driver: "cloudflared",
          status: "ready",
          url: "https://api.trycloudflare.com",
          startedAt: 1,
          reminderDue: true,
        },
      },
    ];

    const markup = renderPanel(<PortsPanel />);
    expect(markup).toContain('href="https://api.trycloudflare.com"');
    expect(markup).toContain('aria-label="Stop tunnel"');
    expect(markup).not.toContain(
      'aria-label="End terminal session for :8080"',
    );
    expect(markup).not.toContain(
      'aria-label="Kill terminal session for :8080"',
    );
  });

  it("renders End terminal session action when port entry has valid terminationTarget and origin", () => {
    mockPorts = [
      {
        port: 3000,
        profileId: "default",
        project: "web",
        state: "listening",
        sessionId: "session-1",
        tunnel: null,
        terminationTarget: {
          profileId: "default",
          generation: 1,
          serverEpoch: "e7b0c36b-67df-4f0e-b7d5-866468453483",
          terminalId: "session-1",
          incarnation: "42",
        },
        origin: "live",
      },
    ];

    const markup = renderPanel(<PortsPanel />);
    expect(markup).toContain('aria-label="End terminal session for :3000"');
  });
});
