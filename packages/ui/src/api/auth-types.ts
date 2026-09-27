/**
 * Type definitions and error types for DamHopper authentication protocol v2.
 */

export const AUTH_PROTOCOL_VERSION = 2;

export const AUTH_ERROR_CODES = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  MFA_REQUIRED: "MFA_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_CHALLENGE: "INVALID_CHALLENGE",
  INVALID_CODE: "INVALID_CODE",
  CODE_REPLAYED: "CODE_REPLAYED",
  RATE_LIMITED: "RATE_LIMITED",
  AUTH_UNAVAILABLE: "AUTH_UNAVAILABLE",
  INCOMPATIBLE_PROTOCOL: "INCOMPATIBLE_PROTOCOL",
  NETWORK_ERROR: "NETWORK_ERROR",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES] | string;

export class AuthClientError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(
    message: string,
    code: AuthErrorCode,
    status = 400,
    retryAfter?: number,
  ) {
    super(message);
    this.name = "AuthClientError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export interface LoginChallengeResponse {
  state: "enrollmentRequired" | "mfaRequired";
  challengeToken: string;
  challengeExpiresAt: string;
  authProtocol: number;
}

export interface DevLoginResponse {
  token: string;
  user?: string;
  role?: "user" | "admin";
  expiresAt?: string;
  dev_mode?: boolean;
  devMode?: boolean;
  authProtocol?: number;
}

export type LoginResult =
  | { kind: "challenge"; data: LoginChallengeResponse }
  | { kind: "session"; data: DevLoginResponse };

export interface MfaSetupResponse {
  secret: string;
  otpauthUri: string;
  issuer: string;
  accountName: string;
  algorithm: string;
  digits: number;
  period: number;
}

export interface AuthSessionResponse {
  state: "authenticated";
  token: string;
  expiresAt: string;
  mfaDueAt: string;
  user: string;
  role: "user" | "admin";
  authProtocol: number;
}

export interface MfaChallengeResponse {
  challengeToken: string;
  challengeExpiresAt: string;
  authProtocol: number;
}

export interface AuthStatusSuccess {
  authenticated: true;
  user: string;
  role?: "user" | "admin";
  workbenchProtocol: number;
  authProtocol?: number;
  issuedAt?: string;
  expiresAt?: string;
  mfaDueAt?: string;
  dev_mode?: boolean;
  devMode?: boolean;
}

export interface AuthStatusMfaRequired {
  authenticated: false;
  code: "MFA_REQUIRED";
  error: string;
  user?: string;
  expiresAt?: string;
  mfaDueAt?: string;
  workbenchProtocol?: number;
  authProtocol?: number;
}

export interface AuthStatusLoginRequired {
  authenticated: false;
  code: string;
  error: string;
  workbenchProtocol?: number;
  authProtocol?: number;
}

export type AuthStatusResult =
  | AuthStatusSuccess
  | AuthStatusMfaRequired
  | AuthStatusLoginRequired;
