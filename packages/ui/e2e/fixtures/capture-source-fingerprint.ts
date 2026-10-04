import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Computes deterministic SHA-256 source fingerprint based on git HEAD and
 * relevant tracked/untracked working-tree files, explicitly excluding evidence,
 * plans, logs, staging directories, and documentation to prevent self-invalidation.
 */
export function computeSourceFingerprint(repoRoot: string = REPO_ROOT): {
  gitHead: string;
  sourceFingerprint: string;
} {
  let gitHead = "unknown-head";
  try {
    gitHead = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // fallback if git not available
  }

  let statusOutput = "";
  try {
    statusOutput = execSync("git status --porcelain=v1", {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // fallback if status fails
  }

  const relevantLines = statusOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      let filePath = line.slice(3).trim();
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1);
      }
      if (
        filePath.startsWith("plans/") ||
        filePath.startsWith("docs/") ||
        filePath.includes(".e2e-staging") ||
        filePath.includes("test-results") ||
        filePath.includes("playwright-report") ||
        filePath.includes(".vitest-attachments") ||
        filePath.endsWith(".log") ||
        filePath.endsWith(".png") ||
        filePath.endsWith("evidence.json") ||
        filePath.endsWith("review.md") ||
        filePath.startsWith("apps/web/public/browser-debug-extension/")
      ) {
        return false;
      }
      return true;
    })
    .sort();

  const hasher = createHash("sha256").update(gitHead);
  if (relevantLines.length === 0) {
    hasher.update(":clean");
  } else {
    hasher.update(":dirty:").update(relevantLines.join("\n"));
  }

  return {
    gitHead,
    sourceFingerprint: hasher.digest("hex"),
  };
}
