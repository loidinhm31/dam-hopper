import { vi } from "vitest";
import {
  createApiClient,
  type CommitMessageResponse,
  type GitActionResult,
  type GitLogEntry,
  type PublishPreview,
  type PublishResult,
  type SquashCommitsInput,
} from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { __setConnectionSnapshotForTests } from "@/api/connections.js";

export interface SquashFixture {
  target: { profileId: string; project: string; worktreePath: string };
  branch: string;
  logs: GitLogEntry[];
  messages: Record<string, string>;
  requests: Array<{ url: URL; method: string; body?: Record<string, unknown> }>;
  messageResponse: (
    hash: string,
    branch?: string | null,
  ) => Promise<CommitMessageResponse>;
  squashResponse: (input: SquashCommitsInput) => Promise<GitActionResult>;
  prepareResponse: (branch?: string | null) => Promise<PublishPreview>;
  publishResponse: () => Promise<PublishResult>;
  bind: (generation?: number) => void;
  transport: WsTransport;
  destroy: () => void;
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
export const squashOids = {
  oldest: "a".repeat(40),
  newest: "b".repeat(40),
  descendant: "c".repeat(40),
  squash: "d".repeat(40),
  tip: "e".repeat(40),
};
export function squashEntry(
  hash: string,
  parents: string[],
  message = hash.slice(0, 7),
): GitLogEntry {
  return {
    hash,
    parents,
    message,
    authorName: "Đặng",
    authorEmail: "dev@example.invalid",
    timestamp: 1,
    refs: [],
    isPushed: true,
  };
}

/** Controlled HTTP responses exercise real client/REST/controller paths, not a Git server. */
export function installSquashFixture(): SquashFixture {
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  const requests: Array<{
    url: URL;
    method: string;
    body?: Record<string, unknown>;
  }> = [];
  const messages: Record<string, string> = {
    [squashOids.oldest]:
      "Cũ\n\nNội dung  \nSigned-off-by: Đặng <dev@example.invalid>\n",
    [squashOids.newest]: "Mới\n\nBody without final LF",
  };
  const fixture = {
    target: {
      profileId: "squash-profile",
      project: "demo/repo",
      worktreePath: "/tmp/work tree",
    },
    branch: "main",
    logs: [
      squashEntry(
        squashOids.descendant,
        [squashOids.newest],
        "Later descendant",
      ),
      squashEntry(squashOids.newest, [squashOids.oldest], "Mới"),
      squashEntry(squashOids.oldest, [], "Cũ"),
    ],
    messages,
    requests,
    messageResponse: (
      hash: string,
      branch?: string | null,
    ): Promise<CommitMessageResponse> =>
      Promise.resolve({
        message: messages[hash],
        branch: branch ?? `refs/heads/${fixture.branch}`,
        headOid: squashOids.descendant,
      }),
    squashResponse: (_input: SquashCommitsInput): Promise<GitActionResult> =>
      Promise.resolve({
        ok: true,
        oldTargetOid: squashOids.newest,
        newTargetOid: squashOids.squash,
        hash: squashOids.squash,
        oldHeadOid: squashOids.descendant,
        newHeadOid: squashOids.tip,
        rewrittenCount: 2,
        noOp: false,
      }),
    prepareResponse: (branch?: string | null): Promise<PublishPreview> => {
      const targetBranch = branch ?? `refs/heads/${fixture.branch}`;
      return Promise.resolve({
        status: "ready",
        alreadyCurrent: false,
        snapshot: {
          branch: targetBranch,
          sourceOid: squashOids.tip,
          remoteName: "origin",
          destinationRef: targetBranch,
          expectedRemoteOid: squashOids.descendant,
          remoteIdentity: "bare-fixture",
          repositoryIdentity: "fixture",
        },
      });
    },
    publishResponse: (): Promise<PublishResult> =>
      Promise.resolve({
        status: "published",
        branch: "refs/heads/main",
        remoteName: "origin",
        destinationRef: "refs/heads/main",
        sourceOid: squashOids.tip,
        expectedRemoteOid: squashOids.descendant,
        message: "Published with lease",
      }),
  };
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      requests.push({ url, method: init?.method ?? "GET", body });
      let data: unknown;
      if (url.pathname.endsWith("/roots"))
        data = [".", "nested/history", "bulk/root"].map((rootId) => ({
          rootId,
          path: rootId,
          absolutePath: `/tmp/${rootId}`,
          kind: rootId === "." ? "primary" : "nestedRepo",
          warnings: [],
        }));
      else if (url.pathname.endsWith("/branches"))
        data = [
          {
            name: fixture.branch,
            isCurrent: true,
            isRemote: false,
            lastCommit: squashOids.descendant,
          },
          {
            name: "other",
            isCurrent: false,
            isRemote: false,
            lastCommit: squashOids.oldest,
          },
          {
            name: "origin/remote",
            isCurrent: false,
            isRemote: true,
            lastCommit: squashOids.oldest,
          },
        ];
      else if (url.pathname.endsWith("/log")) data = fixture.logs;
      else if (url.pathname.endsWith("/message"))
        data = await fixture.messageResponse(
          url.pathname.split("/").at(-2)!,
          url.searchParams.get("branch"),
        );
      else if (url.pathname.endsWith("/squash"))
        data = await fixture.squashResponse(
          body as unknown as SquashCommitsInput,
        );
      else if (url.pathname.endsWith("/push/prepare"))
        data = await fixture.prepareResponse(
          (body?.branch as string | undefined) ?? null,
        );
      else if (url.pathname.endsWith("/push/publish"))
        data = await fixture.publishResponse();
      else if (url.pathname.endsWith("/status"))
        data = {
          branch: fixture.branch,
          isClean: true,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          untracked: [],
        };
      else if (
        url.pathname.endsWith("/files") ||
        url.pathname.endsWith("/keys") ||
        url.pathname.endsWith("/conflicts") ||
        url.pathname.endsWith("/projects")
      )
        data = [];
      else
        throw new Error(`Unconfigured fixture HTTP endpoint: ${url.pathname}`);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const boundProfileId = fixture.target.profileId;
  const transport = new WsTransport(
    "http://squash.invalid",
    fixture.target.profileId,
    null,
  );
  const bind = (generation = 1) => {
    const owner = { profileId: boundProfileId, generation };
    __setConnectionSnapshotForTests(owner.profileId, {
      owner,
      status: "connected",
      api: createApiClient(owner, transport),
      transport,
    });
  };
  bind();
  return Object.assign(fixture, {
    bind,
    transport,
    destroy: () => {
      transport.destroy();
      __setConnectionSnapshotForTests(boundProfileId, null);
    },
  });
}
