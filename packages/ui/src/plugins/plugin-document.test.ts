// @vitest-environment jsdom

import { createHash, webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildVerifiedPluginDocument,
  MAX_PLUGIN_UI_BYTES,
} from "./plugin-document.js";

const originalCrypto = globalThis.crypto;

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

afterAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
});

function fixture(body = '<div id="root"></div>') {
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    "<title>Advisor</title><style>body{margin:0}</style></head>" +
    `<body>${body}<script>window.parent.postMessage({type:"frame.ready"},"*")</script></body></html>`;
  const bytes = new TextEncoder().encode(html);
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

describe("buildVerifiedPluginDocument", () => {
  it("verifies digest and builds host-owned CSP before plugin code", async () => {
    const input = fixture();
    const result = await buildVerifiedPluginDocument({
      bytes: input.bytes,
      expectedDigest: input.digest,
      frameSession: "session-1",
      activationGeneration: 4,
    });
    expect(result.digest).toBe(input.digest);
    expect(result.srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(result.srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(
      result.srcdoc.indexOf("window.parent.postMessage"),
    );
    expect(result.srcdoc).toContain("default-src 'none'");
    expect(result.srcdoc).toContain("connect-src 'none'");
    expect(result.srcdoc).toContain("__FRAME_SESSION__");
  });

  it("rejects external resource elements even when bytes match", async () => {
    const input = fixture(
      '<link rel="stylesheet" href="https://example.invalid/a.css"><div></div>',
    );
    await expect(
      buildVerifiedPluginDocument({
        bytes: input.bytes,
        expectedDigest: input.digest,
        frameSession: "session-1",
        activationGeneration: 4,
      }),
    ).rejects.toThrow(/unsupported element|Forbidden/);
  });

  it("rejects digest mismatch, invalid UTF-8, and oversized documents", async () => {
    const input = fixture();
    await expect(
      buildVerifiedPluginDocument({
        bytes: input.bytes,
        expectedDigest: "0".repeat(64),
        frameSession: "session-1",
        activationGeneration: 4,
      }),
    ).rejects.toThrow(/digest/);
    await expect(
      buildVerifiedPluginDocument({
        bytes: new Uint8Array([0xc3, 0x28]),
        expectedDigest: createHash("sha256")
          .update(new Uint8Array([0xc3, 0x28]))
          .digest("hex"),
        frameSession: "session-1",
        activationGeneration: 4,
      }),
    ).rejects.toThrow(/UTF-8/);
    await expect(
      buildVerifiedPluginDocument({
        bytes: new Uint8Array(MAX_PLUGIN_UI_BYTES + 1),
        expectedDigest: "0".repeat(64),
        frameSession: "session-1",
        activationGeneration: 4,
      }),
    ).rejects.toThrow(/5 MiB/);
  });
});
