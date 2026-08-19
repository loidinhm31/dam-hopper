import type {
  HostKeyChallenge,
  KeyInventory,
  SshConnectionProfile,
  SshConnectionRuntime,
  SshForwardHost,
  SshForwardRule,
  SshForwardRuleRuntime,
  SshForwardSnapshot,
  WireCounter,
} from "@/lib/ssh-forward-host.js";

const scopeId = "11111111-1111-4111-8111-111111111111";
const alphaId = "22222222-2222-4222-8222-222222222222";
const betaId = "33333333-3333-4333-8333-333333333333";
const alphaRuleId = "44444444-4444-4444-8444-444444444444";
const alphaLogsRuleId = "55555555-5555-4555-8555-555555555555";
const betaRuleId = "66666666-6666-4666-8666-666666666666";
const betaLogsRuleId = "77777777-7777-4777-8777-777777777777";
const timestamp =
  "2026-08-18T12:00:00.000Z" as SshConnectionProfile["createdAt"];
const generation = "1" as WireCounter;

export type SshForwardFixtureKind = "auth" | "multi" | "gated";
export interface SshForwardFixture {
  host: SshForwardHost;
  calls: {
    connect: Array<{ connectionId: string }>;
    approveHost: number;
    listKeys: number;
    loadPassword: Array<{
      connectionId: string;
      username: string;
      rememberForDays: 0 | 30;
    }>;
    setRuleEnabled: Array<{
      connectionId: string;
      ruleId: string;
      enabled: boolean;
    }>;
  };
}

