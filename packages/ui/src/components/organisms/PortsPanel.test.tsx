// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    killPortSession: vi.fn(),
    installCloudflared: vi.fn(),
    installState: { status: "idle", downloaded: 0, total: 0 },
  }),
}));

vi.mock("@/hooks/use-clipboard.js", () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}));

vi.mock("@/api/server-config.js", () => ({
  isLocalServer: () => true,
}));

describe("PortsPanel", () => {
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
    const markup = renderToStaticMarkup(
      <PortsPanel onOpenTunnelInBrowser={() => {}} />,
    );

    expect(markup).toContain(
      'aria-label="Open https://demo.trycloudflare.com in embedded Browser"',
    );
    expect(markup).toContain('href="https://demo.trycloudflare.com"');
    expect(markup).toContain('target="_blank"');
  });

  it("does not render an embedded Browser action without a callback", () => {
    const markup = renderToStaticMarkup(<PortsPanel />);

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

    const markup = renderToStaticMarkup(<PortsPanel />);
    expect(markup).toContain('href="https://api.trycloudflare.com"');
    expect(markup).toContain('aria-label="Stop tunnel"');
    expect(markup).not.toContain(
      'aria-label="Kill terminal session for :8080"',
    );
  });
});
