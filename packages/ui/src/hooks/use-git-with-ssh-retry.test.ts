import { describe, expect, it } from "vitest";
import type { GitOpResult } from "@/api/client.js";
import {
  getGitOperationStatus,
  getGitOperationFailureStatus,
  getGitOperationSuccessStatus,
  getRetryFailureStatus,
  getSshLoadKeyStatus,
  matchesSshAuthError,
  normalizeGitRetryResults,
  retryGitOperationAfterSshLoad,
  shouldPromptForSshPassphrase,
} from "./use-git-with-ssh-retry.js";

describe("useGitWithSshRetry helpers", () => {
  it("normalizes a single git result into an array", () => {
    const result: GitOpResult = {
      projectName: "demo",
      operation: "push",
      success: true,
      durationMs: 10,
    };

    expect(normalizeGitRetryResults(result)).toEqual([result]);
  });

  it("preserves array results unchanged", () => {
    const results: GitOpResult[] = [
      {
        projectName: "demo",
        operation: "push",
        success: false,
        durationMs: 10,
        error: "Permission denied (publickey).",
      },
    ];

    expect(normalizeGitRetryResults(results)).toEqual(results);
  });

  it("matches common SSH authentication failures", () => {
    expect(matchesSshAuthError("Permission denied (publickey).")).toBe(true);
    expect(matchesSshAuthError("no suitable credentials found")).toBe(true);
    expect(matchesSshAuthError("agent admitted failure to sign")).toBe(true);
    expect(matchesSshAuthError("sign_and_send_pubkey: signing failed")).toBe(
      true,
    );
  });

  it("does not match generic remote read failures", () => {
    expect(
      matchesSshAuthError("fatal: Could not read from remote repository."),
    ).toBe(false);
  });

  it("formats a saved-credential status message", () => {
    expect(
      getSshLoadKeyStatus({
        success: true,
        saved: true,
      }),
    ).toContain("Saved passphrase");
  });

  it("formats a session-only status message when save is unavailable", () => {
    expect(
      getSshLoadKeyStatus({
        success: true,
        saved: false,
        error:
          "Key loaded for this session only; save for later failed: no keyring",
      }),
    ).toContain("session only");
  });

  it("formats operation-specific retry failure status for SSH auth errors", () => {
    const results: GitOpResult[] = [
      {
        projectName: "demo",
        operation: "push",
        success: false,
        durationMs: 12,
        error: "Permission denied (publickey).",
      },
    ];

    expect(getRetryFailureStatus("push", results)).toContain(
      "Push still failed",
    );
    expect(getRetryFailureStatus("fetch", results)).toContain(
      "Fetch still failed",
    );
  });

  it("formats non-auth operation failures so the UI can surface them", () => {
    const results: GitOpResult[] = [
      {
        projectName: "demo",
        operation: "push",
        success: false,
        durationMs: 12,
        error: "non-fast-forward update rejected",
      },
    ];

    expect(getGitOperationFailureStatus("push", results)).toBe(
      "Push failed: non-fast-forward update rejected",
    );
  });

  it("formats a success status for a single push target", () => {
    const results: GitOpResult[] = [
      {
        projectName: "demo",
        operation: "push",
        success: true,
        durationMs: 12,
      },
    ];

    expect(getGitOperationSuccessStatus("push", results)).toBe(
      "Push succeeded.",
    );
    expect(getGitOperationStatus("push", results)).toBe("Push succeeded.");
  });

  it("formats a success status for multi-target operations", () => {
    const results: GitOpResult[] = [
      {
        projectName: "demo-a",
        operation: "fetch",
        success: true,
        durationMs: 12,
      },
      {
        projectName: "demo-b",
        operation: "fetch",
        success: true,
        durationMs: 10,
      },
    ];

    expect(getGitOperationSuccessStatus("fetch", results)).toBe(
      "Fetch succeeded for 2 targets.",
    );
  });

  it("prompts only when an auth error occurs before keys are loaded", () => {
    const authFailure: GitOpResult[] = [
      {
        projectName: "demo",
        operation: "push",
        success: false,
        durationMs: 10,
        error: "Permission denied (publickey).",
      },
    ];

    expect(shouldPromptForSshPassphrase(authFailure)).toBe(true);
  });

  it("retries exactly once after a successful key load", async () => {
    let calls = 0;
    const retry = await retryGitOperationAfterSshLoad("push", async () => {
      calls += 1;
      return {
        projectName: "demo",
        operation: "push",
        success: true,
        durationMs: 5,
      };
    });

    expect(calls).toBe(1);
    expect(retry).toEqual({
      results: [
        {
          projectName: "demo",
          operation: "push",
          success: true,
          durationMs: 5,
        },
      ],
      status: "Push succeeded.",
    });
  });

  it("returns retry failure status when the post-load retry still hits auth", async () => {
    const retry = await retryGitOperationAfterSshLoad("push", async () => ({
      projectName: "demo",
      operation: "push",
      success: false,
      durationMs: 5,
      error: "Permission denied (publickey).",
    }));

    expect(retry).toEqual({
      results: [
        {
          projectName: "demo",
          operation: "push",
          success: false,
          durationMs: 5,
          error: "Permission denied (publickey).",
        },
      ],
      status:
        "Push still failed after loading the selected SSH key. Verify the key, passphrase, and remote access.",
    });
  });
});
