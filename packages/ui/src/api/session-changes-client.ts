/**
 * Feature-only client for Session Changes.
 * Communicates through captured ApiClient transport using sessionChanges:* channels.
 */

import type { ApiClient } from "./client";
import {
  decodeComparison,
  decodeFileDetail,
  decodeFilePage,
  decodeStatus,
  decodeErrorBody,
  type Comparison,
  type FileDetail,
  type FilePage,
  type Status,
  type ErrorCode,
} from "./session-changes-types";

export interface SessionChangesClientOptions {
  apiClient: ApiClient;
}

export class SessionChangesClientError extends Error {
  public readonly code: ErrorCode | "networkError";
  public readonly retryable: boolean;
  public readonly currentRevision: string | null;

  constructor(
    message: string,
    code: ErrorCode | "networkError",
    retryable: boolean,
    currentRevision: string | null = null,
  ) {
    super(message);
    this.name = "SessionChangesClientError";
    this.code = code;
    this.retryable = retryable;
    this.currentRevision = currentRevision;
  }
}

export class SessionChangesClient {
  private readonly apiClient: ApiClient;

  constructor(options: SessionChangesClientOptions) {
    this.apiClient = options.apiClient;
  }

  private handleError(err: unknown): never {
    if (err && typeof err === "object") {
      const errObj = err as Record<string, unknown>;
      // Check if server returned typed ErrorBody
      if (errObj.response && typeof errObj.response === "object") {
        try {
          const body = decodeErrorBody(errObj.response);
          throw new SessionChangesClientError(
            body.reason,
            body.code,
            body.retryable,
            body.currentRevision,
          );
        } catch (decodeErr) {
          if (decodeErr instanceof SessionChangesClientError) {
            throw decodeErr;
          }
        }
      }
      if (typeof errObj.message === "string") {
        throw new SessionChangesClientError(
          errObj.message,
          "networkError",
          true,
          null,
        );
      }
    }
    throw new SessionChangesClientError(
      String(err ?? "Unknown session changes error"),
      "networkError",
      true,
      null,
    );
  }

  public async getStatus(params: {
    terminalId: string;
    terminalIncarnation: string;
    ompSessionId: string;
    expectedServerEpoch?: string;
    signal?: AbortSignal;
  }): Promise<Status> {
    try {
      const res = await this.apiClient.transport.invoke<unknown>(
        "sessionChanges:status",
        params,
        params.signal ? { signal: params.signal } : undefined,
      );
      return decodeStatus(res);
    } catch (err) {
      this.handleError(err);
    }
  }

  public async startFromNow(params: {
    terminalId: string;
    terminalIncarnation: string;
    ompSessionId: string;
    rootId: string;
    requestId: string;
    expectedServerEpoch?: string;
    signal?: AbortSignal;
  }): Promise<Status> {
    try {
      const res = await this.apiClient.transport.invoke<unknown>(
        "sessionChanges:fromNow",
        params,
        params.signal ? { signal: params.signal } : undefined,
      );
      return decodeStatus(res);
    } catch (err) {
      this.handleError(err);
    }
  }

  public async refreshComparison(params: {
    terminalId: string;
    terminalIncarnation: string;
    ompSessionId: string;
    serverEpoch: string;
    baselineId: string;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<Comparison> {
    try {
      const res = await this.apiClient.transport.invoke<unknown>(
        "sessionChanges:refresh",
        params,
        params.signal ? { signal: params.signal } : undefined,
      );
      return decodeComparison(res);
    } catch (err) {
      this.handleError(err);
    }
  }

  public async getFiles(params: {
    terminalId: string;
    terminalIncarnation: string;
    ompSessionId: string;
    serverEpoch: string;
    baselineId: string;
    comparisonRevision: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<FilePage> {
    try {
      const res = await this.apiClient.transport.invoke<unknown>(
        "sessionChanges:files",
        params,
        params.signal ? { signal: params.signal } : undefined,
      );
      return decodeFilePage(res);
    } catch (err) {
      this.handleError(err);
    }
  }

  public async getFileDetail(params: {
    terminalId: string;
    terminalIncarnation: string;
    ompSessionId: string;
    serverEpoch: string;
    baselineId: string;
    comparisonRevision: string;
    fileId: string;
    signal?: AbortSignal;
  }): Promise<FileDetail> {
    try {
      const res = await this.apiClient.transport.invoke<unknown>(
        "sessionChanges:file",
        params,
        params.signal ? { signal: params.signal } : undefined,
      );
      return decodeFileDetail(res);
    } catch (err) {
      this.handleError(err);
    }
  }
}
