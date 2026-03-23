import pLimit from "p-limit";
import type { ProjectConfig } from "../config/schema.js";
import type {
  GitOperationResult,
  GitStatus,
  BranchUpdateResult,
} from "./types.js";
import {
  GitProgressEmitter,
  createProgressEmitter,
  emitProgress,
} from "./progress.js";
import { getStatus } from "./status.js";
import { gitFetch, gitPull } from "./operations.js";
import { updateAllBranches } from "./branch.js";

export class BulkGitService {
  readonly concurrency: number;
  readonly emitter: GitProgressEmitter;

  constructor(options?: { concurrency?: number }) {
    this.concurrency = options?.concurrency ?? 4;
    this.emitter = createProgressEmitter();
  }

  async fetchAll(projects: ProjectConfig[]): Promise<GitOperationResult[]> {
    const limit = pLimit(this.concurrency);
    let completed = 0;
    const results = await Promise.all(
      projects.map((p) =>
        limit(async () => {
          const result = await gitFetch(p.path, p.name, this.emitter);
          completed++;
          // "progress" phase: individual project done, bulk not yet complete
          emitProgress(
            this.emitter,
            p.name,
            "bulk-fetch",
            "progress",
            `${completed}/${projects.length} projects fetched`,
            Math.round((completed / projects.length) * 100),
          );
          return result;
        }),
      ),
    );
    emitProgress(
      this.emitter,
      "",
      "bulk-fetch",
      "completed",
      `All ${projects.length} projects fetched`,
    );
    return results;
  }

  async pullAll(projects: ProjectConfig[]): Promise<GitOperationResult[]> {
    const limit = pLimit(this.concurrency);
    let completed = 0;
    const results = await Promise.all(
      projects.map((p) =>
        limit(async () => {
          const result = await gitPull(p.path, p.name, this.emitter);
          completed++;
          emitProgress(
            this.emitter,
            p.name,
            "bulk-pull",
            "progress",
            `${completed}/${projects.length} projects pulled`,
            Math.round((completed / projects.length) * 100),
          );
          return result;
        }),
      ),
    );
    emitProgress(
      this.emitter,
      "",
      "bulk-pull",
      "completed",
      `All ${projects.length} projects pulled`,
    );
    return results;
  }

  async statusAll(projects: ProjectConfig[]): Promise<GitStatus[]> {
    const limit = pLimit(this.concurrency);
    const results = await Promise.all(
      projects.map((p) =>
        limit(async () => {
          try {
            return await getStatus(p.path, p.name);
          } catch (err) {
            return {
              projectName: p.name,
              branch: "",
              isClean: true,
              ahead: 0,
              behind: 0,
              staged: 0,
              modified: 0,
              untracked: 0,
              hasStash: false,
              lastCommit: { hash: "", message: "", date: "" },
              pathExists: true,
              statusError: err instanceof Error ? err.message : String(err),
            } satisfies GitStatus;
          }
        }),
      ),
    );
    return results;
  }

  async updateAllBranches(
    projects: ProjectConfig[],
  ): Promise<Map<string, BranchUpdateResult[]>> {
    const limit = pLimit(this.concurrency);
    const entries = await Promise.all(
      projects.map((p) =>
        limit(async () => {
          const results = await updateAllBranches(p.path, this.emitter);
          return [p.name, results] as [string, BranchUpdateResult[]];
        }),
      ),
    );
    return new Map(entries);
  }
}
