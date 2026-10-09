import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import {
  applyAgentStatusChanged,
  beginAgentStatusConnection,
  installAgentStatusSnapshot,
  useAgentStatusStore,
} from "@/stores/agent-status.js";
import {
  buildTraditionalTerminalAgentRows,
  type AgentStatusProfilesView,
  type BuildTraditionalTerminalAgentsInput,
} from "./traditional-terminal-agents.js";

const deliver = vi.hoisted(() => vi.fn());
vi.mock("@/lib/terminal-agent-notification-integration.js", () => ({
  deliverSemanticAgentAttention: deliver,
}));

type ProfileView = AgentStatusProfilesView extends ReadonlyMap<string, infer Profile>
  ? Profile : never;
type Group = TraditionalTerminalProjectGroup<DisplayTabEntry>;
interface Fixture {
  input: BuildTraditionalTerminalAgentsInput;
  group: Group;
  tab: DisplayTabEntry;
  mounted: MountedSession;
  status: TerminalAgentStatusRow;
  profile: ProfileView;
  profiles: Map<string, ProfileView>;
  connections: Map<string, ConnectionSnapshot>;
  profileLabels: Map<string, string>;
}

function observed(patch: Partial<TerminalAgentStatusRow> = {}): TerminalAgentStatusRow {
  return {
    id: "shared-terminal", incarnation: 1, agentKind: "omp",
    agentSessionId: "private-agent-session", reporterEpoch: 1,
    state: "idle", source: "lifecycle", attentionRevision: 0,
    ...patch,
  };
}

function fixture(
  patch: Partial<TerminalAgentStatusRow> = {},
  profileId = "alpha",
): Fixture {
  const status = observed(patch);
  const terminalRef = { profileId, id: status.id };
  const tab: DisplayTabEntry = {
    sessionId: terminalKey(terminalRef), terminalRef, profileId,
    label: "friendly terminal",
    title: { baseLabel: "friendly terminal", ordinal: 1, fullText: "friendly terminal #1" },
    session: {
      id: status.id, incarnation: status.incarnation, alive: true,
      command: "private command", cwd: "/private/path", type: "shell", startedAt: 1,
    },
  };
  const mounted: MountedSession = {
    sessionId: tab.sessionId, terminalRef, profileId, project: "project-a",
    command: "private mounted command", cwd: "/private/mounted/path",
  };
  const group: Group = {
    id: `project-${profileId}`, label: "Project A", projectName: "project-a",
    profileId, projectRef: { profileId, project: "project-a" },
    terminalTabs: [tab], mountedSessions: [mounted],
  };
  const owner = { profileId, generation: 1 };
  const profile: ProfileView = {
    owner, epoch: 7, revision: 1, availability: "ready",
    rows: new Map([[status.id, status]]), cursors: new Map(),
  };
  const profiles = new Map([[profileId, profile]]);
  const connections = new Map<string, ConnectionSnapshot>([[profileId, {
    owner, status: "connected", intent: true, serverUrl: "https://private.invalid", error: null,
  }]]);
  const profileLabels = new Map([[profileId, `Server ${profileId}`]]);
  return {
    input: { groups: [group], profiles, connections, profileLabels },
    group, tab, mounted, status, profile, profiles, connections, profileLabels,
  };
}

let savedProfiles: AgentStatusProfilesView;
beforeEach(() => {
  savedProfiles = useAgentStatusStore.getState().profiles;
  useAgentStatusStore.setState({ profiles: new Map() });
  deliver.mockClear();
});
afterEach(() => {
  useAgentStatusStore.setState({ profiles: savedProfiles });
});

