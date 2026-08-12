import {
  parseSemanticProtocolTrustChallenge,
  parseSemanticProtocolTrustState,
  type SemanticTrust,
  type SemanticTrustChallenge,
  type SemanticTrustState,
} from "@dam-hopper/shared";
import { buildAuthHeaders } from "./server-config.js";

export class SemanticTrustError extends Error {
  override name = "SemanticTrustError";
}

export class SemanticTrustApi {
  private readonly baseUrl: string;
  private readonly profileId: string | undefined;

  constructor(baseUrl: string, profileId?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.profileId = profileId;
  }

  status(projectId: string): Promise<SemanticTrustState> {
    return this.request(
      `/api/semantic/trust/${encodeURIComponent(projectId)}`,
      { method: "GET" },
      parseSemanticProtocolTrustState,
    );
  }

  challenge(projectId: string): Promise<SemanticTrustChallenge> {
    return this.request(
      `/api/semantic/trust/${encodeURIComponent(projectId)}/challenge`,
      { method: "POST", body: "{}" },
      parseSemanticProtocolTrustChallenge,
    );
  }

  async transition(
    projectId: string,
    desiredTrust: Exclude<SemanticTrust, "revoked">,
    confirmation: string,
  ): Promise<SemanticTrustState> {
    return this.request(
      `/api/semantic/trust/${encodeURIComponent(projectId)}/transition`,
      {
        method: "POST",
        body: JSON.stringify({ projectId, desiredTrust, confirmation }),
      },
      parseSemanticProtocolTrustState,
    );
  }

  revoke(projectId: string): Promise<SemanticTrustState> {
    return this.request(
      `/api/semantic/trust/${encodeURIComponent(projectId)}/revoke`,
      { method: "POST", body: "{}" },
      parseSemanticProtocolTrustState,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    parse: (value: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(this.profileId),
          ...init.headers,
        },
        credentials: "include",
      });
    } catch {
      throw new SemanticTrustError("semantic trust service unavailable");
    }
    if (!response.ok)
      throw new SemanticTrustError("semantic trust request failed");
    try {
      return parse(await response.json());
    } catch {
      throw new SemanticTrustError("semantic trust response invalid");
    }
  }
}
