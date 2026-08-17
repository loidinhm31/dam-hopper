import fixtures from "./ssh-forward-contract-fixtures.json";
import { describe, expect, it } from "vitest";

type Runtime = {
  startedAt?: string;
  errorCode?: string;
  [key: string]: unknown;
};

type EventHint = {
  profileId?: string;
  generation?: string;
  [key: string]: unknown;
};

describe("SSH-forward Rust/TypeScript DTO fixtures", () => {
  it("contains one parity sample for every native DTO family", () => {
    expect(Object.keys(fixtures.dtoSamples)).toEqual([
      "desktopClientContext",
      "openClientResult",
      "sshForwardProfile",
      "sshForwardKeyAuth",
      "sshConnectionProfile",
      "sshForwardRule",
      "connectionRuntime",
      "ruleRuntime",
      "credentialState",
      "runtimeWithoutOptionals",
      "runtimeWithOptionals",
      "hostKeyChallenge",
      "sshForwardSnapshot",
      "scopeActivation",
      "keyInventory",
      "eventHintWithoutOptionals",
      "eventHintWithOptionals",
    ]);
  });

  it("roundtrips every shared JSON shape through TypeScript serialization", () => {
    const roundtrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

    for (const sample of Object.values(fixtures.dtoSamples)) {
      expect(roundtrip(sample)).toEqual(sample);
    }
    expect(roundtrip(fixtures.wireCounters)).toEqual(fixtures.wireCounters);
    expect(roundtrip(fixtures.invalidWireCounters)).toEqual(fixtures.invalidWireCounters);
    expect(roundtrip(fixtures.timestamps)).toEqual(fixtures.timestamps);
    expect(roundtrip(fixtures.invalidTimestamps)).toEqual(fixtures.invalidTimestamps);
    expect(roundtrip(fixtures.knownScopes)).toEqual(fixtures.knownScopes);
    expect(roundtrip(fixtures.knownScopesUnavailable)).toEqual(
      fixtures.knownScopesUnavailable,
    );
  });

  it("keeps optional fields absent when Rust omits them", () => {
    const runtime = fixtures.dtoSamples.runtimeWithoutOptionals as Runtime;
    const hint = fixtures.dtoSamples.eventHintWithoutOptionals as EventHint;

    expect(runtime).not.toHaveProperty("startedAt");
    expect(runtime).not.toHaveProperty("errorCode");
    expect(hint).not.toHaveProperty("profileId");
    expect(hint).not.toHaveProperty("generation");

    const hintWithOptionals = fixtures.dtoSamples.eventHintWithOptionals as EventHint;
    expect(hintWithOptionals.profileId).toBe(
      "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96",
    );
    expect(hintWithOptionals.generation).toBe("100");
  });

  it("retains optional fields when supplied", () => {
    const runtime = fixtures.dtoSamples.runtimeWithOptionals as Runtime;

    expect(runtime.startedAt).toBe("2026-08-10T12:34:57.789Z");
    expect(runtime.errorCode).toBe("COUNTER_EXHAUSTED");
  });

  it("uses camelCase for key authentication fields", () => {
    expect(fixtures.dtoSamples.sshForwardKeyAuth).toEqual({
      mode: "key",
      keyId: "workstation",
    });
    expect(fixtures.dtoSamples.sshForwardKeyAuth).not.toHaveProperty("key_id");
  });

  it("keeps the v2 projection secret-free and connection-scoped", () => {
    const snapshot = fixtures.dtoSamples.sshForwardSnapshot as Record<string, unknown>;
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/password|passphrase|privateKey|vaultTarget|credentialAttempt/i);
    expect(snapshot.connections).toEqual([fixtures.dtoSamples.sshConnectionProfile]);
    expect(snapshot.rules).toEqual([fixtures.dtoSamples.sshForwardRule]);
    expect(snapshot.credentialStates).toEqual([fixtures.dtoSamples.credentialState]);
  });

  it("keeps wire scalars typed and rejects fixture-domain invalid values", () => {
    const counterPattern = /^(0|[1-9][0-9]{0,19})$/;
    const counter = (value: string) =>
      counterPattern.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    expect(fixtures.wireCounters.every(counter)).toBe(true);
    expect(fixtures.invalidWireCounters.every((value) => !counter(value))).toBe(true);
    expect(fixtures.timestamps.every((value) => timestamp.test(value))).toBe(true);
    expect(fixtures.invalidTimestamps.every((value) => !timestamp.test(value))).toBe(true);
  });

  it("distinguishes omitted optionals from explicit null fields", () => {
    expect(fixtures.dtoSamples.openClientResult).toHaveProperty("activeScopeId", null);
    expect(fixtures.dtoSamples.scopeActivation).toHaveProperty("scopeId", null);
    expect(fixtures.dtoSamples.scopeActivation).toHaveProperty("snapshot", null);
    expect(fixtures.dtoSamples.runtimeWithoutOptionals).not.toHaveProperty("startedAt");
    expect(fixtures.dtoSamples.runtimeWithoutOptionals).not.toHaveProperty("errorCode");
  });

  it("keeps known scopes tagged with the shared field names", () => {
    expect(fixtures.knownScopes).toEqual({
      status: "available",
      ids: ["c1f5890a-55d7-46ca-949b-0d63972f0a68"],
    });
    expect(fixtures.knownScopes).not.toHaveProperty("knownScopes");
    expect(fixtures.knownScopesUnavailable).toEqual({ status: "unavailable" });
  });
});
