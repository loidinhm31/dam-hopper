import type * as monacoNs from "monaco-editor";
import type { GitBlameCommit, GitBlameResponse } from "@/api/client.js";
import {
  findBlameRangeForLine,
  findCommitForRange,
  formatBlameDate,
  formatBlameFullTimestamp,
} from "@/lib/editor-git-blame.js";

export interface BlameGutterLayout {
  width: number;
  mode: "normal" | "compact";
}

/**
 * Computes responsive blame column width and mode from whole editor wrapper width:
 * - >= 640px: 220px author/date column ("normal")
 * - < 640px: min(120px, Math.floor(wrapperWidth / 3)) author-only column ("compact")
 */
export function computeBlameGutterLayout(
  wrapperWidth: number,
): BlameGutterLayout {
  if (wrapperWidth >= 640) {
    return { width: 220, mode: "normal" };
  }
  const calculated = Math.floor(wrapperWidth / 3);
  const width = Math.max(1, Math.min(120, calculated));
  return { width, mode: "compact" };
}

export interface RenderedBlameRow {
  lineNumber: number;
  top: number;
  height: number;
  isUncommitted: boolean;
  commit: GitBlameCommit | null;
  displayAuthor: string;
  displayDate: string;
  hoverMetadata: string;
}

export interface ComputeVisibleBlameRowsParams {
  editor: monacoNs.editor.IStandaloneCodeEditor;
  blameData: GitBlameResponse;
  monaco?: typeof monacoNs | null;
}

/**
 * Calculates visible blame rows based on Monaco's current visible ranges and scroll position.
 * Respects folded regions and editor line height.
 */
export function computeVisibleBlameRows({
  editor,
  blameData,
  monaco,
}: ComputeVisibleBlameRowsParams): RenderedBlameRow[] {
  const model = editor.getModel();
  if (!model) return [];

  const visibleRanges = editor.getVisibleRanges();
  const scrollTop = editor.getScrollTop();
  const layoutInfo = editor.getLayoutInfo();
  const viewportHeight = layoutInfo.height;

  if (!monaco) return [];
  const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
  const rows: RenderedBlameRow[] = [];

  for (const range of visibleRanges) {
    for (
      let line = range.startLineNumber;
      line <= range.endLineNumber;
      line++
    ) {
      const lineTop = editor.getTopForLineNumber(line);
      const top = lineTop - scrollTop;

      // Skip rows far outside visible viewport bounds
      if (top < -lineHeight || top > viewportHeight + lineHeight) {
        continue;
      }

      const blameRange = findBlameRangeForLine(blameData.ranges, line);
      const isUncommitted =
        !blameRange ||
        blameRange.commitIndex === null ||
        blameRange.commitIndex === undefined;
      const commit = isUncommitted
        ? null
        : findCommitForRange(blameData.commits, blameRange);

      if (isUncommitted || !commit) {
        rows.push({
          lineNumber: line,
          top,
          height: lineHeight,
          isUncommitted: true,
          commit: null,
          displayAuthor: "Uncommitted",
          displayDate: "",
          hoverMetadata: `Line ${line}: Uncommitted changes`,
        });
      } else {
        const formattedDate = formatBlameDate(commit.authorTimestamp);
        const fullTimestamp = formatBlameFullTimestamp(
          commit.authorTimestamp,
          commit.authorTimezoneOffsetMinutes,
        );
        const authorDisplay = commit.authorEmail
          ? `${commit.authorName} <${commit.authorEmail}>`
          : commit.authorName;
        const metadata = `Author: ${authorDisplay}\nDate: ${fullTimestamp}\nCommit: ${commit.hash}\n\n${commit.subject}`;
        rows.push({
          lineNumber: line,
          top,
          height: lineHeight,
          isUncommitted: false,
          commit,
          displayAuthor: commit.authorName,
          displayDate: formattedDate,
          hoverMetadata: metadata,
        });
      }
    }
  }

  return rows;
}
