/**
 * Native Advisor data provider.
 *
 * Direct ApiClient-backed implementation of AdvisorDataProvider.
 * Maps request IDs to AbortControllers for true REST-level cancellation,
 * rejects late responses, and binds to explicit connection/profile owner.
 */

import { ApiRequestError, type ApiClient, type ConnectionRef } from '@/api/client.js';
import type {
  AdvisorDataProvider,
  ProviderContextDescriptor,
  ProviderEventListener,
  ProviderEvent,
} from './advisor-data-provider.js';
import {
  AdvisorError,
  type HistoryRefreshResultDto,
  type HistorySummaryResultDto,
  type HistorySummaryQueryParams,
  type HistoryPageResultDto,
  type HistoryDetailResultDto,
  type PolicyReadCurrentResultDto,
  type PolicyUpdateParamsDto,
  type AdvisorBackend,
  type AdvisorModelsResultDto,
  type EvaluationsListResultDto,
  type EvaluationsReadResultDto,
  type EvaluationsCompareResultDto,
} from './advisor-types.js';

export interface NativeAdvisorProviderOptions {
  readonly apiClient: ApiClient;
  readonly owner?: ConnectionRef;
  readonly initialDescriptor?: Partial<ProviderContextDescriptor>;
}

const ROUTING_CAPABILITIES: readonly string[] = Object.freeze([
  'policy.readCurrent',
  'policy.update',
  'models.list',
]);

const DEFAULT_CAPABILITIES: readonly string[] = Object.freeze([
  'history.refresh',
  'history.summary',
  'history.page',
  'history.detail',
  'policy.readCurrent',
  'policy.update',
  'models.list',
  'evaluations.list',
  'evaluations.read',
  'evaluations.compare',
]);

export class NativeAdvisorProvider implements AdvisorDataProvider {
  private readonly client: ApiClient;
  private readonly owner: ConnectionRef | null;
  private readonly listeners = new Set<ProviderEventListener>();
  private readonly activeControllers = new Map<string, AbortController>();
  private destroyed = false;
  private currentDescriptor: ProviderContextDescriptor;

  constructor(options: NativeAdvisorProviderOptions) {
    this.client = options.apiClient;
    this.owner = options.owner ?? options.apiClient.owner ?? null;

    this.currentDescriptor = {
      kind: 'native',
      label: options.initialDescriptor?.label ?? 'Dam-Hopper Native Advisor',
      path: options.initialDescriptor?.path ?? null,
      isAvailable: options.initialDescriptor?.isAvailable ?? true,
      capabilities: options.initialDescriptor?.capabilities ?? DEFAULT_CAPABILITIES,
      hasHistorySource: options.initialDescriptor?.hasHistorySource ?? true,
      hasPolicySource: options.initialDescriptor?.hasPolicySource ?? true,
      hasEvaluationSource: options.initialDescriptor?.hasEvaluationSource ?? true,
      sourceError: options.initialDescriptor?.sourceError ?? null,
    };
  }

  get descriptor(): ProviderContextDescriptor {
    return this.currentDescriptor;
  }

  get activeOwner(): ConnectionRef | null {
    return this.owner;
  }

