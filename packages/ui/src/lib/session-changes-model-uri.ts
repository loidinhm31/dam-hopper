/**
 * Model URI constructor and parser for Monaco diff models in Session Changes review.
 * Fenced strictly to owner profile, generation, terminal, incarnation, session, epoch, baseline, revision, side, and path.
 */

export interface SessionChangesModelUriParams {
  profileId: string;
  generation: number;
  terminalId: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId: string;
  serverEpoch: string;
  baselineId: string;
  comparisonRevision: string;
  path: string;
  side: "original" | "current";
}

export function buildSessionChangesModelUri(
  params: SessionChangesModelUriParams,
): string {
  const enc = encodeURIComponent;
  const ownerPart = `${enc(params.profileId)}_${params.generation}`;
  const terminalPart = `${enc(params.terminalId)}_${enc(params.terminalIncarnation)}`;
  const sessionPart = enc(params.ompSessionId);
  const rootPart = enc(params.rootId);
  const revisionPart = `${enc(params.serverEpoch)}_${enc(params.baselineId)}_${enc(params.comparisonRevision)}`;
  const pathPart = enc(params.path);

  return `sessionchanges://${ownerPart}/${terminalPart}/${sessionPart}/${rootPart}/${revisionPart}/${params.side}/${pathPart}`;
}

export function parseSessionChangesModelUri(
  uri: string,
): SessionChangesModelUriParams | null {
  if (!uri.startsWith("sessionchanges://")) return null;
  const rest = uri.slice("sessionchanges://".length);
  const parts = rest.split("/");
  if (parts.length !== 7) return null;

  const [ownerPart, terminalPart, sessionPart, rootPart, revisionPart, sidePart, pathPart] =
    parts;

  if (sidePart !== "original" && sidePart !== "current") return null;

  const ownerSegments = ownerPart.split("_");
  if (ownerSegments.length !== 2) return null;
  const profileId = decodeURIComponent(ownerSegments[0]);
  const generation = parseInt(ownerSegments[1], 10);
  if (isNaN(generation)) return null;

  const terminalSegments = terminalPart.split("_");
  if (terminalSegments.length !== 2) return null;
  const terminalId = decodeURIComponent(terminalSegments[0]);
  const terminalIncarnation = decodeURIComponent(terminalSegments[1]);

  const ompSessionId = decodeURIComponent(sessionPart);
  const rootId = decodeURIComponent(rootPart);

  const revSegments = revisionPart.split("_");
  if (revSegments.length !== 3) return null;
  const serverEpoch = decodeURIComponent(revSegments[0]);
  const baselineId = decodeURIComponent(revSegments[1]);
  const comparisonRevision = decodeURIComponent(revSegments[2]);

  const path = decodeURIComponent(pathPart);

  return {
    profileId,
    generation,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    rootId,
    serverEpoch,
    baselineId,
    comparisonRevision,
    path,
    side: sidePart,
  };
}
