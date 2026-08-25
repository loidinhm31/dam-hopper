import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SshForwardRuleCard } from "./SshForwardRuleCard.js";
import type { SshForwardRule } from "@/lib/ssh-forward-host.js";

const rule: SshForwardRule = {
  id: "44444444-4444-4444-8444-444444444444",
  scopeId: "11111111-1111-4111-8111-111111111111",
  connectionProfileId: "22222222-2222-4222-8222-222222222222",
  name: "metrics",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  desiredEnabled: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: "2026-08-10T12:34:56.789Z" as never,
  updatedAt: "2026-08-10T12:34:56.789Z" as never,
};

describe("SshForwardRuleCard", () => {
  it("allows changing desired state while disconnected", () => {
    const markup = renderToStaticMarkup(
      <SshForwardRuleCard
        rule={rule}
        pending={false}
        onSetEnabled={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain('role="switch"');
    expect(markup).not.toContain('disabled=""');
  });

  it("shows desired-enabled disconnected rules as pending, not active", () => {
    const markup = renderToStaticMarkup(
      <SshForwardRuleCard
        rule={{ ...rule, desiredEnabled: true }}
        pending={false}
        onSetEnabled={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("Desired state saved; the listener will start");
    expect(markup).not.toContain("Disable the rule before editing");
  });

  it("allows editing a rule whose listener failed to start", () => {
    const markup = renderToStaticMarkup(
      <SshForwardRuleCard
        rule={rule}
        runtime={{
          ruleId: rule.id,
          connectionProfileId: rule.connectionProfileId,
          connectionGeneration: "1" as never,
          generation: "1" as never,
          state: "failed",
          bindHost: "127.0.0.1",
          localPort: rule.localPort,
          activeChannels: 0,
          stateChangedAt: rule.updatedAt,
          errorCode: "BIND_FAILED",
        }}
        pending={false}
        onSetEnabled={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).not.toContain("Disable the rule before editing");
    expect(markup).toContain("The listener could not establish");
  });

  it("keeps the rule controls available while the connection is recovering", () => {
    const markup = renderToStaticMarkup(
      <SshForwardRuleCard
        rule={rule}
        runtime={{
          ruleId: rule.id,
          connectionProfileId: rule.connectionProfileId,
          connectionGeneration: "1" as never,
          generation: "1" as never,
          state: "on",
          bindHost: "127.0.0.1",
          localPort: rule.localPort,
          activeChannels: 0,
          stateChangedAt: rule.updatedAt,
        }}
        pending={false}
        enabledRuleLimitReached
        onSetEnabled={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onBlockedAction={() => {}}
      />,
    );
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="Disable metrics"');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('disabled=""');
  });
});
