/**
 * @file plugin-types.ts
 * Type definitions for DamHopper trusted plugin platform client API.
 */

import type { ServerProjectTarget } from "./ownership.js";

export type CancelOutcome = "accepted" | "alreadySettled" | "unknown";

export interface PluginMetadataItem {
  /** Server-authoritative installation ID used by routes and API calls. */
  id: string;
  version: string;
  publisher: string;
  capabilities: string[];
  hasUi: boolean;
  activeDigest: string;
  activeGeneration: number;
  enabled: boolean;
}

export interface ListPluginsResponse {
  plugins: PluginMetadataItem[];
}

export interface PluginUiAssetRequest {
  installationId: string;
  activeDigest: string;
  activationGeneration: number;
  target: ServerProjectTarget;
}

export interface PluginUiAsset {
  bytes: Uint8Array;
  contentType: "application/octet-stream";
  sha256: string;
}

export interface OpenContextRequest {
  epoch: number;
  installationId: string;
  target: ServerProjectTarget;
  allowedOperations?: string[];
  allowCurrentAccountPolicy?: boolean;
}

export interface ContextOpenResult {
  contextId: string;
  bindingRevision: number;
  grantRevision: number;
  activationGeneration: number;
  expiresAt: number;
}

export interface CloseContextRequest {
  epoch: number;
  contextId: string;
}

export interface ContextCloseResult {
  closed: boolean;
}

export interface InvokeRequest {
  epoch: number;
  contextId: string;
  requestId: string;
  operation: string;
  payload: unknown;
  deadlineMs?: number;
}

export interface InvokeResponse<T = unknown> {
  result: T;
}

export interface CancelRequest {
  epoch: number;
  contextId: string;
  requestId: string;
}

export interface RequestCancelResult {
  outcome: CancelOutcome;
}

export interface PluginEpoch {
  epoch: number;
  actor: string;
  expiresAt?: number;
}

export interface PluginEpochEvent extends PluginEpoch {
  kind: "plugin:epoch";
  reqId?: number;
}

export interface PluginRevokedEvent {
  kind: "plugin:revoked";
  contextId: string;
  reason: string;
}
