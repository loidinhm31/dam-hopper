export const PluginErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INCOMPATIBLE: 'INCOMPATIBLE',
  RUNNER_UNAVAILABLE: 'RUNNER_UNAVAILABLE',
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  SOURCE_NOT_CONFIGURED: 'SOURCE_NOT_CONFIGURED',
  SOURCE_MISSING: 'SOURCE_MISSING',
  SOURCE_PERMISSION_DENIED: 'SOURCE_PERMISSION_DENIED',
  INVALID_INPUT: 'INVALID_INPUT',
  OVERLOADED: 'OVERLOADED',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  CANCELLED: 'CANCELLED',
  WORKER_FAILED: 'WORKER_FAILED',
  CONTEXT_REVOKED: 'CONTEXT_REVOKED',
  SNAPSHOT_EXPIRED: 'SNAPSHOT_EXPIRED',
  DETAIL_CHANGED_OR_MISSING: 'DETAIL_CHANGED_OR_MISSING',
} as const;

export type PluginErrorCode = (typeof PluginErrorCode)[keyof typeof PluginErrorCode];

export interface PluginErrorPayload {
  code: PluginErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable?: boolean;
}

export class PluginError extends Error {
  readonly code: PluginErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: PluginErrorCode, message: string, details?: Record<string, unknown>, retryable = false) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.details = details;
    this.retryable = retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toPayload(): PluginErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.retryable ? { retryable: true } : {}),
    };
  }

  static fromPayload(payload: PluginErrorPayload): PluginError {
    return new PluginError(payload.code, payload.message, payload.details, payload.retryable ?? false);
  }
}

export function isPluginError(err: unknown): err is PluginError {
  return err instanceof PluginError;
}

export function toPluginError(err: unknown, fallbackCode: PluginErrorCode = PluginErrorCode.WORKER_FAILED): PluginError {
  if (isPluginError(err)) {
    return err;
  }
  if (err instanceof Error) {
    return new PluginError(fallbackCode, err.message);
  }
  return new PluginError(fallbackCode, String(err));
}
