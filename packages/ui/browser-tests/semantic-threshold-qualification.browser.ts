import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import "@/lib/monaco-setup.js";
import * as monaco from "monaco-editor";
import { SemanticMonacoManager } from "@/lib/semantic-monaco.js";
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import { createApiClient } from "@/api/client.js";
import {
  __setConnectionSnapshotForTests,
  registerConnectionRegistryQueryClient,
  resetConnections,
} from "@/api/connections.js";
import { profileQueryKey } from "@/api/query-client.js";
import { SemanticClient } from "@/api/semantic-client.js";
import {
  clearAuthToken,
  saveProfiles,
  setAuthToken,
  type ServerProfile,
} from "@/api/server-config.js";
import { WsTransport } from "@/api/ws-transport.js";
import {
  captureSemanticProvenance,
  defaultSemanticModelRegistry,
  buildLocalModelUri,
} from "@/lib/semantic-model-uri.js";
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";

const rawBootstrapUrl =
  typeof import.meta.env.VITE_DAM_HOPPER_SERVER_URL === "string"
    ? import.meta.env.VITE_DAM_HOPPER_SERVER_URL
    : "";
const isLiveQualificationRun = rawBootstrapUrl.includes("/qual-bootstrap/");

const HEADER_LINES = [
  "// Seed: 24301 (9ca0d861) | Tier: small | File: 0/8",
  "const computeNode_0_seed = 24301;",
  "export interface SemanticContract_0 {",
  "  executeNode(input: number): number;",
  "}",
  "export class PrimaryNode_0 implements SemanticContract_0 {",
  "  executeNode(input: number): number {",
  "    return input + 0 + computeNode_0_seed;",
  "  }",
  "}",
  "export class SecondaryNode_0 implements SemanticContract_0 {",
  "  executeNode(input: number): number {",
  "    return input * 2 + 0;",
  "  }",
  "}",
  "export function computeNode_0(val: number): number {",
  "  const inst: SemanticContract_0 = new PrimaryNode_0();",
  "  return inst.executeNode(val);",
  "}",
];

const textEncoder = new TextEncoder();

function delayMs(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function nearestRankPercentileOrNull(
  samples: number[],
  percentile: number,
): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)] ?? null;
}

function summarizeSeries(samples: number[]) {
  if (samples.length === 0) {
    return { sampleCount: 0, min: null, p50: null, p95: null, max: null };
  }
  return {
    sampleCount: samples.length,
    min: Math.min(...samples),
    p50: nearestRankPercentileOrNull(samples, 0.5),
    p95: nearestRankPercentileOrNull(samples, 0.95),
    max: Math.max(...samples),
  };
}

interface BuiltStepDocument {
  text: string;
  utf8Bytes: number;
  utf16Units: number;
  line19: string;
  line20WithoutNewline: string;
  expectedSymbolDefCol: number;
  refQueryCol: number;
}

function buildStepDocument(
  targetUtf8Bytes: number,
  stepIndex: number,
  multibyte: boolean,
): BuiltStepDocument {
  const commentBody = multibyte
    ? `🚀🌌 Café Cafe\u0301 漢語 step_${stepIndex}`
    : `ascii_marker_step_${stepIndex}`;
  const prefix = `/* ${commentBody} */ export const `;
  const beforeRef = `${prefix}unicodeSymbol_0 = ${100 + stepIndex}; export const unicodeRef_0 = `;
  const line19 = `${beforeRef}unicodeSymbol_0;`;
  const line20Prefix = `export const thresholdPad_0 = "`;
  const line20Suffix = `";`;

  const shellText = `${HEADER_LINES.join("\n")}\n${line19}\n${line20Prefix}${line20Suffix}\n`;
  const shellBytes = textEncoder.encode(shellText).byteLength;
  const neededBytes = targetUtf8Bytes - shellBytes;
  if (neededBytes < 0) {
    throw new Error(`Target bytes ${targetUtf8Bytes} smaller than shell ${shellBytes}`);
  }

  let pad = "";
  if (multibyte) {
    // "🚀漢éA" is 4 + 3 + 2 + 1 = 10 UTF-8 bytes and 5 UTF-16 code units
    const unit = "🚀漢éA";
    pad = unit.repeat(Math.floor(neededBytes / 10)) + "x".repeat(neededBytes % 10);
  } else {
    pad = "x".repeat(neededBytes);
  }

  const line20WithoutNewline = `${line20Prefix}${pad}${line20Suffix}`;
  const text = `${HEADER_LINES.join("\n")}\n${line19}\n${line20WithoutNewline}\n`;
  const utf8Bytes = textEncoder.encode(text).byteLength;
  if (utf8Bytes !== targetUtf8Bytes) {
    throw new Error(`Constructed doc UTF-8 size ${utf8Bytes} !== ${targetUtf8Bytes}`);
  }

  return {
    text,
    utf8Bytes,
    utf16Units: text.length,
    line19,
    line20WithoutNewline,
    expectedSymbolDefCol: prefix.length,
    refQueryCol: beforeRef.length + 2,
  };
}

