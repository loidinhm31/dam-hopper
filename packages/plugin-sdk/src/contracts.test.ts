import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PluginError,
  PluginErrorCode,
  encodeFrame,
  FrameDecoder,
  validateJsonRpcMessage,
  validateManifest,
  validateBridgeMessage,
  WorkerCancellationTracker,
  RESOURCE_BUDGETS,
  RUNNER_PROTOCOL_VERSION,
  WORKER_SDK_VERSION,
  UI_BRIDGE_VERSION,
  MAX_FRAME_PAYLOAD_BYTES,
} from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');

function readFixture(relPath: string): string {
  return readFileSync(join(FIXTURES_DIR, relPath), 'utf-8');
}

describe('Plugin Manifest Contract', () => {
  it('validates a conformant manifest fixture', () => {
    const raw = readFixture('positive/manifest-valid.json');
    const manifest = validateManifest(JSON.parse(raw));
    expect(manifest.id).toBe('evcrate.advisor');
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.contracts.manifest).toBe(1);
    expect(manifest.entrypoints.backend.runtime).toBe('node');
    expect(manifest.entrypoints.ui?.mode).toBe('opaque-srcdoc');
    expect(manifest.capabilities).toContain('history.refresh');
  });

  it('fails closed when manifest contains unknown fields', () => {
    const raw = readFixture('negative/manifest-unknown-field.json');
    expect(() => validateManifest(JSON.parse(raw))).toThrowError(/Unknown manifest property/);
  });

  it('rejects an invalid plugin id format', () => {
    const raw = readFixture('negative/manifest-invalid-id.json');
    expect(() => validateManifest(JSON.parse(raw))).toThrowError(/Invalid plugin id/);
  });

  it('rejects a non-semver version string', () => {
    const raw = readFixture('negative/manifest-bad-version.json');
    expect(() => validateManifest(JSON.parse(raw))).toThrowError(/Invalid plugin semver version/);
  });
});

describe('JSON-RPC and Framing Protocol', () => {
  it('encodes and decodes a single frame', () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'runner.hello' });
    const encoded = encodeFrame(payload);
    const decoder = new FrameDecoder();
    const frames = decoder.push(encoded);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(payload);
  });

  it('handles fragmented delivery across chunks', () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 'req-frag', method: 'plugin.list' });
    const encoded = encodeFrame(payload);
    const decoder = new FrameDecoder();

    // Split encoded into 3 partial chunks
    const chunk1 = encoded.subarray(0, 3);
    const chunk2 = encoded.subarray(3, 10);
    const chunk3 = encoded.subarray(10);

    expect(decoder.push(chunk1)).toHaveLength(0);
    expect(decoder.push(chunk2)).toHaveLength(0);
    const frames = decoder.push(chunk3);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBe(payload);
  });

  it('handles coalesced frames in a single chunk', () => {
    const msg1 = JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'm1' });
    const msg2 = JSON.stringify({ jsonrpc: '2.0', id: '2', method: 'm2' });
    const enc1 = encodeFrame(msg1);
    const enc2 = encodeFrame(msg2);

    const merged = new Uint8Array(enc1.length + enc2.length);
    merged.set(enc1, 0);
    merged.set(enc2, enc1.length);

    const decoder = new FrameDecoder();
    const frames = decoder.push(merged);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toBe(msg1);
    expect(frames[1]).toBe(msg2);
  });

  it('rejects an oversized frame header before body allocation', () => {
    const headerOnly = new Uint8Array(4);
    new DataView(headerOnly.buffer).setUint32(0, MAX_FRAME_PAYLOAD_BYTES + 1, false);

    const decoder = new FrameDecoder();
    expect(() => decoder.push(headerOnly)).toThrowError(/Oversized frame header/);
  });

  it('rejects invalid UTF-8 in frame body', () => {
    const badBytes = new Uint8Array([0xff, 0xff, 0xff]);
    const frame = new Uint8Array(4 + badBytes.length);
    new DataView(frame.buffer).setUint32(0, badBytes.length, false);
    frame.set(badBytes, 4);

    const decoder = new FrameDecoder();
    expect(() => decoder.push(frame)).toThrowError(/invalid UTF-8/);
  });

  it('validates a standard JSON-RPC request fixture', () => {
    const raw = readFixture('positive/jsonrpc-request-valid.json');
    const msg = validateJsonRpcMessage(raw);
    expect(msg.jsonrpc).toBe('2.0');
    if ('method' in msg && 'id' in msg) {
      expect(msg.method).toBe('context.open');
      expect(msg.id).toBe('req-001');
    } else {
      expect.fail('Expected request with method and id');
    }
  });

  it('validates a standard JSON-RPC response fixture', () => {
    const raw = readFixture('positive/jsonrpc-response-valid.json');
    const msg = validateJsonRpcMessage(raw);
    expect(msg.jsonrpc).toBe('2.0');
    if ('result' in msg) {
      expect(msg.id).toBe('req-001');
      expect((msg.result as Record<string, unknown>).contextId).toBe('ctx-987');
    } else {
      expect.fail('Expected response with result');
    }
  });
  it('rejects response with both result and error', () => {
    const raw = JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-bad',
      result: { ok: true },
      error: { code: 'ERR', message: 'fail' },
    });
    expect(() => validateJsonRpcMessage(raw)).toThrowError(/cannot include both result and error/);
  });

  it('rejects batch arrays', () => {
    const raw = readFixture('negative/jsonrpc-batch-rejected.json');
    expect(() => validateJsonRpcMessage(raw)).toThrowError(/batch payloads are rejected/);
  });

  it('rejects numeric id in request', () => {
    const raw = readFixture('negative/jsonrpc-numeric-id.json');
    expect(() => validateJsonRpcMessage(raw)).toThrowError(/id must be a string/);
  });
});

