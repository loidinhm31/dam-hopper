import { describe, it, expect } from "vitest";
import {
  buildSessionChangesModelUri,
  parseSessionChangesModelUri,
  type SessionChangesModelUriParams,
} from "./session-changes-model-uri";

describe("session-changes-model-uri", () => {
  it("builds and parses distinct model URIs", () => {
    const params: SessionChangesModelUriParams = {
      profileId: "profile-1",
      generation: 42,
      terminalId: "term/special@id",
      terminalIncarnation: "1",
      ompSessionId: "omp:session:99",
      rootId: "packages/ui",
      serverEpoch: "epoch-123",
      baselineId: "base-456",
      comparisonRevision: "5",
      path: "src/components/MyComponent.tsx",
      side: "current",
    };

    const uri = buildSessionChangesModelUri(params);
    expect(uri.startsWith("sessionchanges://")).toBe(true);

    const parsed = parseSessionChangesModelUri(uri);
    expect(parsed).toEqual(params);
  });

  it("produces collision-free URIs across sides, profiles, and revisions", () => {
    const base: SessionChangesModelUriParams = {
      profileId: "p1",
      generation: 1,
      terminalId: "t1",
      terminalIncarnation: "1",
      ompSessionId: "s1",
      rootId: ".",
      serverEpoch: "e1",
      baselineId: "b1",
      comparisonRevision: "1",
      path: "main.rs",
      side: "original",
    };

    const uriOriginal = buildSessionChangesModelUri(base);
    const uriCurrent = buildSessionChangesModelUri({ ...base, side: "current" });
    const uriGen2 = buildSessionChangesModelUri({ ...base, generation: 2 });
    const uriRev2 = buildSessionChangesModelUri({ ...base, comparisonRevision: "2" });
    const uriOtherProf = buildSessionChangesModelUri({ ...base, profileId: "p2" });

    const set = new Set([uriOriginal, uriCurrent, uriGen2, uriRev2, uriOtherProf]);
    expect(set.size).toBe(5);
  });

  it("returns null for malformed URIs", () => {
    expect(parseSessionChangesModelUri("file:///tmp/main.rs")).toBeNull();
    expect(parseSessionChangesModelUri("sessionchanges://too/few/parts")).toBeNull();
    expect(
      parseSessionChangesModelUri(
        "sessionchanges://p1_1/t1_1/s1/./e1_b1_1/invalid_side/path",
      ),
    ).toBeNull();
  });
});
