import type { SearchMatch } from "@/api/fs-types.js";
import type {
  FsReadResponse,
  FsWriteResponse,
} from "@/api/ws-transport.js";
import { findNextContentSearchMatch } from "@/lib/search-matches.js";

const encoder = new TextEncoder();

export interface ReplaceNextOptions {
  currentProject: string;
  matches: SearchMatch[];
  selectedMatch: SearchMatch | null;
  searchQuery: string;
  replaceQuery: string;
  caseSensitive: boolean;
  hasDirtyOpenTab: (project: string, path: string) => boolean;
  openMatch: (match: SearchMatch) => void;
  readFile: (project: string, path: string) => Promise<FsReadResponse>;
  writeFile: (
    project: string,
    path: string,
    content: string,
    expectedMtime: number,
  ) => Promise<FsWriteResponse>;
  refreshMatches: () => Promise<SearchMatch[]>;
  reloadOpenTab?: (project: string, path: string) => Promise<void>;
}

export type ReplaceNextResult =
  | { kind: "replaced"; nextMatch: SearchMatch | null }
  | { kind: "blocked-dirty"; match: SearchMatch; message: string }
  | { kind: "stale"; nextMatch: SearchMatch | null; message: string }
  | { kind: "error"; message: string };

export function replaceContentSearchMatch(
  content: string,
  match: SearchMatch,
  searchQuery: string,
  replaceQuery: string,
  caseSensitive: boolean,
): { ok: true; content: string } | { ok: false } {
  const lineStart = findLineStartOffset(content, match.line);
  if (lineStart === null) return { ok: false };

  const lineEnd = content.indexOf("\n", lineStart);
  const lineText =
    lineEnd === -1 ? content.slice(lineStart) : content.slice(lineStart, lineEnd);
  const lineColumn = utf8ByteOffsetToCodeUnitIndex(lineText, match.col - 1);
  if (lineColumn === null) return { ok: false };

  const start = lineStart + lineColumn;
  const matchedText = content.slice(start, start + searchQuery.length);
  const matches = caseSensitive
    ? matchedText === searchQuery
    : matchedText.toLowerCase() === searchQuery.toLowerCase();

  if (!matches) return { ok: false };

  return {
    ok: true,
    content:
      content.slice(0, start) +
      replaceQuery +
      content.slice(start + searchQuery.length),
  };
}

export async function runReplaceNext(
  options: ReplaceNextOptions,
): Promise<ReplaceNextResult> {
  const {
    currentProject,
    matches,
    selectedMatch,
    searchQuery,
    replaceQuery,
    caseSensitive,
    hasDirtyOpenTab,
    openMatch,
    readFile,
    writeFile,
    refreshMatches,
    reloadOpenTab,
  } = options;

  const target = selectedMatch ?? findNextContentSearchMatch(matches);
  if (!target) {
    return { kind: "error", message: "No content matches available." };
  }

  const targetProject = target.project ?? currentProject;
  if (hasDirtyOpenTab(targetProject, target.path)) {
    openMatch(target);
    return {
      kind: "blocked-dirty",
      match: target,
      message:
        "Save or discard the open unsaved tab for this file before replacing.",
    };
  }

  const readResult = await readFile(targetProject, target.path);
  if (!readResult.ok) {
    return {
      kind: "error",
      message:
        readResult.code === "TOO_LARGE"
          ? "Replace Next only supports text files that can be read into the editor."
          : `Unable to read ${target.path}: ${readResult.code}`,
    };
  }

  if (readResult.binary) {
    return {
      kind: "error",
      message: "Replace Next only supports text files.",
    };
  }

  const latestContent = decodeBase64Utf8(readResult.content);
  const replacement = replaceContentSearchMatch(
    latestContent,
    target,
    searchQuery,
    replaceQuery,
    caseSensitive,
  );
  if (!replacement.ok) {
    const refreshedMatches = await refreshMatches();
    return {
      kind: "stale",
      nextMatch: findNextContentSearchMatch(refreshedMatches, target),
      message: "That match moved or changed. Search results were refreshed.",
    };
  }

  const writeResult = await writeFile(
    targetProject,
    target.path,
    replacement.content,
    readResult.mtime,
  );
  if (!writeResult.ok) {
    if (writeResult.conflict) {
      const refreshedMatches = await refreshMatches();
      return {
        kind: "stale",
        nextMatch: findNextContentSearchMatch(refreshedMatches, target),
        message: "The file changed before the replace completed. Results refreshed.",
      };
    }

    return {
      kind: "error",
      message: writeResult.error || "Replace Next failed.",
    };
  }

  await reloadOpenTab?.(targetProject, target.path);

  const refreshedMatches = await refreshMatches();
  return {
    kind: "replaced",
    nextMatch: findNextContentSearchMatch(refreshedMatches, target),
  };
}

function decodeBase64Utf8(content: string): string {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function findLineStartOffset(content: string, lineNumber: number): number | null {
  if (lineNumber < 1) return null;

  let currentLine = 1;
  let offset = 0;
  while (currentLine < lineNumber) {
    const newlineIndex = content.indexOf("\n", offset);
    if (newlineIndex === -1) return null;
    offset = newlineIndex + 1;
    currentLine += 1;
  }

  return offset;
}

function utf8ByteOffsetToCodeUnitIndex(
  text: string,
  byteOffset: number,
): number | null {
  if (byteOffset < 0) return null;
  if (byteOffset === 0) return 0;

  let currentByteOffset = 0;
  let index = 0;

  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) return null;

    const char = String.fromCodePoint(codePoint);
    const charByteLength = encoder.encode(char).length;
    if (currentByteOffset + charByteLength > byteOffset) {
      return null;
    }

    currentByteOffset += charByteLength;
    index += char.length;

    if (currentByteOffset === byteOffset) {
      return index;
    }
  }

  return currentByteOffset === byteOffset ? index : null;
}
