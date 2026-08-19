import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { useSshForwardPageController } from "@/hooks/use-ssh-forward-page-controller.js";
import {
  parseWireCounter,
  type SshConnectionProfile,
  type SshConnectionRuntime,
  type SshForwardHost,
  type SshForwardRule,
  type SshForwardSnapshot,
} from "@/lib/ssh-forward-host.js";
import { SshForwardingPage } from "./SshForwardingPage.js";

type Controller = ReturnType<typeof useSshForwardPageController>;
const state = vi.hoisted(() => ({ value: null as Controller | null }));

vi.mock("@/hooks/use-ssh-forward-page-controller.js", () => ({
  useSshForwardPageController: () => state.value,
}));
vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({
    children,
    title,
    actions,
  }: {
    children: ReactNode;
    title?: string;
    actions?: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));
vi.mock("@/components/molecules/SshConnectionCard.js", () => ({
  SshConnectionCard: ({
    connection,
    rules,
    pending,
  }: {
    connection: SshConnectionProfile;
    rules: SshForwardRule[];
    pending: boolean;
  }) => (
    <article>
      <h2>{connection.name}</h2>
      <p>
        {connection.sshUser}@{connection.sshHost}:{connection.sshPort}
      </p>
      {rules.map((rule) => (
        <p key={rule.id}>127.0.0.1:{rule.localPort}</p>
      ))}
      <button disabled={pending}>Mutate connection</button>
    </article>
  ),
}));
vi.mock("@/components/organisms/SshConnectionDialog.js", () => ({
  SshConnectionDialog: () => null,
}));
vi.mock("@/components/organisms/SshForwardRuleDialog.js", () => ({
  SshForwardRuleDialog: () => null,
}));
vi.mock("@/components/organisms/SshHostKeyApprovalDialog.js", () => ({
  SshHostKeyApprovalDialog: () => null,
}));
vi.mock("@/components/organisms/PassphraseDialog.js", () => ({
  PassphraseDialog: (props: {
    passwordAuth?: unknown;
    saveForLaterAuth?: string;
  }) => (
    <div data-testid="passphrase-dialog">
      {props.passwordAuth ? "password fallback" : "key-only credentials"}
      <span>{props.saveForLaterAuth}</span>
    </div>
  ),
}));

const counter = parseWireCounter("1")!;
const connection: SshConnectionProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "Bastion",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  createdAt: "2026-08-10T12:34:56.789Z" as SshConnectionProfile["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshConnectionProfile["updatedAt"],
};
const rule: SshForwardRule = {
  id: "44444444-4444-4444-8444-444444444444",
  scopeId: connection.scopeId,
  connectionProfileId: connection.id,
  name: "metrics",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  desiredEnabled: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt,
};

function controller(
  host: SshForwardHost | null,
  kind: "web" | "nativeDesktop",
): Controller {
  return {
    host,
    environment: { kind },
    forwarding: {
      snapshot: null,
      error: null,
      pending: false,
      pendingAction: null,
      refresh: vi.fn(),
      createConnection: vi.fn(),
      updateConnection: vi.fn(),
      deleteConnection: vi.fn(),
      createRule: vi.fn(),
      updateRule: vi.fn(),
      deleteRule: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      setRuleEnabled: vi.fn(),
      listKeys: vi.fn(),
      loadKey: vi.fn(),
      loadPassword: vi.fn(),
      approveHost: vi.fn(),
      forgetCredential: vi.fn(),
    },
    connections: [],
    connectionRuntimes: new Map(),
    ruleRuntimes: new Map(),
    credentials: new Map(),
    challenges: new Map(),
    connectionGeneration: vi.fn(() => counter),
    ruleGeneration: vi.fn(() => counter),
    connectionFormOpen: false,
    connectionFormExisting: null,
    connectionFormSource: null,
    ruleFormOpen: false,
    ruleFormExisting: null,
    ruleFormConnection: null,
    trustTarget: null,
    trustApproved: false,
    passphraseTarget: null,
    passphraseError: null,
    passphraseLoading: false,
    confirmation: null,
    notice: null,
    setNotice: vi.fn(),
    openNewConnection: vi.fn(),
    openEditConnection: vi.fn(),
    closeConnectionForm: vi.fn(),
    openNewRule: vi.fn(),
    openEditRule: vi.fn(),
    closeRuleForm: vi.fn(),
    connect: vi.fn(),
    requestDisconnect: vi.fn(),
    requestDeleteConnection: vi.fn(),
    requestDeleteRule: vi.fn(),
    requestForgetCredential: vi.fn(),
    confirmAction: vi.fn(),
    cancelConfirmation: vi.fn(),
    setRuleEnabled: vi.fn(),
    saveConnection: vi.fn(),
    saveRule: vi.fn(),
    submitPassphrase: vi.fn(),
    submitPassword: vi.fn(),
    cancelPassphrase: vi.fn(),
    approveHost: vi.fn(),
    openTrust: vi.fn(),
    setTrustTarget: vi.fn(),
    run: vi.fn(),
    inspectLifecycleResult: vi.fn(),
  } as unknown as Controller;
}