describe("traditional agent identity and membership", () => {
  it("keeps equal remote IDs separate by registered owner, in group/tab order", () => {
    const a = fixture({ agentKind: "claude", source: "hook", observedAtMs: 900, expiresAtMs: 2_000 });
    const b = fixture({ agentKind: "codex", source: "hook", observedAtMs: 900, expiresAtMs: 2_000 }, "beta");
    const other = fixture({ id: "another-terminal", agentKind: "omp" });
    a.group.terminalTabs.push(other.tab);
    a.group.mountedSessions.push(other.mounted);
    a.profile.rows = new Map([...a.profile.rows, [other.status.id, other.status]]);
    const rows = buildTraditionalTerminalAgentRows({
      ...a.input, groups: [b.group, a.group],
      profiles: new Map([...a.profiles, ...b.profiles]),
      connections: new Map([...a.connections, ...b.connections]),
      profileLabels: new Map([...a.profileLabels, ...b.profileLabels]),
    });
    expect(rows.map((row) => [row.terminalRef.profileId, row.harnessLabel])).toEqual([
      ["beta", "Codex"], ["alpha", "Claude"], ["alpha", "OMP"],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(rows[1].status).toBe(a.status);
    expect(rows[0].status).toBe(b.status);
  });

  const exclusions: Array<[string, (f: Fixture) => void]> = [
    ["bare tab ID even with concrete owner", (f) => { f.tab.sessionId = f.status.id; }],
    ["bare tab ID without owner metadata", (f) => {
      f.tab.sessionId = f.status.id; delete f.tab.terminalRef; delete f.tab.profileId;
    }],
    ["noncanonical qualified tuple", (f) => { f.tab.sessionId = '["alpha","shared-terminal",1]'; }],
    ["conflicting concrete tab profile", (f) => { f.tab.terminalRef = { profileId: "beta", id: f.status.id }; }],
    ["conflicting concrete tab terminal", (f) => { f.tab.terminalRef = { profileId: "alpha", id: "other" }; }],
    ["conflicting optional tab profile", (f) => { f.tab.profileId = "beta"; }],
    ["missing exact mounted membership", (f) => { f.group.mountedSessions = []; }],
    ["bare mounted fallback", (f) => { f.mounted.sessionId = f.status.id; }],
    ["mounted under another qualified owner", (f) => { f.mounted.sessionId = terminalKey({ profileId: "beta", id: f.status.id }); }],
    ["conflicting mounted terminal ref", (f) => { f.mounted.terminalRef = { profileId: "beta", id: f.status.id }; }],
    ["conflicting mounted remote ID", (f) => { f.mounted.terminalRef = { profileId: "alpha", id: "other" }; }],
    ["conflicting optional mounted profile", (f) => { f.mounted.profileId = "beta"; }],
    ["conflicting group profile", (f) => { f.group.profileId = "beta"; }],
    ["conflicting project ref profile", (f) => { f.group.projectRef = { profileId: "beta", project: "project-a" }; }],
    ["removed registered profile", (f) => { f.profileLabels.delete("alpha"); }],
    ["missing live metadata", (f) => { delete f.tab.session; }],
    ["wrong live remote ID", (f) => { f.tab.session!.id = "other"; }],
    ["nonlive terminal", (f) => { f.tab.session!.alive = false; }],
    ["missing metadata incarnation", (f) => { delete f.tab.session!.incarnation; }],
    ["restart with prior status incarnation", (f) => { f.tab.session!.incarnation = 2; }],
    ["status replacement ahead of metadata", (f) => {
      f.profile.rows = new Map([[f.status.id, observed({ incarnation: 2 })]]);
    }],
    ["plain shell without observation", (f) => { f.profile.rows = new Map(); }],
    ["missing profile status", (f) => { f.profiles.clear(); }],
    ["mismatched profile view owner", (f) => { f.profile.owner = { profileId: "beta", generation: 1 }; }],
    ["mismatched row ID under index key", (f) => {
      f.profile.rows = new Map([[f.status.id, observed({ id: "other" })]]);
    }],
    ["closed tab with retained mounted/status rows", (f) => { f.group.terminalTabs = []; }],
  ];
  it.each(exclusions)("excludes %s", (_name, change) => {
    const f = fixture();
    change(f);
    expect(buildTraditionalTerminalAgentRows(f.input)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed concrete incarnation %s even if status matches", (incarnation) => {
      const f = fixture({ incarnation });
      expect(buildTraditionalTerminalAgentRows(f.input)).toEqual([]);
    },
  );

  it.each([0, Number.MAX_SAFE_INTEGER])("accepts valid concrete incarnation %s", (incarnation) => {
    const f = fixture({ incarnation });
    expect(buildTraditionalTerminalAgentRows(f.input)[0]).toMatchObject({
      incarnation, key: terminalInstanceKey({ ...f.tab.terminalRef!, incarnation }),
    });
  });

  it("uses canonical keys when optional refs are absent and keeps projectless context", () => {
    const f = fixture();
    delete f.tab.terminalRef; delete f.tab.profileId;
    delete f.mounted.terminalRef; delete f.mounted.profileId;
    delete f.group.profileId; delete f.group.projectRef;
    f.group.label = "Free terminals";
    f.group.profileName = "untrusted grouping label";
    f.profileLabels.set("alpha", "");
    expect(buildTraditionalTerminalAgentRows(f.input)[0]).toMatchObject({
      terminalRef: { profileId: "alpha", id: f.status.id },
      profileLabel: "alpha", projectLabel: "Free terminals", terminalTitle: f.tab.title.fullText,
    });
  });

  it("deduplicates an instance without sorting or replacing its first offered context", () => {
    const f = fixture();
    f.group.terminalTabs.push({ ...f.tab, title: { ...f.tab.title, fullText: "duplicate" } });
    f.group.mountedSessions.push(f.mounted);
    const rows = buildTraditionalTerminalAgentRows({
      ...f.input, groups: [f.group, { ...f.group, id: "duplicate-group", label: "duplicate" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ groupId: f.group.id, terminalTitle: f.tab.title.fullText });
  });

  it("preserves readonly original status/provenance and every captured input", () => {
    const f = fixture({ state: "blocked", reason: "question", turnId: "private-turn", lastOutcome: "error" });
    const before = structuredClone(f.input);
    for (const value of [f.status, f.profile.owner, f.profile, f.tab.session!, f.tab.title,
      f.tab, f.mounted, f.group.terminalTabs, f.group.mountedSessions, f.group, f.input]) {
      Object.freeze(value);
    }
    const rows = buildTraditionalTerminalAgentRows(f.input);
    expect(rows[0].status).toBe(f.status);
    expect(rows[0].statusOwner).toBe(f.profile.owner);
    expect(f.input).toEqual(before);
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("current connection baseline precedence", () => {
  it("immediately fences ready semantics on generation-only connection change", () => {
    const f = fixture({ lastOutcome: "ended" });
    expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation.outcomeHint).not.toBeNull();
    f.connections.set("alpha", { ...f.connections.get("alpha")!, owner: { profileId: "alpha", generation: 2 } });
    const row = buildTraditionalTerminalAgentRows(f.input)[0];
    expect(row.status).toBe(f.status);
    expect(row).toMatchObject({
      availability: "unavailable", statusOwner: { profileId: "alpha", generation: 1 },
      presentation: { label: "Unavailable", reasonLabel: null, outcomeHint: null },
    });
  });

  it.each(["disconnected", "connecting", "login-required", "mfa-required", "offline", "unsupported"] as const)(
    "retains only unavailable semantics when connection is %s", (status) => {
      const f = fixture({ state: "blocked", reason: "approval", lastOutcome: "ended" });
      f.profile.availability = "platform-unqualified";
      f.connections.set("alpha", { ...f.connections.get("alpha")!, status });
      expect(buildTraditionalTerminalAgentRows(f.input)[0]).toMatchObject({
        availability: "unavailable", presentation: { label: "Unavailable", reasonLabel: null, outcomeHint: null },
      });
    },
  );

  it.each(["missing connection", "wrong connection profile", "ready without epoch", "begin retained unavailable", "null availability"])(
    "cannot certify readiness with %s", (condition) => {
      const f = fixture({ lastOutcome: "ended" });
      if (condition === "missing connection") f.connections.clear();
      if (condition === "wrong connection profile") {
        f.connections.set("alpha", { ...f.connections.get("alpha")!, owner: { profileId: "beta", generation: 1 } });
      }
      if (condition === "ready without epoch") f.profile.epoch = null;
      if (condition === "begin retained unavailable") f.profile.availability = "unavailable";
      if (condition === "null availability") f.profile.availability = null;
      expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation).toMatchObject({
        label: "Unavailable", reasonLabel: null, outcomeHint: null,
      });
    },
  );

  it.each([
    ["platform-unqualified", "Platform unqualified"], ["unsupported", "Unsupported"],
  ] as const)("presents current %s explicitly without semantic hints", (availability, label) => {
    const f = fixture({ state: "blocked", reason: "error", lastOutcome: "ended" });
    f.profile.availability = availability;
    f.profile.epoch = null;
    expect(buildTraditionalTerminalAgentRows(f.input)[0]).toMatchObject({
      availability, presentation: { label, reasonLabel: null, outcomeHint: null },
    });
  });
});

describe("observed semantics and strict last-turn fact", () => {
  it.each([
    ["working", "Working"], ["idle", "Idle"], ["unknown", "Unknown"], ["blocked", "Needs attention"],
  ] as const)("presents observed %s, never process/command heuristics", (state, label) => {
    const f = fixture({ state });
    expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation).toMatchObject({
      label, reasonLabel: null, outcomeHint: null,
    });
  });

  it.each([["approval", "Approval"], ["question", "Question"], ["error", "Error"]] as const)(
    "explains blocked %s but ignores stale blocker on Idle", (reason, reasonLabel) => {
      const blocked = fixture({ state: "blocked", reason, lastOutcome: "ended" });
      expect(buildTraditionalTerminalAgentRows(blocked.input)[0].presentation).toMatchObject({
        label: "Needs attention", reasonLabel, outcomeHint: null,
      });
      const idle = fixture({ state: "idle", reason });
      expect(buildTraditionalTerminalAgentRows(idle.input)[0].presentation.reasonLabel).toBeNull();
    },
  );

  it.each(["working", "blocked", "unknown"] as const)(
    "cannot show ended hint on %s with stale outcome", (state) => {
      const f = fixture({ state, lastOutcome: "ended" });
      expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation.outcomeHint).toBeNull();
    },
  );

  it.each(["interrupted", "error", "unknown", undefined] as const)(
    "cannot treat Idle outcome %s as an ended turn", (lastOutcome) => {
      const f = fixture({ lastOutcome });
      expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation.outcomeHint).toBeNull();
    },
  );

  it.each(["active-turn", ""])("suppresses ended hint with defined turn ID %j", (turnId) => {
    const f = fixture({ lastOutcome: "ended", turnId });
    expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation.outcomeHint).toBeNull();
  });

  it.each(["codex", "claude"] as const)("preserves server-authoritative %s hook state without client clock skew", (agentKind) => {
    const f = fixture({ agentKind, source: "hook", observedAtMs: 900, expiresAtMs: 1_000, lastOutcome: "ended" });
    expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation).toMatchObject({
      label: "Idle", outcomeHint: "Done (turn ended)",
    });
  });

  it("preserves authoritative blocked reason without client clock comparison", () => {
    const f = fixture({ agentKind: "claude", source: "hook", state: "blocked", reason: "question", observedAtMs: 900, expiresAtMs: 1_000 });
    expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation).toMatchObject({
      label: "Needs attention", reasonLabel: "Question", sourceLabel: "Hook observation", coverageHint: expect.any(String),
    });
  });

  it.each(["omp", "codex", "claude"] as const)("retains %s source coverage when unavailable", (agentKind) => {
    const hook = agentKind !== "omp";
    const f = fixture({ agentKind, source: hook ? "hook" : "lifecycle", state: "unknown" });
    f.connections.clear();
    const presentation = buildTraditionalTerminalAgentRows(f.input)[0].presentation;
    expect(presentation.sourceLabel).toBe(hook ? "Hook observation" : "Lifecycle observation");
    if (hook) expect(presentation.coverageHint).toMatch(/limited coverage.*quiet reasoning.*long waits.*Unknown/);
    else expect(presentation.coverageHint).toBeNull();
    expect(presentation.label).toBe("Unavailable");
  });

  const retiredObservations: Array<[string, Partial<TerminalAgentStatusRow>]> = [
    ["native Stop", { agentKind: "codex", source: "hook", state: "unknown", lastOutcome: "ended" }],
    ["reporter release", { state: "unknown", lastOutcome: "ended" }],
    ["authority loss", { state: "unknown", reporterEpoch: 2 }],
    ["server lease expiry", { agentKind: "claude", source: "hook", state: "unknown", lastOutcome: "unknown" }],
  ];
  it.each(retiredObservations)(
    "shows the authoritative Unknown observation after %s, not a completion", (_name, patch) => {
      const f = fixture(patch);
      expect(buildTraditionalTerminalAgentRows(f.input)[0].presentation).toMatchObject({ label: "Unknown", outcomeHint: null });
    },
  );
});

describe("silent authoritative store inputs", () => {
  function install(f: Fixture, terminals: readonly TerminalAgentStatusRow[], serverEpoch = 7, revision = 1) {
    installAgentStatusSnapshot(f.profile.owner, {
      version: 1, serverEpoch, revision, availability: "ready", terminals,
    });
  }
  function currentRows(f: Fixture) {
    return buildTraditionalTerminalAgentRows({ ...f.input, profiles: useAgentStatusStore.getState().profiles });
  }

  it("removes omitted observations on a same-epoch silent baseline refresh", () => {
    const f = fixture({ lastOutcome: "ended" });
    beginAgentStatusConnection(f.profile.owner);
    install(f, [f.status]);
    expect(currentRows(f)).toHaveLength(1);
    install(f, [], 7, 2);
    expect(currentRows(f)).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("shows explicit ended from attentionRevision-zero snapshot silently", () => {
    const f = fixture({ lastOutcome: "ended", attentionRevision: 0 });
    beginAgentStatusConnection(f.profile.owner);
    install(f, [f.status]);
    expect(currentRows(f)[0]).toMatchObject({
      status: f.status, presentation: { label: "Idle", outcomeHint: "Done (turn ended)" },
    });
    expect(currentRows(f)[0].status).toBe(f.status);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("honors unavailable rebind marker even after retained rows acquire current owner", () => {
    const f = fixture({ lastOutcome: "ended" });
    beginAgentStatusConnection(f.profile.owner);
    install(f, [f.status]);
    const replacementOwner = { profileId: "alpha", generation: 2 };
    beginAgentStatusConnection(replacementOwner);
    f.connections.set("alpha", { ...f.connections.get("alpha")!, owner: replacementOwner });
    expect(currentRows(f)[0]).toMatchObject({
      statusOwner: replacementOwner, availability: "unavailable",
      presentation: { label: "Unavailable", outcomeHint: null },
    });
    installAgentStatusSnapshot(replacementOwner, {
      version: 1, serverEpoch: 8, revision: 0, availability: "ready", terminals: [f.status],
    });
    expect(currentRows(f)[0].presentation.outcomeHint).toBe("Done (turn ended)");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("uses authoritative membership replacement with no local epoch cache", () => {
    const f = fixture();
    beginAgentStatusConnection(f.profile.owner);
    install(f, [f.status]);
    expect(currentRows(f)).toHaveLength(1);
    install(f, [], 8);
    expect(currentRows(f)).toEqual([]);
    const replacement = observed({ agentKind: "codex", source: "hook", reporterEpoch: 2, state: "working", turnId: "new-turn", observedAtMs: 900, expiresAtMs: 2_000 });
    install(f, [replacement], 9);
    expect(currentRows(f)[0].status).toBe(replacement);
    expect(currentRows(f)[0]).toMatchObject({ harnessLabel: "Codex", presentation: { label: "Working", outcomeHint: null } });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("follows reporter authority/state replacement rather than remembering prior ended hint", () => {
    const f = fixture({ lastOutcome: "ended" });
    beginAgentStatusConnection(f.profile.owner);
    install(f, [f.status]);
    expect(currentRows(f)[0].presentation.outcomeHint).not.toBeNull();
    const replacement = observed({ reporterEpoch: 2, state: "unknown", lastOutcome: "ended" });
    expect(applyAgentStatusChanged(f.profile.owner, { serverEpoch: 7, revision: 2, row: replacement }, false)).toBe("applied");
    expect(currentRows(f)[0].status).toBe(replacement);
    expect(currentRows(f)[0].presentation).toMatchObject({ label: "Unknown", outcomeHint: null });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("gives identical roster regardless of ingress notification delivery setting", () => {
    const f = fixture();
    const ended = observed({ lastOutcome: "ended", attentionRevision: 1 });
    const event = {
      serverEpoch: 7, revision: 2, row: ended,
      attention: {
        id: `7:${ended.id}:1:1`, kind: "turn-ended" as const, terminalId: ended.id,
        incarnation: 1, agentKind: ended.agentKind, agentSessionId: ended.agentSessionId,
        attentionRevision: 1, timestampMs: 1_000, outcome: "ended" as const,
      },
    };
    const results = [];
    for (const notify of [false, true]) {
      useAgentStatusStore.setState({ profiles: new Map() });
      beginAgentStatusConnection(f.profile.owner);
      install(f, [f.status]);
      expect(applyAgentStatusChanged(f.profile.owner, event, notify)).toBe("applied");
      const callsBeforeBuilder = deliver.mock.calls.length;
      results.push(currentRows(f));
      expect(deliver).toHaveBeenCalledTimes(callsBeforeBuilder);
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0][0].presentation.outcomeHint).toBe("Done (turn ended)");
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
