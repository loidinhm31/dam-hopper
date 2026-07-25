import { describe, expect, it } from "vitest";
import { resolveBrowserDebugTarget } from "./browser-debug-origin.js";
import type { TunnelInfo } from "@/api/client.js";

const readyTunnel: TunnelInfo = {
  id: "tunnel-1",
  port: 3000,
  label: "web",
  driver: "cloudflared",
  status: "ready",
  url: "https://example.trycloudflare.com",
  startedAt: 0,
};

describe("resolveBrowserDebugTarget", () => {
  it.each([
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://[::1]:8080",
  ])("allows a loopback URL %s", (value) => {
    expect(resolveBrowserDebugTarget(value, [])).toMatchObject({
      origin: new URL(value).origin,
      source: "loopback",
    });
  });

  it("allows paths on a ready tunnel origin", () => {
    expect(
      resolveBrowserDebugTarget("https://example.trycloudflare.com", [readyTunnel]),
    ).toMatchObject({ source: "tunnel", origin: readyTunnel.url });
    expect(
      resolveBrowserDebugTarget("https://example.trycloudflare.com/settings?tab=logs", [readyTunnel]),
    ).toMatchObject({
      source: "tunnel",
      url: "https://example.trycloudflare.com/settings?tab=logs",
    });
    expect(
      resolveBrowserDebugTarget("https://other.trycloudflare.com", [readyTunnel]),
    ).toBeNull();
  });

  it.each([
    "https://localhost:3000",
    "http://user@localhost:3000",
    "http://127.0.0.2:3000",
  ])("rejects a non-exact or unapproved URL %s", (value) => {
    expect(resolveBrowserDebugTarget(value, [readyTunnel])).toBeNull();
  });

  it("rejects a stopped tunnel", () => {
    expect(
      resolveBrowserDebugTarget("https://example.trycloudflare.com", [
        { ...readyTunnel, status: "stopped" },
      ]),
    ).toBeNull();
  });

  it("rejects a target with the parent application origin", () => {
    expect(
      resolveBrowserDebugTarget("http://localhost:3000", [], "http://localhost:3000"),
    ).toBeNull();
  });
});
