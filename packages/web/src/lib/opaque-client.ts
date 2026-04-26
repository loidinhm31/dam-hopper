import { client, ready } from "@serenity-kit/opaque";

let readyPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  return (readyPromise ??= ready);
}

export interface OpaqueRegisterResult {
  requestBytes: string;
  finishRegistration: (responseBytes: string) => string;
}

export async function opaqueRegisterStart(password: string): Promise<OpaqueRegisterResult> {
  await ensureReady();
  const { clientRegistrationState, registrationRequest } = client.startRegistration({ password });
  return {
    requestBytes: registrationRequest,
    finishRegistration: (registrationResponse: string): string => {
      const { registrationRecord } = client.finishRegistration({
        clientRegistrationState,
        registrationResponse,
        password,
      });
      return registrationRecord;
    },
  };
}

export interface OpaqueLoginFinishResult {
  finalizationBytes: string;
  // sessionKey is the shared OPAQUE session key (same on client and server).
  // NOTE: NOT exportKey (client-only). Used for server-side AES key derivation.
  sessionKey: string;
}

export interface OpaqueLoginResult {
  requestBytes: string;
  finishLogin: (responseBytes: string) => OpaqueLoginFinishResult | null;
}

export async function opaqueLoginStart(password: string): Promise<OpaqueLoginResult> {
  await ensureReady();
  const { clientLoginState, startLoginRequest } = client.startLogin({ password });
  return {
    requestBytes: startLoginRequest,
    finishLogin: (loginResponse: string): OpaqueLoginFinishResult | null => {
      const result = client.finishLogin({ clientLoginState, loginResponse, password });
      if (!result) return null;
      return {
        finalizationBytes: result.finishLoginRequest,
        sessionKey: result.sessionKey,
      };
    },
  };
}