interface QualificationBootstrap {
  serverUrl: string;
  wsUrl: string;
  token: string;
  project: string;
  configuredRoot: string;
  expectedThresholdBytes: number;
  candidateThresholdBytes: number[];
}

interface ObservedStepRecord {
  stepIndex: number;
  thresholdGroup: number;
  label: string;
  crossingKind: string;
  multibyte: boolean;
  postEditUtf8Bytes: number;
  postEditUtf16Units: number;
  expectedSyncMode: "full" | "incremental";
  observedSyncMode: "full" | "incremental";
  wireFrameBytes: number;
  contentChangesBytes: number;
  serializationMs: number;
  didChangeSyncMs: number;
  navigationMs: number;
  documentVersion: number;
  verifiedLine19Utf16Col: number;
}

describe.runIf(isLiveQualificationRun)(
  "SemanticClient real-WS adaptive threshold qualification",
  () => {
    it(
      "measures full/incremental payload bytes, serialization, sync, and navigation across the fixed union of 32/64/128 KiB thresholds",
      async () => {
        const originalFetch = window.fetch.bind(window);
        const bootstrapResp = await originalFetch(rawBootstrapUrl);
        expect(bootstrapResp.ok).toBe(true);
        const bootstrap: QualificationBootstrap = await bootstrapResp.json();

        const profileId = "11111111-1111-4111-8111-111111111111";
        const owner = { profileId, generation: 1 };
        const originalWsSend = WebSocket.prototype.send;
        const originalJsonStringify = JSON.stringify;

        let lastStringifyDurationMs = 0;
        const observedDidChanges: Array<{
          version: number;
          syncModeObserved: "full" | "incremental";
          wireFrameBytes: number;
          contentChangesBytes: number;
          serializationMs: number;
        }> = [];

        const report: Record<string, unknown> = {
          status: "PARTIAL_FAILED",
          expectedThresholdBytes: bootstrap.expectedThresholdBytes,
          negotiatedThresholdBytes: null,
          candidateThresholdsTested: bootstrap.candidateThresholdBytes,
          fixedUnionStepCount: 0,
          fixedUnionSteps: [],
          thresholdCrossings: {},
          bySyncMode: null,
          overallDistributions: null,
          staleReveals: null,
          error: null,
        };

        let unregisterQc: (() => void) | null = null;
        let client: SemanticClient | null = null;

        try {
          resetConnections();
          defaultSemanticModelRegistry.clearAll();
          useSemanticNavigationStore.getState().disconnectAll();

          const profile: ServerProfile = {
            id: profileId,
            name: "Qualification Backend",
            url: bootstrap.serverUrl,
            authType: "basic",
            username: "qual-admin",
            createdAt: Date.now(),
            autoConnect: true,
          };
          saveProfiles([profile]);
          expect(setAuthToken(bootstrap.token, profileId)).toBe(true);

          const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: Infinity } },
          });
          unregisterQc = registerConnectionRegistryQueryClient(queryClient);
          queryClient.setQueryData(profileQueryKey(owner, "projects"), [
            { name: bootstrap.project, path: bootstrap.configuredRoot },
          ]);

          const transport = new WsTransport(bootstrap.serverUrl, profileId, bootstrap.token);
          const api = createApiClient(owner, transport);
          __setConnectionSnapshotForTests(profileId, {
            serverUrl: bootstrap.serverUrl,
            owner,
            status: "connected",
            intent: true,
            transport,
            api,
          });

          const provenance = captureSemanticProvenance({
            profileId,
            project: bootstrap.project,
          });
          expect(provenance).not.toBeNull();
          expect(provenance?.configuredRoot).toBe(bootstrap.configuredRoot);

          const instrumentedStringify: typeof JSON.stringify = (
            value: unknown,
            replacer?: unknown,
            space?: unknown,
          ) => {
            const t0 = performance.now();
            const serialized = originalJsonStringify(
              value,
              replacer as Parameters<typeof JSON.stringify>[1],
              space as Parameters<typeof JSON.stringify>[2],
            );
            const elapsed = performance.now() - t0;
            if (
              value &&
              typeof value === "object" &&
              "method" in value &&
              value.method === "textDocument/didChange"
            ) {
              lastStringifyDurationMs = elapsed;
            }
            return serialized;
          };
          JSON.stringify = instrumentedStringify;

          WebSocket.prototype.send = function (
            data: string | ArrayBufferLike | Blob | ArrayBufferView,
          ) {
            if (typeof data === "string") {
              try {
                const parsed: unknown = JSON.parse(data);
                if (
                  parsed &&
                  typeof parsed === "object" &&
                  "method" in parsed &&
                  parsed.method === "textDocument/didChange" &&
                  "params" in parsed &&
                  parsed.params &&
                  typeof parsed.params === "object" &&
                  "contentChanges" in parsed.params &&
                  Array.isArray(parsed.params.contentChanges)
                ) {
                  const changes: unknown[] = parsed.params.contentChanges;
                  const firstChange = changes[0];
                  const hasRange = Boolean(
                    firstChange &&
                      typeof firstChange === "object" &&
                      "range" in firstChange &&
                      firstChange.range,
                  );
                  let docVersion = -1;
                  if (
                    "textDocument" in parsed.params &&
                    parsed.params.textDocument &&
                    typeof parsed.params.textDocument === "object" &&
                    "version" in parsed.params.textDocument &&
                    typeof parsed.params.textDocument.version === "number"
                  ) {
                    docVersion = parsed.params.textDocument.version;
                  }
                  const wireFrameBytes = textEncoder.encode(data).byteLength;
                  const contentChangesBytes = textEncoder.encode(
                    originalJsonStringify(changes),
                  ).byteLength;
                  observedDidChanges.push({
                    version: docVersion,
                    syncModeObserved: hasRange ? "incremental" : "full",
                    wireFrameBytes,
                    contentChangesBytes,
                    serializationMs: lastStringifyDurationMs,
                  });
                }
              } catch {
                // Non-JSON frame ignored
              }
            }
            return originalWsSend.call(this, data);
          };

          const relativePath = "packages/core/module_000.ts";
          const target = { profileId, project: bootstrap.project, worktreePath: null };
          const tabKey = editorFileTabKey(target, relativePath);
          let currentDoc = buildStepDocument(4096, 0, false);

          defaultSemanticModelRegistry.registerModel({
            tabKey,
            profileId,
            project: bootstrap.project,
            targetKey: "root",
            relativePath,
            provenance,
          });

          client = new SemanticClient({
            wsUrl: bootstrap.wsUrl,
            serverUrl: bootstrap.serverUrl,
            token: bootstrap.token,
            profileId,
            project: bootstrap.project,
            worktreePath: null,
            provenance,
            targetKey: "root",
            connectionGeneration: 1,
            targetGeneration: 1,
            registry: defaultSemanticModelRegistry,
            getModelText: (key) => (key === tabKey ? currentDoc.text : undefined),
          });

          await client.connect();
          expect(client.getStatus()).toBe("ready");

          const negotiatedPolicy = client.getNegotiatedPolicy();
          report.negotiatedThresholdBytes = negotiatedPolicy.adaptiveSyncThresholdBytes;
          expect(negotiatedPolicy.adaptiveSyncThresholdBytes).toBe(
            bootstrap.expectedThresholdBytes,
          );

          const unionSpec: Array<{
            thresholdGroup: number;
            label: string;
            targetBytes: number;
            multibyte: boolean;
            crossingKind: string;
          }> = [];

          for (const t of bootstrap.candidateThresholdBytes) {
            unionSpec.push(
              { thresholdGroup: t, label: `${t}_below_ascii`, targetBytes: t - 1, multibyte: false, crossingKind: "below" },
              { thresholdGroup: t, label: `${t}_below_multibyte`, targetBytes: t - 1, multibyte: true, crossingKind: "below" },
              { thresholdGroup: t, label: `${t}_cross_up_to_equal`, targetBytes: t, multibyte: true, crossingKind: "upward_to_equal" },
              { thresholdGroup: t, label: `${t}_cross_up_to_above`, targetBytes: t + 1, multibyte: true, crossingKind: "upward_to_above" },
              { thresholdGroup: t, label: `${t}_above_multibyte`, targetBytes: t + 64, multibyte: true, crossingKind: "sustained_above" },
              { thresholdGroup: t, label: `${t}_cross_down_to_equal`, targetBytes: t, multibyte: true, crossingKind: "downward_to_equal" },
              { thresholdGroup: t, label: `${t}_cross_down_to_below`, targetBytes: t - 1, multibyte: false, crossingKind: "downward_to_below" },
            );
          }

          const stepRecords: ObservedStepRecord[] = [];
          const fullWireBytes: number[] = [];
          const incrWireBytes: number[] = [];
          const fullSerializationMs: number[] = [];
          const incrSerializationMs: number[] = [];
          const fullSyncMs: number[] = [];
          const incrSyncMs: number[] = [];
          const fullNavMs: number[] = [];
          const incrNavMs: number[] = [];
          const allSerializationMs: number[] = [];
          const allSyncMs: number[] = [];
          const allNavMs: number[] = [];

          for (let i = 0; i < unionSpec.length; i++) {
            const spec = unionSpec[i]!;
            const nextDoc = buildStepDocument(spec.targetBytes, i + 1, spec.multibyte);
            const incrementalChanges = [
              {
                range: {
                  start: { line: 19, character: 0 },
                  end: { line: 20, character: currentDoc.line20WithoutNewline.length },
                },
                rangeLength:
                  currentDoc.line19.length + 1 + currentDoc.line20WithoutNewline.length,
                text: `${nextDoc.line19}\n${nextDoc.line20WithoutNewline}`,
              },
            ];

            currentDoc = nextDoc;
            const tSync0 = performance.now();
            const newVersion = await client.notifyDidChange(
              tabKey,
              nextDoc.text,
              incrementalChanges,
            );
            const didChangeSyncMs = performance.now() - tSync0;
            expect(newVersion).toBeGreaterThan(1);

            const observed = observedDidChanges[observedDidChanges.length - 1];
            expect(observed).toBeDefined();
            expect(observed?.version).toBe(newVersion);

            const expectedSyncMode =
              spec.targetBytes < bootstrap.expectedThresholdBytes
                ? "full"
                : "incremental";
            expect(observed?.syncModeObserved).toBe(expectedSyncMode);

            const tNav0 = performance.now();
            const line19Def = await client.getDefinition(tabKey, {
              line: 19,
              character: nextDoc.refQueryCol,
            });
            const navElapsedMs = performance.now() - tNav0;

            expect(line19Def.locations.length).toBeGreaterThanOrEqual(1);
            const loc19 = line19Def.locations[0]!;
            expect(loc19.range.start.line).toBe(19);
            expect(loc19.range.start.character).toBe(nextDoc.expectedSymbolDefCol);
            expect(
              await client.validateDestination(loc19, tabKey, nextDoc.text),
            ).toBe(true);

            if (i % 2 === 0) {
              const defRes = await client.getDefinition(tabKey, {
                line: 16,
                character: 40,
              });
              expect(defRes.locations[0]?.range.start).toEqual({
                line: 5,
                character: 13,
              });
            } else {
              const implRes = await client.getImplementation(tabKey, {
                line: 2,
                character: 18,
              });
              const lines = implRes.locations.map((l) => l.range.start.line);
              expect(lines).toContain(5);
              expect(lines).toContain(10);
            }

            const wireBytes = observed!.wireFrameBytes;
            const serMs = observed!.serializationMs;
            allSerializationMs.push(serMs);
            allSyncMs.push(didChangeSyncMs);
            allNavMs.push(navElapsedMs);

            if (observed!.syncModeObserved === "full") {
              fullWireBytes.push(wireBytes);
              fullSerializationMs.push(serMs);
              fullSyncMs.push(didChangeSyncMs);
              fullNavMs.push(navElapsedMs);
            } else {
              incrWireBytes.push(wireBytes);
              incrSerializationMs.push(serMs);
              incrSyncMs.push(didChangeSyncMs);
              incrNavMs.push(navElapsedMs);
            }

            stepRecords.push({
              stepIndex: i + 1,
              thresholdGroup: spec.thresholdGroup,
              label: spec.label,
              crossingKind: spec.crossingKind,
              multibyte: spec.multibyte,
              postEditUtf8Bytes: nextDoc.utf8Bytes,
              postEditUtf16Units: nextDoc.utf16Units,
              expectedSyncMode,
              observedSyncMode: observed!.syncModeObserved,
              wireFrameBytes: wireBytes,
              contentChangesBytes: observed!.contentChangesBytes,
              serializationMs: serMs,
              didChangeSyncMs,
              navigationMs: navElapsedMs,
              documentVersion: newVersion,
              verifiedLine19Utf16Col: nextDoc.expectedSymbolDefCol,
            });
            report.fixedUnionSteps = stepRecords;
            report.fixedUnionStepCount = stepRecords.length;

            await delayMs(10);
          }

          // Exercise the actual Monaco command with a real server answer becoming
          // stale before the provider can publish it. A client result is not a reveal.
          const model = monaco.editor.createModel(currentDoc.text, "typescript",
            monaco.Uri.parse(buildLocalModelUri(tabKey)));
          const container = document.createElement("div");
          Object.assign(container.style, { width: "800px", height: "500px" });
          document.body.appendChild(container);
          useEditorStore.setState({ tabs: [{ key: tabKey, target, project: bootstrap.project,
            targetKey: "root", targetAvailable: true, path: relativePath, content: currentDoc.text,
            savedContent: currentDoc.text, semanticProvenance: provenance, dirty: false } as Tab] });
          const manager = new SemanticMonacoManager({ getClientForModel: () => client });
          const editor = monaco.editor.create(container, { model, occurrencesHighlight: "off",
            inlayHints: { enabled: "off" }, codeLens: false, links: false });
          let staleReveals = 0;
          const actualDefinition = client.getDefinition.bind(client);
          let completed: Promise<unknown> | undefined;
          const register = monaco.languages.registerDefinitionProvider.bind(monaco.languages);
          const registration = vi.spyOn(monaco.languages, "registerDefinitionProvider")
            .mockImplementation((selector, provider) => register(selector, {
              provideDefinition: (...args) => {
                const result = Promise.resolve(provider.provideDefinition(...args));
                completed = result;
                return result;
              },
            }));
          const definition = vi.spyOn(client, "getDefinition");
          try {
            manager.activate();
            editor.focus();
            editor.setPosition({ lineNumber: 17, column: 41 });
            editor.trigger("live-semantic-qualification", "editor.action.revealDefinition", {});
            await vi.waitFor(() => expect(completed).toBeDefined(), { timeout: 15_000 });
            await completed;
            await vi.waitFor(() => expect(editor.getPosition()?.lineNumber).toBe(6), { timeout: 15_000 });
            completed = undefined;
            definition.mockImplementationOnce(async (...args) => {
              const result = await actualDefinition(...args);
              expect(result.locations[0]?.range.start.line).toBe(5);
              model.applyEdits([{ range: new monaco.Range(1, 1, 1, 1), text: "// edited before publication\n" }]);
              return result;
            });
            editor.setPosition({ lineNumber: 17, column: 41 });
            editor.trigger("live-semantic-qualification", "editor.action.revealDefinition", {});
            await vi.waitFor(() => expect(completed).toBeDefined(), { timeout: 15_000 });
            expect(await completed).toBeNull();
            if (editor.getPosition()?.lineNumber === 6 ||
                useSemanticNavigationStore.getState().activeRevealIntent !== null) staleReveals++;
          } finally {
            definition.mockRestore();
            registration.mockRestore();
            manager.deactivate();
            editor.setModel(null);
            editor.dispose();
            model.dispose();
            container.remove();
            useEditorStore.setState({ tabs: [] });
            useSemanticNavigationStore.getState().setRevealIntent(null);
          }

          const thresholdCrossings: Record<string, unknown> = {};
          for (const t of bootstrap.candidateThresholdBytes) {
            const groupSteps = stepRecords.filter((s) => s.thresholdGroup === t);
            thresholdCrossings[String(t)] = {
              belowBytes: t - 1,
              equalBytes: t,
              aboveBytes: t + 1,
              stepCount: groupSteps.length,
              observedModes: groupSteps.map((s) => ({
                label: s.label,
                bytes: s.postEditUtf8Bytes,
                syncMode: s.observedSyncMode,
                wireFrameBytes: s.wireFrameBytes,
              })),
            };
          }

          const totalWirePayloadBytes = stepRecords.reduce(
            (acc, s) => acc + s.wireFrameBytes,
            0,
          );

          report.status = "MEASURED";
          report.thresholdCrossings = thresholdCrossings;
          report.totalWirePayloadBytes = totalWirePayloadBytes;
          report.bySyncMode = {
            full: {
              stepCount: fullWireBytes.length,
              wireFrameBytes: summarizeSeries(fullWireBytes),
              serializationMs: summarizeSeries(fullSerializationMs),
              didChangeSyncMs: summarizeSeries(fullSyncMs),
              navigationMs: summarizeSeries(fullNavMs),
            },
            incremental: {
              stepCount: incrWireBytes.length,
              wireFrameBytes: summarizeSeries(incrWireBytes),
              serializationMs: summarizeSeries(incrSerializationMs),
              didChangeSyncMs: summarizeSeries(incrSyncMs),
              navigationMs: summarizeSeries(incrNavMs),
            },
          };
          report.overallDistributions = {
            serializationMs: summarizeSeries(allSerializationMs),
            didChangeSyncMs: summarizeSeries(allSyncMs),
            navigationMs: summarizeSeries(allNavMs),
          };
          report.staleReveals = staleReveals;
        } catch (err) {
          // Assertion messages may contain source, symbols, URLs, or credentials.
          report.error = err instanceof Error ? err.name : "BrowserQualificationError";
          throw err;
        } finally {
          WebSocket.prototype.send = originalWsSend;
          JSON.stringify = originalJsonStringify;
          try {
            client?.disconnect();
          } catch {
            // ignore
          }
          try {
            unregisterQc?.();
            clearAuthToken(profileId);
            resetConnections();
            defaultSemanticModelRegistry.clearAll();
          } catch {
            // ignore
          }
          try {
            await originalFetch(`${rawBootstrapUrl}/result`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: originalJsonStringify(report),
            });
          } catch {
            // ignore control post error
          }
        }
      },
      120_000,
    );
  },
);
