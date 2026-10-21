import type * as monacoNs from "monaco-editor";
import type { RegionDecisionState } from "@/lib/conflict-merge-types.js";

export interface ConflictMarkerRegion {
  startLine: number;
  separatorLine: number;
  endLine: number;
}
export const CONFLICT_DECORATION_STYLES = `
.mc-conflict-marker     { background: rgba(239, 68, 68, 0.15); border-left: 3px solid #ef4444; }
.mc-conflict-ours       { background: rgba(34, 197, 94, 0.12); border-left: 3px solid #22c55e; }
.mc-conflict-theirs     { background: rgba(59, 130, 246, 0.12); border-left: 3px solid #3b82f6; }
.mc-conflict-base       { background: rgba(168, 85, 247, 0.12); border-left: 3px solid #a855f7; }
.mc-conflict-sep        { background: rgba(245, 158, 11, 0.20); }
.mc-conflict-resolved   { background: rgba(34, 197, 94, 0.08); }
.mc-conflict-spacer     { background: repeating-linear-gradient(45deg, rgba(255,255,255,0.02), rgba(255,255,255,0.02) 10px, transparent 10px, transparent 20px); }
`;

export function injectConflictStylesOnce(): void {
  const id = "mc-conflict-styles";
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = CONFLICT_DECORATION_STYLES;
  document.head.appendChild(el);
}

export function buildResultDecorations(
  regions: ConflictMarkerRegion[],
  decisions: Record<string, RegionDecisionState> | undefined,
  monaco: typeof monacoNs,
): monacoNs.editor.IModelDeltaDecoration[] {
  const dec: monacoNs.editor.IModelDeltaDecoration[] = [];

  for (const r of regions) {
    const decision = decisions
      ? Object.values(decisions).find(
          (d) =>
            d.oursDecision !== "pending" ||
            d.theirsDecision !== "pending" ||
            d.manualReview === "reviewed",
        )
      : undefined;

    // <<<<<< marker line
    dec.push({
      range: new monaco.Range(r.startLine, 1, r.startLine, 1),
      options: {
        isWholeLine: true,
        className: "mc-conflict-marker",
        stickiness: 1,
      },
    });

    // ours lines
    if (r.separatorLine > r.startLine + 1) {
      dec.push({
        range: new monaco.Range(r.startLine + 1, 1, r.separatorLine - 1, 1),
        options: {
          isWholeLine: true,
          className: decision?.oursDecision === "accepted" ? "mc-conflict-resolved" : "mc-conflict-ours",
          stickiness: 1,
        },
      });
    }

    // ======= separator
    dec.push({
      range: new monaco.Range(r.separatorLine, 1, r.separatorLine, 1),
      options: {
        isWholeLine: true,
        className: "mc-conflict-sep",
        stickiness: 1,
      },
    });

    // theirs lines
    if (r.endLine > r.separatorLine + 1) {
      dec.push({
        range: new monaco.Range(r.separatorLine + 1, 1, r.endLine - 1, 1),
        options: {
          isWholeLine: true,
          className: decision?.theirsDecision === "accepted" ? "mc-conflict-resolved" : "mc-conflict-theirs",
          stickiness: 1,
        },
      });
    }

    // >>>>>>> marker line
    dec.push({
      range: new monaco.Range(r.endLine, 1, r.endLine, 1),
      options: {
        isWholeLine: true,
        className: "mc-conflict-marker",
        stickiness: 1,
      },
    });
  }

  return dec;
}

export function buildSourceDecorations(
  lineRanges: Array<{ startLine: number; endLine: number }>,
  side: "ours" | "theirs" | "base",
  monaco: typeof monacoNs,
): monacoNs.editor.IModelDeltaDecoration[] {
  const dec: monacoNs.editor.IModelDeltaDecoration[] = [];
  const className =
    side === "ours"
      ? "mc-conflict-ours"
      : side === "theirs"
        ? "mc-conflict-theirs"
        : "mc-conflict-base";

  for (const r of lineRanges) {
    if (r.endLine >= r.startLine) {
      dec.push({
        range: new monaco.Range(r.startLine, 1, r.endLine, 1),
        options: {
          isWholeLine: true,
          className,
          stickiness: 1,
        },
      });
    }
  }

  return dec;
}
