import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticSettingsResponse } from "@/api/client.js";
import { SettingsSemanticNavigationSection } from "./SettingsSemanticNavigationSection.js";

const mocks = vi.hoisted(() => ({
  status: undefined as SemanticSettingsResponse | undefined,
  isLoading: false,
  isError: false,
  isPending: false,
  mutateAsync: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  useSemanticSettings: () => ({
    data: mocks.status,
    isLoading: mocks.isLoading,
    isError: mocks.isError,
  }),
  useUpdateSemanticSettings: () => ({
    isPending: mocks.isPending,
    mutateAsync: mocks.mutateAsync,
  }),
}));

function mockStatus(overrides: Partial<SemanticSettingsResponse> = {}): SemanticSettingsResponse {
  return {
    configuredEnabled: false,
    runtimeEnabled: false,
    runtimeState: "disabled",
    integrityStatus: "Valid",
    toolchainReady: true,
    tupleIdentifier: "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64",
    policyCapability: "cgroup-v2",
    resourceWarning: undefined,
    activeTrees: 0,
    openDocuments: 0,
    totalOverlayBytes: 0,
    generation: 1,
    transitionError: undefined,
    canMutate: true,
    ...overrides,
  };
}

function markup() {
  return renderToStaticMarkup(<SettingsSemanticNavigationSection />);
}

describe("SettingsSemanticNavigationSection", () => {
  beforeEach(() => {
    mocks.status = mockStatus();
    mocks.isLoading = false;
    mocks.isError = false;
    mocks.isPending = false;
    mocks.mutateAsync.mockReset();
  });

  it("renders loading state", () => {
    mocks.isLoading = true;
    const output = markup();
    expect(output).toContain("Loading semantic navigation settings…");
  });

  it("renders error state when fetch fails", () => {
    mocks.isError = true;
    mocks.status = undefined;
    const output = markup();
    expect(output).toContain("Failed to load semantic navigation status");
  });

  it("renders enabled admin view with engine tuple and metrics", () => {
    mocks.status = mockStatus({
      configuredEnabled: true,
      runtimeEnabled: true,
      runtimeState: "ready",
      activeTrees: 1,
      openDocuments: 3,
      totalOverlayBytes: 1024,
      canMutate: true,
    });
    const output = markup();
    expect(output).toContain("Enable Semantic Navigation");
    expect(output).toContain("node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64");
    expect(output).toContain("ready");
    expect(output).toContain("Verified");
    expect(output).toContain(">1<"); // active trees
    expect(output).toContain(">3<"); // open documents
  });

  it("renders disabled toggle with role notice for non-admin callers", () => {
    mocks.status = mockStatus({
      canMutate: false,
    });
    const output = markup();
    expect(output).toContain("Administrator role required to change global semantic settings");
    expect(output).toContain("disabled=\"\"");
  });

  it("renders advisory portable warning when running in portable mode", () => {
    mocks.status = mockStatus({
      policyCapability: "portable-only",
      resourceWarning: "Linux cgroup v2 controllers not available; running with advisory portable resource limits.",
    });
    const output = markup();
    expect(output).toContain("Advisory Portable Resource Limits");
    expect(output).toContain("Linux cgroup v2 controllers not available");
  });

  it("renders configuration mismatch banner when safe-disabled", () => {
    mocks.status = mockStatus({
      configuredEnabled: true,
      runtimeEnabled: false,
      runtimeState: "safe-disabled",
      transitionError: "Admin demoted during cleanup",
    });
    const output = markup();
    expect(output).toContain("Configuration / Runtime Mismatch");
    expect(output).toContain("effective runtime state is safe-disabled");
    expect(output).toContain("Admin demoted during cleanup");
  });
});
