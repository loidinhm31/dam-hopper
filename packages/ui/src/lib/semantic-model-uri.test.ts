import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isSupportedSemanticPath,
  detectLanguageDescriptor,
  buildLocalModelUri,
  normalizeRelativePath,
  formatSemanticWireUri,
  parseSemanticWireUri,
  SemanticModelRegistry,
  captureSemanticProvenance,
  matchesSemanticProvenance,
  computeUtf8Sha256Hex,
  computeUtf8Sha256HexSync,
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

    it("stores immutable provenance, notifies subscribe listeners on structural changes, and ignores version bumps", () => {
      const listener = vi.fn();
      const unsubscribe = registry.subscribe(listener);

      const provA = {
        serverUrl: "http://127.0.0.1:4803",
        configuredRoot: "/srv/my-project",
        actor: "basic:alice:tok-1",
      };

      const m1 = registry.registerModel({
        tabKey: "tab-prov",
        profileId: "profile-1",
        project: "my-project",
        targetKey: "root",
        relativePath: "src/index.ts",
        provenance: provA,
      });
      expect(m1.identity.provenance).toEqual(provA);
      expect(listener).toHaveBeenCalledTimes(1);

      // Idempotent re-registration with matching provenance does not notify or bump incarnation
      const mSame = registry.registerModel({
        tabKey: "tab-prov",
        profileId: "profile-1",
        project: "my-project",
        targetKey: "root",
        relativePath: "src/index.ts",
        provenance: provA,
      });
      expect(mSame.identity.incarnation).toBe(1);
      expect(listener).toHaveBeenCalledTimes(1);

      // bindWire notifies
      registry.bindWire("tab-prov", {
        targetId: "target-1",
        connectionGeneration: 1,
        targetGeneration: 1,
        sessionGeneration: 2,
        languageDescriptor: "typescript",
      });
      expect(listener).toHaveBeenCalledTimes(2);

      // bumpWireVersion does NOT notify listeners
      registry.bumpWireVersion("tab-prov");
      expect(listener).toHaveBeenCalledTimes(2);

      // clearWireBindings with non-matching sessionGeneration does not unbind
      registry.clearWireBindings("target-1", 1);
      expect(registry.getByTabKey("tab-prov")?.wireBinding).not.toBeNull();
      expect(listener).toHaveBeenCalledTimes(2);

      // clearWireBindings with matching sessionGeneration unbinds and notifies
      registry.clearWireBindings("target-1", 2);
      expect(registry.getByTabKey("tab-prov")?.wireBinding).toBeNull();
      expect(listener).toHaveBeenCalledTimes(3);

      unsubscribe();
      registry.unregisterModel("tab-prov");
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("enforces fail-closed provenance matching and deterministic UTF-8 SHA-256 digests", async () => {
      const baseProv = {
        serverUrl: "http://127.0.0.1:4803",
        configuredRoot: "/srv/repo-a",
        actor: "basic:alice:tok-a",
      };
      expect(matchesSemanticProvenance(baseProv, null)).toBe(false);
      expect(matchesSemanticProvenance(null, baseProv)).toBe(false);
      expect(
        matchesSemanticProvenance(baseProv, {
          ...baseProv,
          serverUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
        }),
      ).toBe(true);
      expect(
        matchesSemanticProvenance(baseProv, {
          ...baseProv,
          serverUrl: "http://127.0.0.1:4809",
        }),
      ).toBe(false);
      expect(
        matchesSemanticProvenance(baseProv, {
          ...baseProv,
          configuredRoot: "/srv/repo-b",
        }),
      ).toBe(false);
      expect(
        matchesSemanticProvenance(baseProv, {
          ...baseProv,
          actor: "basic:bob:tok-b",
        }),
      ).toBe(false);

      expect(computeUtf8Sha256HexSync("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(await computeUtf8Sha256Hex("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    });
  });
});
