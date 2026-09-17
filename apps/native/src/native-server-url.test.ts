// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isProfileSupportedOnNative } from "./native-server-url.js";
import type { ServerProfile } from "@dam-hopper/ui/api/server-config";

describe("isProfileSupportedOnNative", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.appHost;
    delete document.documentElement.dataset.appPlatform;
    vi.stubGlobal("location", {
      origin: "http://localhost:4800",
      protocol: "http:",
      host: "localhost:4800",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports any valid HTTP(S) profile on Windows native desktop", () => {
    document.documentElement.dataset.appHost = "native";
    document.documentElement.dataset.appPlatform = "windows";

    const remoteProfile: ServerProfile = {
      id: "p-remote",
      name: "Remote Server",
      url: "https://remote.dam-hopper.dev:8443",
      authType: "basic",
      createdAt: 1,
      autoConnect: true,
    };

    expect(isProfileSupportedOnNative(remoteProfile)).toBe(true);
  });

  it("restricts non-Windows native desktop to exact same-origin profiles", () => {
    document.documentElement.dataset.appHost = "native";
    document.documentElement.dataset.appPlatform = "linux";

    const sameOriginProfile: ServerProfile = {
      id: "p-local",
      name: "Same Origin Server",
      url: "http://localhost:4800",
      authType: "none",
      createdAt: 1,
      autoConnect: true,
    };

    const crossOriginProfile: ServerProfile = {
      id: "p-remote",
      name: "Cross Origin Server",
      url: "https://remote.dev:4800",
      authType: "basic",
      createdAt: 1,
      autoConnect: true,
    };

    expect(isProfileSupportedOnNative(sameOriginProfile)).toBe(true);
    expect(isProfileSupportedOnNative(crossOriginProfile)).toBe(false);
  });
});