function connection(
  id: string,
  name: string,
  host: string,
): SshConnectionProfile {
  return {
    id,
    scopeId,
    name,
    sshHost: host,
    sshPort: 22,
    sshUser: "operator",
    auth: { mode: "agent" },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function rule(
  id: string,
  connectionProfileId: string,
  name: string,
  localPort: number,
  targetPort: number,
): SshForwardRule {
  return {
    id,
    scopeId,
    connectionProfileId,
    name,
    localPort,
    targetHost: "127.0.0.1",
    targetPort,
    desiredEnabled: false,
    reconnect: { enabled: true, maxAttempts: 3 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function runtime(
  connectionProfileId: string,
  state: SshConnectionRuntime["state"],
  errorCode?: SshConnectionRuntime["errorCode"],
): SshConnectionRuntime {
  return {
    connectionProfileId,
    generation,
    state,
    retryAttempt: 0,
    activeChannels: 0,
    stateChangedAt: timestamp,
    ...(errorCode ? { errorCode } : {}),
  };
}

function ruleRuntime(
  item: SshForwardRule,
  state: SshForwardRuleRuntime["state"],
): SshForwardRuleRuntime {
  return {
    ruleId: item.id,
    connectionProfileId: item.connectionProfileId,
    connectionGeneration: generation,
    generation,
    state,
    bindHost: "127.0.0.1",
    localPort: item.localPort,
    activeChannels: 0,
    stateChangedAt: timestamp,
  };
}

function snapshot(
  connections: SshConnectionProfile[],
  rules: SshForwardRule[],
  connectionRuntimes: SshConnectionRuntime[],
  ruleRuntimes: SshForwardRuleRuntime[],
  hostKeyChallenges: HostKeyChallenge[] = [],
  credentialStates = connections.map((item) => ({
    connectionProfileId: item.id,
    status: "none" as const,
  })),
): SshForwardSnapshot {
  return {
    context: {
      desktopInstanceId: "88888888-8888-4888-8888-888888888888",
      managerSessionId: "99999999-9999-4999-8999-999999999999",
      clientEpoch: generation,
    },
    scopeId,
    activationToken: generation,
    scopeGeneration: generation,
    connectionsRevision: generation,
    rulesRevision: generation,
    profilesRevision: generation,
    trustRevision: generation,
    connections,
    rules,
    connectionRuntimes,
    ruleRuntimes,
    credentialStates,
    profiles: [],
    runtimes: [],
    hostKeyChallenges,
  };
}

export function createSshForwardFixture(
  kind: SshForwardFixtureKind,
): SshForwardFixture {
  const alpha = connection(alphaId, "Alpha", "alpha.example");
  const beta = connection(betaId, "Beta", "beta.example");
  const alphaRule = rule(alphaRuleId, alphaId, "Alpha metrics", 15432, 5432);
  const alphaLogs = rule(alphaLogsRuleId, alphaId, "Alpha logs", 15433, 5433);
  const betaRule = rule(betaRuleId, betaId, "Beta metrics", 25432, 5432);
  const betaLogs = rule(betaLogsRuleId, betaId, "Beta logs", 25433, 5433);
  const connections = kind === "multi" ? [alpha, beta] : [alpha];
  const rules =
    kind === "multi"
      ? [alphaRule, alphaLogs, betaRule, betaLogs]
      : [
          kind === "gated"
            ? { ...alphaRule, name: "Blocked metrics" }
            : alphaRule,
        ];
  const established = kind === "multi";
  let current = snapshot(
    connections,
    rules,
    connections.map((item) =>
      runtime(item.id, established ? "established" : "disconnected"),
    ),
    rules.map((item) => ruleRuntime(item, "off")),
  );
  const calls: SshForwardFixture["calls"] = {
    connect: [],
    approveHost: 0,
    listKeys: 0,
    loadPassword: [],
    setRuleEnabled: [],
  };
  const publish = (next: SshForwardSnapshot) => {
    current = next;
    return Promise.resolve(current);
  };
  const host: SshForwardHost = {
    openClient: async () => ({
      context: current.context,
      activationTokenFloor: "0" as WireCounter,
      activeScopeId: scopeId,
      scopeGeneration: generation,
    }),
    activateScope: async () => ({
      context: current.context,
      activationToken: generation,
      scopeId,
      scopeGeneration: generation,
      snapshot: current,
    }),
    snapshot: async () => current,
    connect: async (connectionProfileId) => {
      calls.connect.push({ connectionId: connectionProfileId });
      if (kind === "auth" && calls.connect.length === 1) {
        const challenge: HostKeyChallenge = {
          challengeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          connectionProfileId,
          scopeId,
          generation,
          sshHost: alpha.sshHost,
          sshPort: alpha.sshPort,
          algorithm: "ssh-ed25519",
          fingerprint: "SHA256:browser-fixture-fingerprint",
          expiresAt:
            "2026-08-18T12:30:00.000Z" as HostKeyChallenge["expiresAt"],
        };
        return publish(
          snapshot(
            current.connections,
            current.rules,
            [
              runtime(
                connectionProfileId,
                "disconnected",
                "HOST_KEY_APPROVAL_REQUIRED",
              ),
            ],
            current.ruleRuntimes,
            [challenge],
          ),
        );
      }
      if (kind === "auth" && calls.connect.length === 2)
        return publish(
          snapshot(
            current.connections,
            current.rules,
            [runtime(connectionProfileId, "disconnected", "AUTH_REQUIRED")],
            current.ruleRuntimes,
          ),
        );
      return publish(
        snapshot(
          current.connections,
          current.rules,
          current.connectionRuntimes.map((item) =>
            item.connectionProfileId === connectionProfileId
              ? runtime(connectionProfileId, "established")
              : item,
          ),
          current.ruleRuntimes,
          [],
          current.credentialStates,
        ),
      );
    },
    approveHost: async () => {
      calls.approveHost += 1;
      return publish(
        snapshot(
          current.connections,
          current.rules,
          current.connectionRuntimes.map((item) =>
            runtime(item.connectionProfileId, "disconnected"),
          ),
          current.ruleRuntimes,
        ),
      );
    },
    listKeys: async (): Promise<KeyInventory> => {
      calls.listKeys += 1;
      return {
        context: current.context,
        scopeId,
        scopeGeneration: generation,
        keys: [
          {
            keyId: "fixture-key",
            label: "Fixture key",
            algorithm: "ed25519",
            fingerprint: "fixture",
            encrypted: true,
            source: "local",
          },
        ],
      };
    },
    updateConnection: async (
      connectionProfileId,
      _expectedGeneration,
      updated,
    ) =>
      publish(
        snapshot(
          current.connections.map((item) =>
            item.id === connectionProfileId ? updated : item,
          ),
          current.rules,
          current.connectionRuntimes,
          current.ruleRuntimes,
          current.hostKeyChallenges,
          current.credentialStates,
        ),
      ),
    loadPassword: async (
      connectionProfileId,
      username,
      _password,
      _attemptId,
      _expectedGeneration,
      rememberForDays = 30,
    ) => {
      calls.loadPassword.push({
        connectionId: connectionProfileId,
        username,
        rememberForDays,
      });
      return publish(
        snapshot(
          current.connections,
          current.rules,
          current.connectionRuntimes,
          current.ruleRuntimes,
          [],
          current.credentialStates.map((item) =>
            item.connectionProfileId === connectionProfileId
              ? {
                  connectionProfileId,
                  status: "saved",
                  expiresAt:
                    "2026-09-17T12:00:00.000Z" as SshForwardSnapshot["credentialStates"][number]["expiresAt"],
                }
              : item,
          ),
        ),
      );
    },
    setRuleEnabled: async (
      connectionProfileId,
      _connectionGeneration,
      ruleId,
      _ruleGeneration,
      enabled,
    ) => {
      calls.setRuleEnabled.push({
        connectionId: connectionProfileId,
        ruleId,
        enabled,
      });
      return publish(
        snapshot(
          current.connections,
          current.rules.map((item) =>
            item.id === ruleId ? { ...item, desiredEnabled: enabled } : item,
          ),
          current.connectionRuntimes,
          current.ruleRuntimes.map((item) =>
            item.ruleId === ruleId
              ? ruleRuntime(
                  current.rules.find((candidate) => candidate.id === ruleId)!,
                  enabled ? "on" : "off",
                )
              : item,
          ),
          current.hostKeyChallenges,
          current.credentialStates,
        ),
      );
    },
    disconnect: async (connectionProfileId) =>
      publish(
        snapshot(
          current.connections,
          current.rules,
          current.connectionRuntimes.map((item) =>
            item.connectionProfileId === connectionProfileId
              ? runtime(connectionProfileId, "disconnected")
              : item,
          ),
          current.ruleRuntimes,
        ),
      ),
    subscribe: () => () => {},
    dispose: () => {},
  } as unknown as SshForwardHost;
  return { host, calls };
}