describe('UI Bridge Envelopes', () => {
  it('validates a valid UI bridge request fixture', () => {
    const raw = readFixture('positive/ui-bridge-request-valid.json');
    const envelope = validateBridgeMessage(JSON.parse(raw));
    expect(envelope.type).toBe('request');
    expect(envelope.frameSession).toBe('frame-session-123');
    expect(envelope.bridgeVersion).toBe('1.0.0');
    expect(envelope.activationGeneration).toBe(1);
    if (envelope.type === 'request') {
      expect(envelope.requestId).toBe('ui-req-001');
      expect(envelope.operation).toBe('history.summary');
    }
  });

  it('rejects unknown envelope types', () => {
    expect(() =>
      validateBridgeMessage({
        type: 'malicious.eval',
        bridgeVersion: '1.0.0',
        frameSession: 's-1',
        activationGeneration: 1,
      })
    ).toThrowError(/Unknown bridge envelope type/);
  });
});

describe('Worker Cancellation State Machine', () => {
  it('tracks active operations and delivers cooperative cancellation', () => {
    const tracker = new WorkerCancellationTracker();
    const token = tracker.register('req-1', 'ctx-1');

    expect(token.isCancelled).toBe(false);
    let notified = false;
    token.onCancelled(() => {
      notified = true;
    });

    const outcome1 = tracker.cancel('req-1', 'ctx-1');
    expect(outcome1).toBe('accepted');
    expect(token.isCancelled).toBe(true);
    expect(notified).toBe(true);
    expect(() => token.throwIfCancelled()).toThrowError(/was cancelled/);

    const outcome2 = tracker.cancel('req-1', 'ctx-1');
    expect(outcome2).toBe('alreadySettled');

    const outcomeUnknown = tracker.cancel('unknown-id', 'ctx-1');
    expect(outcomeUnknown).toBe('unknown');

    tracker.settle('req-1');
    const outcomeAfterSettle = tracker.cancel('req-1', 'ctx-1');
    expect(outcomeAfterSettle).toBe('alreadySettled');
    expect(tracker.activeCount).toBe(0);
  });
});
describe('Resource Budgets and Version Constants', () => {
  it('maintains expected version constants', () => {
    expect(RUNNER_PROTOCOL_VERSION).toBe('1.0.0');
    expect(WORKER_SDK_VERSION).toBe('1.0.0');
    expect(UI_BRIDGE_VERSION).toBe('1.0.0');
  });

  it('freezes the agreed numeric budgets table', () => {
    expect(RESOURCE_BUDGETS.maxPayloadBytes).toBe(16 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.maxControlBytes).toBe(64 * 1024);
    expect(RESOURCE_BUDGETS.maxPackageCompressedBytes).toBe(32 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.maxPackageExpandedBytes).toBe(64 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.maxPackageEntries).toBe(2048);
    expect(RESOURCE_BUDGETS.maxUiDocumentBytes).toBe(5 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.maxContextsPerWorker).toBe(16);
    expect(RESOURCE_BUDGETS.maxSnapshotsPerContext).toBe(2);
    expect(RESOURCE_BUDGETS.maxAggregateSnapshotBytes).toBe(128 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.scanDeadlineMs).toBe(30000);
    expect(RESOURCE_BUDGETS.workerCgroupMemoryMaxBytes).toBe(1024 * 1024 * 1024);
    expect(RESOURCE_BUDGETS.workerCgroupTasksMax).toBe(64);
  });
});
