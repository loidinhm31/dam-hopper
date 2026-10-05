import { describe, expect, it, vi } from "vitest";
import {
  type ConnectionRef,
  createApiClient,
  type GitBlameInput,
  type GitBlameResponse,
  type GitCommitDetails,
} from "./client.js";
import { WsTransport } from "./ws-transport.js";
import {
  __setConnectionSnapshotForTests,
  getApi,
  getTransport,
  isCurrentConnection,
  resetConnections,
} from "./connections.js";

describe("Phase 03 bound client smoke verification", () => {
  it("exercises blame and commitDetails across two loopback profiles and enforces generation fencing", async () => {
    resetConnections();

    // 1. Set up two distinct loopback profiles
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const parsedUrl = new URL(url);

      if (parsedUrl.pathname.includes("/blame")) {
        const body = JSON.parse(init?.body as string) as GitBlameInput;
        const resp: GitBlameResponse = {
          snapshotId: body.snapshotId,
          modelVersion: body.modelVersion,
          rootId: ".",
          rootRelativePath: body.path,
          baseCommitOid: "1111222233334444555566667777888899990000",
          bufferLineCount: 3,
          status: "ready",
          commits: [
            {
              hash: "1111222233334444555566667777888899990000",
              authorName: "Smoke Author",
              authorTimestamp: 1760000000,
              authorTimezoneOffsetMinutes: 0,
              subject: "smoke test commit",
            },
          ],
          ranges: [{ startLine: 1, lineCount: 3, commitIndex: 0 }],
        };
        return Promise.resolve(
          new Response(JSON.stringify(resp), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      if (parsedUrl.pathname.includes("/commit/") && parsedUrl.pathname.endsWith("/details")) {
        const hash = parsedUrl.pathname.split("/")[4];
        const details: GitCommitDetails = {
          hash: hash ?? "unknown",
          authorName: "Smoke Author",
          authorTimestamp: 1760000000,
          authorTimezoneOffsetMinutes: 0,
          subject: "smoke test commit",
          fullMessage: "smoke test commit\n\nVerified body content",
        };
        return Promise.resolve(
          new Response(JSON.stringify(details), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });

    vi.stubGlobal("fetch", fetchMock);

    const transport1 = new WsTransport("http://127.0.0.1:4801");
    const transport2 = new WsTransport("http://127.0.0.1:4802");

    const owner1Gen1: ConnectionRef = { profileId: "profile-1", generation: 1 };
    const owner2Gen1: ConnectionRef = { profileId: "profile-2", generation: 1 };

    const client1Gen1 = createApiClient(owner1Gen1, transport1);
    const client2Gen1 = createApiClient(owner2Gen1, transport2);

    __setConnectionSnapshotForTests(
      "profile-1",
      {
        owner: owner1Gen1,
        status: "connected",
        serverUrl: "http://127.0.0.1:4801",
        api: client1Gen1,
      },
      transport1,
    );

    __setConnectionSnapshotForTests(
      "profile-2",
      {
        owner: owner2Gen1,
        status: "connected",
        serverUrl: "http://127.0.0.1:4802",
        api: client2Gen1,
      },
      transport2,
    );

    // Verify both connections are active and current
    expect(isCurrentConnection(owner1Gen1)).toBe(true);
    expect(isCurrentConnection(owner2Gen1)).toBe(true);

    // 2. Execute git.blame on profile-1
    const blame1 = await client1Gen1.git.blame(
      { project: "proj-1" },
      {
        path: "src/main.rs",
        content: "fn main() {}\n",
        snapshotId: "smoke-snap-1",
        modelVersion: 1,
      },
    );
    expect(blame1.status).toBe("ready");
    expect(blame1.snapshotId).toBe("smoke-snap-1");
    expect(blame1.commits[0]?.authorName).toBe("Smoke Author");

    // 3. Execute git.commitDetails on profile-2
    const details2 = await client2Gen1.git.commitDetails(
      { project: "proj-2", worktreePath: "/tmp/wt2" },
      "1111222233334444555566667777888899990000",
      ".",
    );
    expect(details2.authorName).toBe("Smoke Author");
    expect(details2.fullMessage).toContain("Verified body content");

    // 4. Simulate a reconnect on profile-1: generation advances from 1 to 2
    const owner1Gen2: ConnectionRef = { profileId: "profile-1", generation: 2 };
    const transport1Gen2 = new WsTransport("http://127.0.0.1:4801");
    const client1Gen2 = createApiClient(owner1Gen2, transport1Gen2);

    __setConnectionSnapshotForTests(
      "profile-1",
      {
        owner: owner1Gen2,
        status: "connected",
        serverUrl: "http://127.0.0.1:4801",
        api: client1Gen2,
      },
      transport1Gen2,
    );

    // Old generation 1 is now stale!
    expect(isCurrentConnection(owner1Gen1)).toBe(false);
    expect(isCurrentConnection(owner1Gen2)).toBe(true);

    // Attempting to resolve transport or api with stale owner1Gen1 throws ConnectionOwnerError
    expect(() => getTransport(owner1Gen1)).toThrow("Connection is stale or not connected");
    expect(() => getApi(owner1Gen1)).toThrow("Connection is stale or not connected");

    // Profile-2 generation 1 remains unaffected and current
    expect(isCurrentConnection(owner2Gen1)).toBe(true);
    expect(() => getApi(owner2Gen1)).not.toThrow();

    // Clean up
    transport1.destroy();
    transport2.destroy();
    transport1Gen2.destroy();
    resetConnections();
    vi.unstubAllGlobals();
  });
});
