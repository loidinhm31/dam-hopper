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
  projectSemanticText,
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

  describe("F7 representation matrix and coordinate/commutation proofs", () => {
    it("projectSemanticText normalizes EOL forms to LF and preserves literal U+FEFF", () => {
      // Identity check
      const pureLf = "const a = 1;\nconst b = 2;\n";
      expect(projectSemanticText(pureLf)).toBe(pureLf);

      // CRLF
      expect(projectSemanticText("const a = 1;\r\nconst b = 2;\r\n")).toBe(
        "const a = 1;\nconst b = 2;\n",
      );

      // Lone CR
      expect(projectSemanticText("const a = 1;\rconst b = 2;\r")).toBe(
        "const a = 1;\nconst b = 2;\n",
      );

      // Mixed EOL
      expect(projectSemanticText("line1\r\nline2\nline3\rline4")).toBe(
        "line1\nline2\nline3\nline4",
      );

      // Literal editor U+FEFF is preserved
      const literalBOM = "\uFEFFconst target = 'data';\r\n";
      expect(projectSemanticText(literalBOM)).toBe(
        "\uFEFFconst target = 'data';\n",
      );

      // Empty and whitespace
      expect(projectSemanticText("")).toBe("");
      expect(projectSemanticText("\r\n")).toBe("\n");
      expect(projectSemanticText("\n")).toBe("\n");
    });

    it("proves composed disk decoding and double-stripping STOP/GO outcome", () => {
      const textDecoder = new TextDecoder();

      // 0 BOM
      const bytes0 = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
      const decoded0 = textDecoder.decode(bytes0);
      expect(decoded0).toBe("abc");
      expect(decoded0.charCodeAt(0)).toBe(0x61);

      // 1 BOM
      const bytes1 = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]);
      const decoded1 = textDecoder.decode(bytes1);
      expect(decoded1).toBe("abc"); // TextDecoder strips leading BOM
      expect(decoded1.charCodeAt(0)).toBe(0x61);

      // 2 BOM
      const bytes2 = new Uint8Array([
        0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63,
      ]);
      const decoded2 = textDecoder.decode(bytes2);
      // TextDecoder strips first BOM, leaving one literal U+FEFF
      expect(decoded2.charCodeAt(0)).toBe(0xfeff);
      expect(decoded2.slice(1)).toBe("abc");

      // Monaco PieceTreeTextBufferBuilder simulation (matching pinned monaco 0.55.1 source):
      // If chunk starts with UTF8_BOM_CHARACTER, chunk = chunk.substr(1)
      function simulateMonacoMaterialization(chunk: string): string {
        if (chunk.charCodeAt(0) === 0xfeff) {
          return chunk.slice(1);
        }
        return chunk;
      }
      const materialized2 = simulateMonacoMaterialization(decoded2);
      expect(materialized2).toBe("abc"); // Pinned Monaco double-strips 2-BOM disk files
    });

    it("proves edit commutation across fixture matrix: P(applyModelChanges(M, Δ)) == applyWireChanges(P(M), P(Δ))", () => {
      function applyLspEdit(
        text: string,
        change: {
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
          text: string;
        },
      ): string {
        const lines = text.split("\n");
        let startOffset = 0;
        for (let l = 0; l < change.range.start.line; l++) {
          startOffset += lines[l].length + 1; // +1 for \n
        }
        startOffset += change.range.start.character;

        let endOffset = 0;
        for (let l = 0; l < change.range.end.line; l++) {
          endOffset += lines[l].length + 1;
        }
        endOffset += change.range.end.character;

        return text.slice(0, startOffset) + change.text + text.slice(endOffset);
      }
      function applyModelEdit(
        text: string,
        range: { start: { line: number; character: number }; end: { line: number; character: number } },
        replacement: string,
      ): string {
        const lines: string[] = [];
        const eols: string[] = [];
        let cur = 0;
        while (cur <= text.length) {
          const nl = text.indexOf("\n", cur);
          const cr = text.indexOf("\r", cur);
          if (nl === -1 && cr === -1) {
            lines.push(text.slice(cur));
            eols.push("");
            break;
          }
          let eolPos = -1;
          let eolStr = "";
          if (nl !== -1 && (cr === -1 || nl < cr)) {
            eolPos = nl;
            eolStr = "\n";
          } else if (cr !== -1) {
            if (cr + 1 < text.length && text[cr + 1] === "\n") {
              eolPos = cr;
              eolStr = "\r\n";
            } else {
              eolPos = cr;
              eolStr = "\r";
            }
          }
          lines.push(text.slice(cur, eolPos));
          eols.push(eolStr);
          cur = eolPos + eolStr.length;
        }

        let startOffset = 0;
        for (let l = 0; l < range.start.line; l++) {
          startOffset += lines[l].length + eols[l].length;
        }
        startOffset += range.start.character;

        let endOffset = 0;
        for (let l = 0; l < range.end.line; l++) {
          endOffset += lines[l].length + eols[l].length;
        }
        endOffset += range.end.character;

        return text.slice(0, startOffset) + replacement + text.slice(endOffset);
      }

      // Matrix of fixtures: CRLF, lone CR, mixed EOL, literal BOM, astral Unicode, multi-line
      const fixtures = [
        {
          name: "CRLF basic",
          initial: "const a = 1;\r\nconst b = 2;\r\n",
          edit: {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 7 },
            },
            text: "alpha",
          },
        },
        {
          name: "Lone CR basic",
          initial: "const a = 1;\rconst b = 2;\r",
          edit: {
            range: {
              start: { line: 1, character: 6 },
              end: { line: 1, character: 7 },
            },
            text: "beta",
          },
        },
        {
          name: "Mixed EOL",
          initial: "line1\r\nline2\nline3\rline4",
          edit: {
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 5 },
            },
            text: "MODIFIED",
          },
        },
        {
          name: "Astral Unicode on later line",
          initial: "first line;\r\nconst icon = '😀';\r\nconst label = 'smile';\r\n",
          edit: {
            range: {
              start: { line: 1, character: 14 },
              end: { line: 1, character: 17 },
            },
            text: "'✨';",
          },
        },
        {
          name: "Multi-line edit across CRLF",
          initial: "line 1\r\nline 2\r\nline 3\r\n",
          edit: {
            range: {
              start: { line: 0, character: 5 },
              end: { line: 2, character: 4 },
            },
            text: "REPLACED\r\nNEW",
          },
        },
        {
          name: "Literal U+FEFF prefix",
          initial: "\uFEFFconst target = 100;\r\n",
          edit: {
            range: {
              start: { line: 0, character: 14 },
              end: { line: 0, character: 17 },
            },
            text: "200",
          },
        },
        {
          name: "CR/LF adjacency insertion",
          initial: "line 1\r\nline 2\r\n",
          edit: {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 6 },
            },
            text: "; // adjacent",
          },
        },
        {
          name: "EOL delimiter change across lines",
          initial: "line 1\r\nline 2\r\n",
          edit: {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 1, character: 0 },
            },
            text: "\n",
          },
        },
        {
          name: "Undo/redo commutation cycle",
          initial: "const original = true;\r\n",
          edit: {
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 14 },
            },
            text: "modified",
          },
        },
      ];

      for (const fixture of fixtures) {
        const modelApplied = applyModelEdit(fixture.initial, fixture.edit.range, fixture.edit.text);
        const projectedModel = projectSemanticText(modelApplied);

        const projectedInitial = projectSemanticText(fixture.initial);
        const projectedChange = {
          range: fixture.edit.range,
          text: projectSemanticText(fixture.edit.text),
        };
        const wireApplied = applyLspEdit(projectedInitial, projectedChange);

        // Prove exact model-vs-wire commutation equality:
        expect(wireApplied).toBe(projectedModel);
      }
    });
  });
});
