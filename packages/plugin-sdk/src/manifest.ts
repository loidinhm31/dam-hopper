import { PluginError, PluginErrorCode } from './errors.js';

export interface ManifestContractVersions {
  runnerProtocol: string;
  workerSdk: string;
  uiBridge: string;
  manifest: 1;
  dataApi: string;
}

export interface ManifestBackendEntrypoint {
  runtime: 'node';
  range: string;
  entry: string;
}

export interface ManifestUiEntrypoint {
  entry: string;
  mode: 'opaque-srcdoc';
}

export interface ManifestEntrypoints {
  backend: ManifestBackendEntrypoint;
  ui?: ManifestUiEntrypoint;
}

export interface ManifestNavigationItem {
  id: string;
  title: string;
  route: string;
  icon?: string;
}

export interface ManifestInventoryItem {
  path: string;
  size: number;
  sha256: string;
  mode: number;
}

export interface ManifestV1 {
  manifestVersion: 1;
  id: string;
  version: string;
  publisher: string;
  hostVersionRange: string;
  contracts: ManifestContractVersions;
  capabilities: string[];
  entrypoints: ManifestEntrypoints;
  navigation?: ManifestNavigationItem[];
  inventory: ManifestInventoryItem[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_.-]*[a-z0-9]$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function validateManifest(data: unknown): ManifestV1 {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest must be an object');
  }
  const obj = data as Record<string, unknown>;

  // Check for allowed keys only (fail closed on unknown fields)
  const allowedKeys = new Set([
    'manifestVersion',
    'id',
    'version',
    'publisher',
    'hostVersionRange',
    'contracts',
    'capabilities',
    'entrypoints',
    'navigation',
    'inventory',
  ]);

  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, `Unknown manifest property: ${k}`);
    }
  }

  if (obj.manifestVersion !== 1) {
    throw new PluginError(PluginErrorCode.INCOMPATIBLE, `Unsupported manifestVersion: ${String(obj.manifestVersion)}`);
  }

  if (typeof obj.id !== 'string' || !ID_PATTERN.test(obj.id)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, `Invalid plugin id: ${String(obj.id)}`);
  }

  if (typeof obj.version !== 'string' || !SEMVER_PATTERN.test(obj.version)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, `Invalid plugin semver version: ${String(obj.version)}`);
  }

  if (typeof obj.publisher !== 'string' || obj.publisher.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest publisher must be non-empty string');
  }

  if (typeof obj.hostVersionRange !== 'string' || obj.hostVersionRange.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest hostVersionRange must be non-empty string');
  }

  if (typeof obj.contracts !== 'object' || obj.contracts === null || Array.isArray(obj.contracts)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest contracts must be an object');
  }
  const contracts = obj.contracts as Record<string, unknown>;
  const contractKeys = new Set(['runnerProtocol', 'workerSdk', 'uiBridge', 'manifest', 'dataApi']);
  for (const k of Object.keys(contracts)) {
    if (!contractKeys.has(k)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, `Unknown contract key: ${k}`);
    }
  }

  if (typeof contracts.runnerProtocol !== 'string' || contracts.runnerProtocol.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest contracts.runnerProtocol must be string');
  }
  if (typeof contracts.workerSdk !== 'string' || contracts.workerSdk.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest contracts.workerSdk must be string');
  }
  if (typeof contracts.uiBridge !== 'string' || contracts.uiBridge.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest contracts.uiBridge must be string');
  }
  if (contracts.manifest !== 1) {
    throw new PluginError(PluginErrorCode.INCOMPATIBLE, 'Manifest contracts.manifest must be 1');
  }
  if (typeof contracts.dataApi !== 'string' || contracts.dataApi.trim().length === 0) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest contracts.dataApi must be string');
  }

  if (!Array.isArray(obj.capabilities) || obj.capabilities.some((c) => typeof c !== 'string' || c.trim().length === 0)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest capabilities must be array of non-empty strings');
  }

  if (typeof obj.entrypoints !== 'object' || obj.entrypoints === null || Array.isArray(obj.entrypoints)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest entrypoints must be an object');
  }
  const entrypoints = obj.entrypoints as Record<string, unknown>;
  if (
    typeof entrypoints.backend !== 'object' ||
    entrypoints.backend === null ||
    (entrypoints.backend as Record<string, unknown>).runtime !== 'node' ||
    typeof (entrypoints.backend as Record<string, unknown>).range !== 'string' ||
    typeof (entrypoints.backend as Record<string, unknown>).entry !== 'string'
  ) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest entrypoints.backend must be node runtime with range and entry');
  }

  if (entrypoints.ui !== undefined) {
    const ui = entrypoints.ui as Record<string, unknown>;
    if (typeof ui !== 'object' || ui === null || typeof ui.entry !== 'string' || ui.mode !== 'opaque-srcdoc') {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest entrypoints.ui must specify entry and mode "opaque-srcdoc"');
    }
  }

  if (obj.navigation !== undefined) {
    if (!Array.isArray(obj.navigation)) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest navigation must be array if provided');
    }
    for (const nav of obj.navigation) {
      if (
        typeof nav !== 'object' ||
        nav === null ||
        typeof (nav as Record<string, unknown>).id !== 'string' ||
        typeof (nav as Record<string, unknown>).title !== 'string' ||
        typeof (nav as Record<string, unknown>).route !== 'string'
      ) {
        throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Each navigation item must have id, title, and route');
      }
    }
  }

  if (!Array.isArray(obj.inventory)) {
    throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Manifest inventory must be array');
  }
  for (const item of obj.inventory) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).path !== 'string' ||
      typeof (item as Record<string, unknown>).size !== 'number' ||
      typeof (item as Record<string, unknown>).sha256 !== 'string' ||
      !SHA256_PATTERN.test((item as Record<string, unknown>).sha256 as string) ||
      typeof (item as Record<string, unknown>).mode !== 'number'
    ) {
      throw new PluginError(PluginErrorCode.INVALID_INPUT, 'Each inventory item must have path, size, valid sha256, and mode');
    }
  }

  return data as ManifestV1;
}