describe("SshForwardingPage", () => {
  it("does not render outside native desktop", () => {
    state.value = controller(null, "web");
    expect(renderToStaticMarkup(<SshForwardingPage />)).toBe("");
  });

  it("renders one connection with grouped rules and local-process warning", () => {
    const value = controller({} as SshForwardHost, "nativeDesktop");
    value.connections.push(connection);
    value.forwarding.snapshot = {
      context: {
        desktopInstanceId: "11111111-1111-4111-8111-111111111111",
        managerSessionId: "22222222-2222-4222-8222-222222222222",
        clientEpoch: counter,
      },
      scopeId: connection.scopeId,
      activationToken: counter,
      scopeGeneration: counter,
      connectionsRevision: counter,
      rulesRevision: counter,
      profilesRevision: counter,
      trustRevision: counter,
      connections: [connection],
      rules: [rule],
      connectionRuntimes: [],
      ruleRuntimes: [],
      credentialStates: [
        { connectionProfileId: connection.id, status: "none" },
      ],
      profiles: [],
      runtimes: [],
      hostKeyChallenges: [],
    } as SshForwardSnapshot;
    state.value = value;
    const markup = renderToStaticMarkup(<SshForwardingPage />);
    expect(markup).toContain("SSH Forwarding");
    expect(markup).toContain("Bastion");
    expect(markup).toContain("127.0.0.1:15432");
    expect(markup).toContain("Any process on this computer can connect");
  });

  it("keeps saved-connection and active-session limits separate", () => {
    const value = controller({} as SshForwardHost, "nativeDesktop");
    value.connections = Array.from({ length: 16 }, (_, index) => ({
      ...connection,
      id: `${index + 1}`
        .padStart(32, "0")
        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"),
      name: `Bastion ${index + 1}`,
    }));
    const runtime: SshConnectionRuntime = {
      connectionProfileId: value.connections[0].id,
      generation: counter,
      state: "established",
      retryAttempt: 0,
      activeChannels: 0,
      stateChangedAt: connection.updatedAt,
    };
    value.connectionRuntimes = new Map([
      [runtime.connectionProfileId, runtime],
    ]);
    state.value = value;

    const markup = renderToStaticMarkup(<SshForwardingPage />);
    expect(markup).toContain("16/64 saved connections");
    expect(markup).toContain("1/16 active connections");
    expect(markup).not.toContain(
      'title="The 64 saved-connection limit is reached"',
    );
  });

  it("blocks mutations while native state contains orphan rules", () => {
    const value = controller({} as SshForwardHost, "nativeDesktop");
    value.connections.push(connection);
    value.forwarding.snapshot = {
      context: {
        desktopInstanceId: "11111111-1111-4111-8111-111111111111",
        managerSessionId: "22222222-2222-4222-8222-222222222222",
        clientEpoch: counter,
      },
      scopeId: connection.scopeId,
      activationToken: counter,
      scopeGeneration: counter,
      connectionsRevision: counter,
      rulesRevision: counter,
      profilesRevision: counter,
      trustRevision: counter,
      connections: [connection],
      rules: [{ ...rule, connectionProfileId: "missing-connection" }],
      connectionRuntimes: [],
      ruleRuntimes: [],
      credentialStates: [],
      profiles: [],
      runtimes: [],
      hostKeyChallenges: [],
    } as SshForwardSnapshot;
    state.value = value;

    const markup = renderToStaticMarkup(<SshForwardingPage />);
    expect(markup).toContain("state is inconsistent");
    expect(markup).toContain("Refresh before changing forwarding state");
    expect(markup).toContain('disabled=""');
  });

  it("does not offer password fallback for key-auth connections", () => {
    const value = controller({} as SshForwardHost, "nativeDesktop");
    value.passphraseTarget = {
      connection: {
        ...connection,
        auth: { mode: "key", keyId: "id_ed25519" },
      },
      keys: [],
    };
    state.value = value;

    const markup = renderToStaticMarkup(<SshForwardingPage />);
    expect(markup).toContain("key-only credentials");
    expect(markup).toContain("key");
    expect(markup).not.toContain("password fallback");
  });
});
