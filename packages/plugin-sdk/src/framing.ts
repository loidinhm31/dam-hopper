import { PluginError, PluginErrorCode } from './errors.js';

export const FRAME_HEADER_LEN = 4;
export const MAX_FRAME_PAYLOAD_BYTES = 16 * 1024 * 1024; // 16 MiB
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024; // 64 KiB
export const MAX_AGGREGATE_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MiB

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export interface JsonRpcResponseSuccess {
  jsonrpc: '2.0';
  id: string;
  result: unknown;
}

export interface JsonRpcResponseError {
  jsonrpc: '2.0';
  id: string;
  error: {
    code: number | string;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcResponseSuccess | JsonRpcResponseError;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function encodeFrame(payload: string | Uint8Array): Uint8Array {
  const bodyBytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const len = bodyBytes.byteLength;
  if (len > MAX_FRAME_PAYLOAD_BYTES) {
    throw new PluginError(
      PluginErrorCode.OVERLOADED,
      `Frame size ${len} exceeds maximum allowed payload of ${MAX_FRAME_PAYLOAD_BYTES} bytes`
    );
  }
  const out = new Uint8Array(FRAME_HEADER_LEN + len);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, len, false); // big-endian
  out.set(bodyBytes, FRAME_HEADER_LEN);
  return out;
}

export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): string[] {
    if (this.buffer.length + chunk.length > MAX_AGGREGATE_BUFFER_BYTES) {
      throw new PluginError(
        PluginErrorCode.OVERLOADED,
        `Aggregate decoder buffer exceeds limit of ${MAX_AGGREGATE_BUFFER_BYTES} bytes`
      );
    }
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const frames: string[] = [];
    let offset = 0;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);

    while (this.buffer.length - offset >= FRAME_HEADER_LEN) {
      const payloadLen = view.getUint32(offset, false);
      if (payloadLen > MAX_FRAME_PAYLOAD_BYTES) {
        throw new PluginError(
          PluginErrorCode.OVERLOADED,
          `Oversized frame header: ${payloadLen} bytes exceeds ${MAX_FRAME_PAYLOAD_BYTES} ceiling`
        );
      }
      const totalLen = FRAME_HEADER_LEN + payloadLen;
      if (this.buffer.length - offset < totalLen) {
        // Incomplete frame, wait for more data
        break;
      }
      const bodyBytes = this.buffer.subarray(offset + FRAME_HEADER_LEN, offset + totalLen);
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes);
        frames.push(decoded);
      } catch (err) {
        throw new PluginError(
          PluginErrorCode.INVALID_INPUT,
          `Frame contains invalid UTF-8: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      offset += totalLen;
    }

    if (offset > 0) {
      this.buffer = this.buffer.slice(offset);
    }
    return frames;
  }

  get bufferedBytes(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }
}

export function validateJsonRpcMessage(raw: string): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, `Invalid JSON payload: ${String(err)}`);
  }

  if (Array.isArray(parsed)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC batch payloads are rejected');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC message must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Missing or invalid jsonrpc 2.0 version string');
  }

  if ('id' in record) {
    if (typeof record.id !== 'string') {
      throw new PluginError(
        PluginErrorCode.INVALID_INPUT,
        `JSON-RPC id must be a string, received ${typeof record.id}`
      );
    }
    if (record.id.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC id must not be empty');
    }
  }

  if ('method' in record) {
    if (typeof record.method !== 'string' || record.method.trim().length === 0) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC method must be a non-empty string');
    }
    return parsed as JsonRpcRequest | JsonRpcNotification;
  }

  if ('result' in record || 'error' in record) {
    if ('result' in record && 'error' in record) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC response cannot include both result and error');
    }
    if (!('id' in record)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC response must include string id');
    }
    return parsed as JsonRpcResponse;
  }

  throw new PluginError(PluginErrorCode.INVALID_INPUT, 'JSON-RPC message is neither request, response, nor notification');
}
