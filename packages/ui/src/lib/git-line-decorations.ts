import type { GitLineChange } from "@/api/client.js";

export interface GitLineDecorationDescriptor {
  kind: GitLineChange["kind"];
  startLineNumber: number;
  endLineNumber: number;
  className: string;
  glyphMarginClassName: string;
  overviewRulerColor: string;
  hoverMessage: string;
}

const COLORS: Record<GitLineChange["kind"], string> = {
  added: "rgba(34, 197, 94, 0.85)",
  modified: "rgba(59, 130, 246, 0.85)",
  deleted: "rgba(248, 113, 113, 0.9)",
};

const LABELS: Record<GitLineChange["kind"], string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
};

export function gitLineChangesToDecorationDescriptors(
  changes: GitLineChange[] | undefined,
): GitLineDecorationDescriptor[] {
  return (changes ?? []).map((change) => {
    const start = Math.max(1, change.line);
    const length = Math.max(1, change.length);
    const end = start + length - 1;
    return {
      kind: change.kind,
      startLineNumber: start,
      endLineNumber: end,
      className: `git-line-change git-line-change-${change.kind}`,
      glyphMarginClassName: `git-glyph-change git-glyph-change-${change.kind}`,
      overviewRulerColor: COLORS[change.kind],
      hoverMessage: `${LABELS[change.kind]} lines (+${change.newLines} -${change.oldLines})`,
    };
  });
}

export function findGitLineChangeAtLine(
  changes: GitLineChange[] | undefined,
  line: number,
): GitLineChange | null {
  return (
    (changes ?? []).find((change) => {
      const start = Math.max(1, change.line);
      const end = start + Math.max(1, change.length) - 1;
      return line >= start && line <= end;
    }) ?? null
  );
}
