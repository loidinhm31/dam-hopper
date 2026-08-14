import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { useSshForwardPageController } from "@/hooks/use-ssh-forward-page-controller.js";
import {
  parseWireCounter,
  type SshForwardHost,
  type SshForwardProfile,
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
vi.mock("@/components/organisms/SshForwardProfileDialog.js", () => ({
  SshForwardProfileDialog: () => null,
}));
vi.mock("@/components/organisms/SshHostKeyApprovalDialog.js", () => ({
  SshHostKeyApprovalDialog: () => null,
}));

const counter = parseWireCounter("1")!;
const profile: SshForwardProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "metrics",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" as const },
  localPort: 15432,
  targetHost: "127.0.0.1" as const,
  targetPort: 5432,
  autoStart: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: "2026-08-10T12:34:56.789Z" as SshForwardProfile["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshForwardProfile["updatedAt"],
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
      listKeys: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      createProfile: vi.fn(),
      updateProfile: vi.fn(),
      deleteProfile: vi.fn(),
      approveHost: vi.fn(),
    },
    runtimes: new Map(),
    challenges: new Map(),
    formOpen: false,
    formExisting: null,
    formSource: null,
    trustTarget: null,
    trustApproved: false,
    notice: null,
    setNotice: vi.fn(),
    openNew: vi.fn(),
    openEdit: vi.fn(),
    closeForm: vi.fn(),
    run: vi.fn(),
    lifecycle: vi.fn(),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    approveHost: vi.fn(),
    openTrust: vi.fn(),
    setTrustTarget: vi.fn(),
    profileGeneration: vi.fn(() => "0"),
  } as unknown as Controller;
}

describe("SshForwardingPage", () => {
  it("does not render outside native desktop", () => {
    state.value = controller(null, "web");
    expect(renderToStaticMarkup(<SshForwardingPage />)).toBe("");
  });

  it("renders the desktop scope and local-process boundary", () => {
    const value = controller({} as SshForwardHost, "nativeDesktop");
    value.forwarding.snapshot = {
      context: {
        desktopInstanceId: "11111111-1111-4111-8111-111111111111",
        managerSessionId: "22222222-2222-4222-8222-222222222222",
        clientEpoch: counter,
      },
      scopeId: profile.scopeId,
      activationToken: counter,
      scopeGeneration: counter,
      profilesRevision: counter,
      trustRevision: counter,
      profiles: [profile],
      runtimes: [],
      hostKeyChallenges: [],
    } as SshForwardSnapshot;
    state.value = value;
    const markup = renderToStaticMarkup(<SshForwardingPage />);
    expect(markup).toContain("SSH Forwarding");
    expect(markup).toContain("Any process on this computer can connect");
    expect(markup).toContain("127.0.0.1:15432");
  });
});
