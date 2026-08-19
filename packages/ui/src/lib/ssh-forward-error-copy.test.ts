import { describe, expect, it } from "vitest";
import {
  SSH_FORWARD_REMEDIATION_COPY,
  getSshForwardErrorPresentation,
  normalizeSshForwardErrorCode,
} from "./ssh-forward-error-copy.js";

describe("ssh-forward-error-copy", () => {
  it("renders the fixed public message instead of native detail", () => {
    const presentation = getSshForwardErrorPresentation({
      code: "HOST_KEY_CHANGED",
      message: "secret endpoint and stack trace",
      retryable: true,
    });
    expect(presentation).toEqual({
      code: "HOST_KEY_CHANGED",
      message:
        "SSH host identity changed. Connection blocked before credentials are sent; use stopped-app trust repair.",
      retryable: false,
    });
    expect(presentation.message).not.toContain("secret");
  });

  it("normalizes compatibility-only codes to invalid argument", () => {
    expect(normalizeSshForwardErrorCode("INVALID_COUNTER")).toBe(
      "INVALID_ARGUMENT",
    );
    expect(normalizeSshForwardErrorCode("STORAGE_UNAVAILABLE")).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("keeps remediation copy exact and blocking", () => {
    expect(SSH_FORWARD_REMEDIATION_COPY).toContain("Do not approve it yet.");
    expect(SSH_FORWARD_REMEDIATION_COPY).toContain("then press Connect again.");
  });
});
