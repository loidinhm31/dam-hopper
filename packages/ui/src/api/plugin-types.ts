/**
 * @file plugin-types.ts
 * Type definitions for DamHopper trusted plugin platform client API.
 */

import type { ServerProjectTarget } from "./ownership.js";

export type CancelOutcome = "accepted" | "alreadySettled" | "unknown";

export interface PluginMetadataItem {
  id: string;
  version: string;
  publisher: string;
  capabilities: string[];
  hasUi: boolean;
  activeGeneration: number;
  enabled: boolean;
}

export interface ListPluginsResponse {
  plugins: PluginMetadataItem[];
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

export interface PluginEpochEvent {
  kind: "plugin:epoch";
  reqId?: number;
  epoch: number;
  actor: string;
  expiresAt?: number;
}

export interface PluginRevokedEvent {
  kind: "plugin:revoked";
  contextId: string;
  reason: string;
}
