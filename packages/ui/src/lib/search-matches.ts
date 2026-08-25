import type { PathSearchMatch, SearchMatch } from "@/api/fs-types.js";

export type SearchResultItem = SearchMatch | PathSearchMatch;

export interface GroupedContentSearchMatches {
  key: string;
  path: string;
  project?: string;
  matches: SearchMatch[];
}

export function isContentSearchMatch(
  match: SearchResultItem,
): match is SearchMatch {
  return (
    typeof (match as SearchMatch).text === "string" &&
    typeof (match as SearchMatch).line === "number"
  );
}

export function isPathSearchMatch(
  match: SearchResultItem,
): match is PathSearchMatch {
  return typeof match.path === "string" && !isContentSearchMatch(match);
}

export function compareContentSearchMatches(
  a: SearchMatch,
  b: SearchMatch,
): number {
  return (
    compareOptionalText(a.project, b.project) ||
    a.path.localeCompare(b.path) ||
    a.line - b.line ||
    a.col - b.col
  );
}

export function comparePathSearchMatches(
  a: PathSearchMatch,
  b: PathSearchMatch,
): number {
  return compareOptionalText(a.project, b.project) || a.path.localeCompare(b.path);
}

export function sortContentSearchMatches(
  matches: readonly SearchMatch[],
): SearchMatch[] {
  return [...matches].sort(compareContentSearchMatches);
}

export function sortPathSearchMatches(
  matches: readonly PathSearchMatch[],
): PathSearchMatch[] {
  return [...matches].sort(comparePathSearchMatches);
}

export function groupContentSearchMatches(
  matches: readonly SearchMatch[],
): GroupedContentSearchMatches[] {
  const groups = new Map<string, GroupedContentSearchMatches>();

  for (const match of matches) {
    const key = `${match.project ?? ""}:${match.path}`;
    const existing = groups.get(key);
    if (existing) {
      existing.matches.push(match);
      continue;
    }

    groups.set(key, {
      key,
      path: match.path,
      project: match.project,
      matches: [match],
    });
  }

  return Array.from(groups.values());
}

export function buildContentSearchMatchKey(match: SearchMatch): string {
  return `${match.project ?? ""}:${match.path}:${match.line}:${match.col}`;
}

export function findNextContentSearchMatch(
  matches: readonly SearchMatch[],
  afterMatch?: SearchMatch | null,
): SearchMatch | null {
  if (matches.length === 0) return null;
  if (!afterMatch) return matches[0] ?? null;

  return (
    matches.find((match) => compareContentSearchMatches(match, afterMatch) > 0) ??
    null
  );
}

function compareOptionalText(a?: string, b?: string): number {
  return (a ?? "").localeCompare(b ?? "");
}
