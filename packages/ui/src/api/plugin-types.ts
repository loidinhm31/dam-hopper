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
  ownerHistorySource?: {
    rootPath: string;
    rootIdentity: string;
    sourceRevision: number;
    allAuthenticatedHistoryRead: boolean;
  };
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

export interface GrantKey {
  actorSubject: string;
  installationId: string;
  configuredProjectTarget: string;
  allowedOperations: string[];
  allowCurrentAccountPolicy: boolean;
}

export interface StageReviewDto {
  stageId: string;
  transactionId: string;
  pluginId: string;
  version: string;
  publisher: string;
  hostVersionRange: string;
  contracts: {
    runnerProtocol: string;
    advisorDomain?: string;
  };
  capabilities: string[];
  entrypoints: {
    backend: { entry: string };
    ui?: { entry: string; mode: string };
  };
  totalEntries: number;
  uncompressedBytes: number;
  archiveSha256: string;
  securityRevision: number;
  stageExpiresAt: string;
}

export interface RollbackPackageSnapshotDto {
  packageDigest: string;
  version: string;
  bindings: Record<string, string>;
  publishedAt: string;
}

export interface AdminInstallationDto {
  installationId: string;
  pluginId: string;
  activePackageDigest: string;
  activeVersion: string;
  activationGeneration: number;
  enabled: boolean;
  bindings: Record<string, string>;
  grants: GrantKey[];
  hasUi: boolean;
  workerStatus: string;
  previousPackage?: RollbackPackageSnapshotDto;
  canRollback: boolean;
  securityRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminInstallationListResult {
  installations: AdminInstallationDto[];
  securityRevision: number;
}

export interface ApproveStageRequest {
  expectedSha256: string;
  expectedSecurityRevision: number;
  initialBindings?: Record<string, string>;
  initialGrants?: GrantKey[];
}

export interface LifecycleActionRequest {
  expectedSecurityRevision: number;
}

export interface ReplaceGrantsRequest {
  expectedSecurityRevision: number;
  grants: GrantKey[];
}

export interface ReplaceBindingsRequest {
  expectedSecurityRevision: number;
  bindings: Record<string, string>;
}

export interface AdminRemoveResult {
  installationId: string;
  removed: boolean;
  cleanedPackages: string[];
}

export interface PluginLifecycleRevisionEvent {
  kind: "plugin:lifecycle_revision";
  installationId: string;
  activationGeneration: number;
  securityRevision: number;
  enabled: boolean;
}
