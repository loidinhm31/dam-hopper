import type { ConnectionSnapshot } from "@/api/connections.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { terminalKey } from "@/api/ownership.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import {
  isCanonicalPositiveU64,
  isCanonicalUuid,
  terminalTargetKey,
} from "@/api/terminal-session-contract.js";

export interface TerminalRuntimeCandidate {
  readonly profileId: string;
  readonly id: string;
  readonly terminationTarget: TerminalTarget | null;
}

/**
 * Strictly parses a logical terminal key: JSON.stringify([profileId, id]).
 * Rejects non-arrays, arrays with length !== 2, and non-string elements.
 * This prevents 3-element instance keys or 5-element runtime target keys
 * from being misidentified as logical terminal keys.
 */
export function parseStrictLogicalTerminalKey(
  logicalKey: string,
): { profileId: string; id: string } | null {
  try {
    const parsed = JSON.parse(logicalKey);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { profileId: parsed[0], id: parsed[1] };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Shared validation path for TerminalRuntimeCandidate.
 *
 * Enforces Invariant C1:
 * 1. candidate.terminationTarget must be non-null.
 * 2. target.profileId === candidate.profileId.
 * 3. target.terminalId === candidate.id.
 * 4. target.serverEpoch must be a canonical UUID.
 * 5. target.incarnation must be a canonical positive-u64 decimal string.
 * 6. snapshot for candidate.profileId must exist and have status "connected".
 * 7. snapshot.owner.profileId === candidate.profileId.
 * 8. snapshot.owner.generation === target.generation.
 *
 * Returns the candidate's verified terminationTarget directly; never synthesizes a new object.
 */
export function validateCandidateTarget(
  candidate: TerminalRuntimeCandidate,
  getSnapshot: (profileId: string) => ConnectionSnapshot | null,
): TerminalTarget | undefined {
  const target = candidate.terminationTarget;
  if (!target) return undefined;

  if (target.profileId !== candidate.profileId) return undefined;
  if (target.terminalId !== candidate.id) return undefined;

  if (!isCanonicalUuid(target.serverEpoch)) return undefined;
  if (!isCanonicalPositiveU64(target.incarnation)) return undefined;

  const snapshot = getSnapshot(candidate.profileId);
  if (!snapshot || snapshot.status !== "connected") return undefined;
  if (snapshot.owner.profileId !== candidate.profileId) return undefined;
  if (snapshot.owner.generation !== target.generation) return undefined;

  return target;
}

/**
 * Builds an index of logical terminal keys (JSON.stringify([profileId, id]))
 * to validated TerminalTarget objects.
 *
 * Duplicate / replacement policy:
 * When multiple candidates for the same logical key are valid, the candidate with
 * the strictly higher canonical incarnation (compared as u64 via BigInt) takes
 * precedence. If incarnations are equal, the later candidate in the list takes precedence.
 */
export function buildTerminalRuntimeIndex(
  candidates: readonly TerminalRuntimeCandidate[],
  getSnapshot: (
    profileId: string,
  ) => ConnectionSnapshot | null = getConnectionSnapshot,
): ReadonlyMap<string /*terminalKey*/, TerminalTarget> {
  const index = new Map<string, TerminalTarget>();
  const conflictingKeys = new Set<string>();

  for (const candidate of candidates) {
    const target = validateCandidateTarget(candidate, getSnapshot);
    if (!target) continue;

    const key = terminalKey({
      profileId: candidate.profileId,
      id: candidate.id,
    });

    if (conflictingKeys.has(key)) {
      continue;
    }

    const existing = index.get(key);
    if (!existing) {
      index.set(key, target);
      continue;
    }

    // If serverEpoch conflicts, authority is ambiguous across epochs -> fail-closed
    if (existing.serverEpoch !== target.serverEpoch) {
      index.delete(key);
      conflictingKeys.add(key);
      continue;
    }

    const existingIncarnation = BigInt(existing.incarnation);
    const newIncarnation = BigInt(target.incarnation);
    if (newIncarnation > existingIncarnation) {
      index.set(key, target);
    } else if (newIncarnation < existingIncarnation) {
      // Retain existing higher incarnation
    } else {
      // Equal incarnations: if different target identities, conflict -> fail-closed
      if (
        existing !== target &&
        terminalTargetKey(existing) !== terminalTargetKey(target)
      ) {
        index.delete(key);
        conflictingKeys.add(key);
      }
    }
  }

  return index;
}

/**
 * Resolves a logical terminal key to its verified TerminalTarget from candidates.
 *
 * Reuses buildTerminalRuntimeIndex for exact consistency:
 * Returns undefined if:
 * - logicalKey fails strict 2-element tuple parsing
 * - no candidate matches
 * - candidate has null or invalid target
 * - profile connection is disconnected or has retired generation
 */
export function resolveTerminalRuntimeTarget(
  logicalKey: string,
  candidates: readonly TerminalRuntimeCandidate[],
  getSnapshot: (
    profileId: string,
  ) => ConnectionSnapshot | null = getConnectionSnapshot,
): TerminalTarget | undefined {
  const parsed = parseStrictLogicalTerminalKey(logicalKey);
  if (!parsed) return undefined;

  const index = buildTerminalRuntimeIndex(candidates, getSnapshot);
  return index.get(terminalKey(parsed));
}