  subscribe(listener: ProviderEventListener): () => void {
    if (this.destroyed) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: ProviderEvent): void {
    if (this.destroyed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Consumer listener errors must not break provider loop
      }
    }
  }

  async probeStatus(): Promise<ProviderContextDescriptor> {
    if (this.destroyed) {
      throw new AdvisorError('Provider destroyed', 'ABORTED');
    }
    try {
      const status = await this.client.advisor.status();

      let capabilities: readonly string[] = [];
      let hasHistorySource = false;
      let hasPolicySource = false;
      let hasEvaluationSource = false;

      if (status.enabled) {
        hasPolicySource = true;
        if (status.available) {
          capabilities = DEFAULT_CAPABILITIES;
          hasHistorySource = true;
          hasEvaluationSource = true;
        } else {
          capabilities = ROUTING_CAPABILITIES;
          hasHistorySource = false;
          hasEvaluationSource = false;
        }
      }

      const updated: ProviderContextDescriptor = {
        kind: 'native',
        label: this.currentDescriptor.label,
        path: status.path,
        isAvailable: status.available,
        capabilities,
        hasHistorySource,
        hasPolicySource,
        hasEvaluationSource,
        sourceError: status.sourceError,
      };

      const availabilityChanged =
        this.currentDescriptor.isAvailable !== updated.isAvailable ||
        this.currentDescriptor.sourceError !== updated.sourceError ||
        this.currentDescriptor.hasPolicySource !== updated.hasPolicySource ||
        this.currentDescriptor.capabilities.length !== updated.capabilities.length;

      this.currentDescriptor = updated;

      if (availabilityChanged) {
        this.notify({
          type: 'availability-changed',
          available: updated.isAvailable,
          capabilities: updated.capabilities,
        });
      }

      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const updated: ProviderContextDescriptor = {
        ...this.currentDescriptor,
        isAvailable: false,
        capabilities: [],
        hasHistorySource: false,
        hasPolicySource: false,
        hasEvaluationSource: false,
        sourceError: msg,
      };
      this.currentDescriptor = updated;
      this.notify({
        type: 'availability-changed',
        available: false,
        capabilities: [],
      });
      return updated;
    }
  }

  private createRequestController(requestId: string): AbortController {
    if (this.destroyed) {
      throw new AdvisorError('Provider destroyed', 'ABORTED');
    }
    const existing = this.activeControllers.get(requestId);
    if (existing) {
      existing.abort(new Error('Superseded by new request'));
    }
    const controller = new AbortController();
    this.activeControllers.set(requestId, controller);
    return controller;
  }

  private releaseRequestController(requestId: string, controller: AbortController): void {
    if (this.activeControllers.get(requestId) === controller) {
      this.activeControllers.delete(requestId);
    }
  }


  private checkAborted(signal: AbortSignal, requestId: string): void {
    if (signal.aborted || this.destroyed) {
      throw new AdvisorError(`Request ${requestId} was aborted`, 'ABORTED');
    }
  }

  private mapError(err: unknown, requestId: string, signal: AbortSignal): never {
    if (signal.aborted || this.destroyed) {
      throw new AdvisorError(`Request ${requestId} was aborted`, 'ABORTED');
    }
    if (err instanceof AdvisorError) {
      throw err;
    }
    if (err instanceof ApiRequestError) {
      const code = err.code ?? '';
      const status = err.status;
      const msg = err.message || 'API request failed';

      if (code === 'ROUTE_BACKUP_IDENTICAL') {
        throw new AdvisorError(msg, 'ROUTE_BACKUP_IDENTICAL', status);
      }
      if (code === 'ROUTE_ENTRY_INVALID') {
        throw new AdvisorError(msg, 'ROUTE_ENTRY_INVALID', status);
      }
      if (code === 'ROUTE_SCHEMA_INVALID') {
        throw new AdvisorError(msg, 'ROUTE_SCHEMA_INVALID', status);
      }
      if (code === 'POLICY_REVISION_CONFLICT' || status === 409) {
        throw new AdvisorError(msg, 'POLICY_REVISION_CONFLICT', status || 409);
      }
      if (code === 'POLICY_FILE_UNSAFE') {
        throw new AdvisorError(msg, 'POLICY_FILE_UNSAFE', status);
      }
      if (code === 'POLICY_NOT_EDITABLE') {
        throw new AdvisorError(msg, 'POLICY_NOT_EDITABLE', status);
      }
      if (code === 'POLICY_PAYLOAD_TOO_LARGE' || status === 413) {
        throw new AdvisorError(msg, 'POLICY_PAYLOAD_TOO_LARGE', status || 413);
      }
      if (code === 'POLICY_WRITE_FAILED') {
        throw new AdvisorError(msg, 'POLICY_WRITE_FAILED', status);
      }
      if (/advisor_disabled|advisordisabled/i.test(code) || /advisor_disabled|advisordisabled/i.test(msg)) {
        throw new AdvisorError('Advisor is disabled on this server', 'ADVISOR_DISABLED', 403);
      }
      if (status === 401 || /unauthorized|unauthenticated/i.test(code)) {
        throw new AdvisorError(msg, 'UNAUTHORIZED', 401);
      }
      if (status === 403 || /forbidden|permission/i.test(code)) {
        throw new AdvisorError(msg, 'FORBIDDEN', 403);
      }
      if (status === 404 || /not_found|snapshot_not_found|record_not_found/i.test(code)) {
        const mappedCode = /snapshot/i.test(code) || /snapshot/i.test(msg) ? 'SNAPSHOT_NOT_FOUND' : 'NOT_FOUND';
        throw new AdvisorError(msg, mappedCode, 404);
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/advisor_disabled|advisordisabled/i.test(msg)) {
      throw new AdvisorError('Advisor is disabled on this server', 'ADVISOR_DISABLED', 403);
    }
    if (/not found|snapshot_not_found/i.test(msg)) {
      throw new AdvisorError(msg, 'SNAPSHOT_NOT_FOUND', 404);
    }
    if (/unauthorized|unauthenticated/i.test(msg)) {
      throw new AdvisorError(msg, 'UNAUTHORIZED', 401);
    }
    if (/forbidden|permission/i.test(msg)) {
      throw new AdvisorError(msg, 'FORBIDDEN', 403);
    }
    const fallbackStatus = err instanceof ApiRequestError ? err.status : undefined;
    throw new AdvisorError(msg, 'UNKNOWN', fallbackStatus);
  }

  async refreshHistory(
    requestId: string,
    projectId?: string | null,
  ): Promise<HistoryRefreshResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.refreshHistory(
        projectId !== undefined ? { projectId } : undefined,
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async getHistorySummary(
    requestId: string,
    snapshotId: string,
    query: HistorySummaryQueryParams,
  ): Promise<HistorySummaryResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.historySummary(
        { snapshotId, query },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async getHistoryPage(
    requestId: string,
    snapshotId: string,
    query: HistorySummaryQueryParams,
    sort: 'started_at_desc',
    cursor: string | null,
    limit: number,
  ): Promise<HistoryPageResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.historyPage(
        { snapshotId, query, sort, cursor, limit },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async getHistoryDetail(
    requestId: string,
    snapshotId: string,
    recordRef: string,
  ): Promise<HistoryDetailResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.historyDetail(
        { snapshotId, recordRef },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async readCurrentPolicy(requestId: string): Promise<PolicyReadCurrentResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.policyCurrent(undefined, {
        signal: controller.signal,
      });
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }
  async updatePolicy(
    requestId: string,
    params: PolicyUpdateParamsDto,
  ): Promise<PolicyReadCurrentResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.updatePolicy(params, {
        signal: controller.signal,
      });
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async listModels(
    requestId: string,
    backend: AdvisorBackend,
  ): Promise<AdvisorModelsResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.listModels(
        { backend },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async listEvaluations(
    requestId: string,
    cursor: string | null,
    limit: number,
    target?: string | null,
  ): Promise<EvaluationsListResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.evaluationsList(
        { cursor, limit, target },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async readEvaluation(
    requestId: string,
    evaluationRef: string,
    expectedRevision: string,
    target?: string | null,
  ): Promise<EvaluationsReadResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.evaluationsRead(
        { evaluationRef, expectedRevision, target },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  async compareEvaluations(
    requestId: string,
    items: readonly { evaluationRef: string; expectedRevision: string }[],
    cursor: string | null,
    limit: number,
    target?: string | null,
  ): Promise<EvaluationsCompareResultDto> {
    const controller = this.createRequestController(requestId);
    try {
      this.checkAborted(controller.signal, requestId);
      const res = await this.client.advisor.evaluationsCompare(
        { items: [...items], cursor, limit, target },
        { signal: controller.signal },
      );
      this.checkAborted(controller.signal, requestId);
      return res;
    } catch (err: unknown) {
      return this.mapError(err, requestId, controller.signal);
    } finally {
      this.releaseRequestController(requestId, controller);
    }
  }

  cancel(requestId: string): void {
    const controller = this.activeControllers.get(requestId);
    if (controller) {
      controller.abort(new Error(`Operation ${requestId} cancelled`));
      this.activeControllers.delete(requestId);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const controller of this.activeControllers.values()) {
      controller.abort(new Error('Provider destroyed'));
    }
    this.activeControllers.clear();
    this.listeners.clear();
    this.currentDescriptor = {
      ...this.currentDescriptor,
      isAvailable: false,
    };
  }
}
