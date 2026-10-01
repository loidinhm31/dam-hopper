import { describe, expect, it } from "vitest";
import { parsePluginMetadata } from "./plugin-metadata.js";

describe("parsePluginMetadata", () => {
  const validMetadata = {
    activeDigest: "a".repeat(64),
    activeGeneration: 1,
    capabilities: ["policy.readCurrent"],
    enabled: true,
    hasUi: true,
    id: "evcrate.advisor",
    publisher: "evcrate",
    version: "1.0.0",
  };

  it("parses valid plugin metadata correctly", () => {
    expect(parsePluginMetadata(validMetadata)).toEqual(validMetadata);
  });

  it("allows optional ownerHistorySource property", () => {
    const withOwner = {
      ...validMetadata,
      ownerHistorySource: "some-source",
    };
    expect(parsePluginMetadata(withOwner)).toEqual(withOwner);
  });

  it("returns null for non-object, null, or array inputs", () => {
    expect(parsePluginMetadata(null)).toBeNull();
    expect(parsePluginMetadata(undefined)).toBeNull();
    expect(parsePluginMetadata("string")).toBeNull();
    expect(parsePluginMetadata(123)).toBeNull();
    expect(parsePluginMetadata([])).toBeNull();
  });

  it("returns null if required fields are missing or wrong types", () => {
    expect(parsePluginMetadata({ ...validMetadata, id: "" })).toBeNull();
    expect(parsePluginMetadata({ ...validMetadata, version: 1 })).toBeNull();
    expect(parsePluginMetadata({ ...validMetadata, capabilities: "not-array" })).toBeNull();
    expect(parsePluginMetadata({ ...validMetadata, capabilities: [""] })).toBeNull();
    expect(parsePluginMetadata({ ...validMetadata, activeGeneration: -1 })).toBeNull();
    expect(parsePluginMetadata({ ...validMetadata, activeGeneration: 1.5 })).toBeNull();
    expect(parsePluginMetadata({ ...validMetadata, enabled: "true" })).toBeNull();
  });

  it("returns null when unexpected fields are present", () => {
    expect(
      parsePluginMetadata({
        ...validMetadata,
        extraProperty: "unexpected",
      }),
    ).toBeNull();
  });
});
