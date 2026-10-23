import { describe, it, expect, beforeEach } from "vitest";
import {
  isSupportedSemanticPath,
  detectLanguageDescriptor,
  buildLocalModelUri,
  normalizeRelativePath,
  formatSemanticWireUri,
  parseSemanticWireUri,
  SemanticModelRegistry,
} from "./semantic-model-uri.js";

describe("semantic-model-uri", () => {
  describe("path validation and language detection", () => {
    it("identifies supported extensions", () => {
      expect(isSupportedSemanticPath("index.ts")).toBe(true);
      expect(isSupportedSemanticPath("src/App.tsx")).toBe(true);
      expect(isSupportedSemanticPath("legacy/utils.js")).toBe(true);
      expect(isSupportedSemanticPath("components/Card.jsx")).toBe(true);
      expect(isSupportedSemanticPath("readme.md")).toBe(false);
      expect(isSupportedSemanticPath("Cargo.toml")).toBe(false);
      expect(isSupportedSemanticPath("style.css")).toBe(false);
    });

    it("detects language descriptor", () => {
      expect(detectLanguageDescriptor("file.ts")).toBe("typescript");
      expect(detectLanguageDescriptor("file.tsx")).toBe("typescript");
      expect(detectLanguageDescriptor("file.js")).toBe("javascript");
      expect(detectLanguageDescriptor("file.jsx")).toBe("javascript");
      expect(detectLanguageDescriptor("file.py")).toBeNull();
    });
  });

  describe("URI formatting and parsing", () => {
    it("builds local in-memory URI encoding tab key", () => {
      const tabKey = JSON.stringify(["file", "proj", "target", "src/index.ts"]);
      const localUri = buildLocalModelUri(tabKey);
      expect(localUri.startsWith("inmemory://dam-hopper/")).toBe(true);
      expect(
        decodeURIComponent(localUri.replace("inmemory://dam-hopper/", "")),
      ).toBe(tabKey);
    });

    it("normalizes valid relative paths", () => {
      expect(normalizeRelativePath("src/index.ts")).toBe("src/index.ts");
      expect(normalizeRelativePath("./src/index.ts")).toBe("src/index.ts");
      expect(normalizeRelativePath("/src/index.ts")).toBe("src/index.ts");
      expect(normalizeRelativePath("src\\components\\Button.tsx")).toBe(
        "src/components/Button.tsx",
      );
    });

    it("rejects path traversal and null bytes", () => {
      expect(normalizeRelativePath("../outside.ts")).toBeNull();
      expect(normalizeRelativePath("src/../../outside.ts")).toBeNull();
      expect(normalizeRelativePath("src/file\0.ts")).toBeNull();
      expect(normalizeRelativePath("")).toBeNull();
    });

    it("formats and parses semantic wire URI", () => {
      const wireUri = formatSemanticWireUri("target-123", "src/main.ts");
      expect(wireUri).toBe("dam-hopper://semantic/target-123/src/main.ts");

      const parsed = parseSemanticWireUri(wireUri, "target-123");
      expect(parsed).toEqual({
        targetId: "target-123",
        relativePath: "src/main.ts",
      });
    });

    it("handles complex file names safely", () => {
      const wireUri = formatSemanticWireUri("target-1", "src/[id].tsx");
      expect(wireUri).toBe("dam-hopper://semantic/target-1/src/%5Bid%5D.tsx");

      const parsed = parseSemanticWireUri(wireUri, "target-1");
      expect(parsed).toEqual({
        targetId: "target-1",
        relativePath: "src/[id].tsx",
      });
    });

    it("rejects invalid wire URIs, foreign schemes, and traversal", () => {
      expect(parseSemanticWireUri("file:///etc/passwd")).toBeNull();
      expect(parseSemanticWireUri("http://example.com/test.ts")).toBeNull();
      expect(
        parseSemanticWireUri("dam-hopper://other/target/test.ts"),
      ).toBeNull();
      expect(
        parseSemanticWireUri("dam-hopper://semantic/target-1/../secret.ts"),
      ).toBeNull();
      expect(
        parseSemanticWireUri(
          "dam-hopper://semantic/target-1/src/test.ts?query=1",
        ),
      ).toBeNull();
      expect(
        parseSemanticWireUri("dam-hopper://semantic/target-1/src/test.ts#hash"),
      ).toBeNull();
      expect(
        parseSemanticWireUri(
          "dam-hopper://semantic/wrong-target/test.ts",
          "target-1",
        ),
      ).toBeNull();
    });
  });

  describe("SemanticModelRegistry", () => {
    let registry: SemanticModelRegistry;

    beforeEach(() => {
      registry = new SemanticModelRegistry();
    });

    it("registers model with stable identity and increments incarnation on reopen", () => {
      const tabKey = "tab-1";
      const model1 = registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });

      expect(model1.identity.incarnation).toBe(1);
      expect(model1.identity.relativePath).toBe("src/index.ts");
      expect(model1.wireBinding).toBeNull();
      // Remounting/re-registering while open is idempotent
      const sameModel = registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });
      expect(sameModel.identity.incarnation).toBe(1);

      // Close document
      registry.unregisterModel(tabKey);

      // Reopen same tabKey -> incarnation increments to 2
      const model2 = registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });

      expect(model2.identity.incarnation).toBe(2);
    });

    it("binds wire session and allows reverse lookup by wire URI", () => {
      const tabKey = "tab-1";
      registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });

      const binding = registry.bindWire(tabKey, {
        targetId: "target-99",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 1,
        languageDescriptor: "typescript",
        initialWireVersion: 1,
      });

      expect(binding).not.toBeNull();
      expect(binding?.wireUri).toBe(
        "dam-hopper://semantic/target-99/src/index.ts",
      );
      expect(binding?.wireVersion).toBe(1);

      const resolved = registry.getByWireUri(
        "dam-hopper://semantic/target-99/src/index.ts",
      );
      expect(resolved?.identity.tabKey).toBe(tabKey);
      expect(resolved?.wireBinding?.targetId).toBe("target-99");
    });

    it("bumps wire version monotonically", () => {
      const tabKey = "tab-1";
      registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });

      registry.bindWire(tabKey, {
        targetId: "target-99",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 1,
        languageDescriptor: "typescript",
        initialWireVersion: 1,
      });

      expect(registry.bumpWireVersion(tabKey)).toBe(2);
      expect(registry.bumpWireVersion(tabKey)).toBe(3);
    });

    it("clears wire bindings without losing registered local models on reconnect", () => {
      const tabKey = "tab-1";
      registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });

      registry.bindWire(tabKey, {
        targetId: "target-99",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 1,
        languageDescriptor: "typescript",
      });

      // Disconnect
      registry.clearWireBindings("target-99");

      // Local model is still registered!
      const model = registry.getByTabKey(tabKey);
      expect(model).toBeDefined();
      expect(model?.identity.relativePath).toBe("src/index.ts");
      expect(model?.wireBinding).toBeNull();
      expect(
        registry.getByWireUri("dam-hopper://semantic/target-99/src/index.ts"),
      ).toBeUndefined();
    });

    it("completely removes model and wire index on unregisterModel", () => {
      const tabKey = "tab-1";
      registry.registerModel({
        tabKey,
        profileId: "profile-1",
        project: "my-project",
        targetKey: "target-key-1",
        relativePath: "src/index.ts",
      });

      registry.bindWire(tabKey, {
        targetId: "target-99",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 1,
        languageDescriptor: "typescript",
      });

      registry.unregisterModel(tabKey);

      expect(registry.getByTabKey(tabKey)).toBeUndefined();
      expect(
        registry.getByWireUri("dam-hopper://semantic/target-99/src/index.ts"),
      ).toBeUndefined();
    });
  });
});
