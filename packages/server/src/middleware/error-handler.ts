import type { ErrorHandler } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import type { GitError } from "@dev-hub/core";

const GIT_ERROR_STATUS: Record<string, number> = {
  network: 502,
  auth: 401,
  conflict: 409,
  lock: 423,
  not_repo: 404,
  unknown: 500,
};

function isGitError(err: unknown): err is GitError {
  return (
    err instanceof Error &&
    err.name === "GitError" &&
    "category" in err &&
    "projectName" in err
  );
}

export const onError: ErrorHandler = (err, c) => {
  if (isGitError(err)) {
    const status = GIT_ERROR_STATUS[err.category] ?? 500;
    return c.json(
      { error: err.message, code: err.category.toUpperCase(), details: { projectName: err.projectName } },
      status as StatusCode,
    );
  }
  return c.json({ error: err.message, code: "INTERNAL_ERROR", details: {} }, 500);
};
