import type { GitLogEntry } from "@/api/client.js";

export interface GitSquashSelection {
  count: number;
  orderedHashes: string[];
  entries: GitLogEntry[];
  valid: boolean;
  disabledReason?: string;
}

/** Loaded-page membership is not ancestry: derive the chain exclusively from parents. */
export function deriveGitSquashSelection(
  logs: readonly GitLogEntry[],
  hashes: readonly string[],
): GitSquashSelection {
  const invalid = (disabledReason: string): GitSquashSelection => ({
    count: hashes.length,
    orderedHashes: [],
    entries: [],
    valid: false,
    disabledReason,
  });
  const membership = new Set(hashes);
  if (membership.size !== hashes.length)
    return invalid("Select distinct commits only.");
  const byHash = new Map(logs.map((entry) => [entry.hash, entry]));
  if (byHash.size !== logs.length)
    return invalid(
      "History contains duplicate commits. Refresh and select again.",
    );
  if (hashes.some((hash) => !byHash.has(hash)))
    return invalid(
      "Selection is no longer on this page. Refresh and select again.",
    );
  if (hashes.length < 2)
    return invalid(
      "Select at least two parent-contiguous commits on this page.",
    );
  const childByParent = new Map<string, string>();
  const oldest: string[] = [];
  for (const hash of hashes) {
    const entry = byHash.get(hash)!;
    if (entry.parents.length > 1)
      return invalid(
        "Selected merge commits cannot be squashed. Select linear history.",
      );
    const parent = entry.parents[0];
    if (!membership.has(parent)) oldest.push(hash);
    else {
      if (childByParent.has(parent))
        return invalid(
          "Selection branches into multiple children. Select one linear chain.",
        );
      childByParent.set(parent, hash);
    }
  }
  if (oldest.length !== 1)
    return invalid(
      "Select parent-contiguous commits without gaps or disconnected history.",
    );
  const orderedHashes: string[] = [];
  const visited = new Set<string>();
  let hash: string | undefined = oldest[0];
  while (hash && !visited.has(hash)) {
    visited.add(hash);
    orderedHashes.push(hash);
    hash = childByParent.get(hash);
  }
  if (hash || visited.size !== membership.size)
    return invalid("Select one complete parent-contiguous chain.");
  return {
    count: hashes.length,
    orderedHashes,
    entries: orderedHashes.map((oid) => byHash.get(oid)!),
    valid: true,
  };
}

export function normalizeCommitMessage(message: string): string {
  return message.endsWith("\n") ? message : `${message}\n`;
}

export function combineCommitMessages(messages: readonly string[]): string {
  let combined = "";
  for (let index = 0; index < messages.length; index += 1) {
    if (index > 0) combined += combined.endsWith("\n") ? "\n" : "\n\n";
    combined += messages[index];
  }
  return normalizeCommitMessage(combined);
}
