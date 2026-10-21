import type * as monacoNs from "monaco-editor";
import type { RegionDecisionState } from "@/lib/conflict-merge-types.js";

export interface ConflictMarkerRegion {
  id?: string;
  startLine: number;
  separatorLine: number;
  endLine: number;
}

export interface SourceConflictRange {
  regionId?: string;
  startLine: number;
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
.mc-glyph-arrow-theirs {
  display: flex !important;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.mc-glyph-arrow-theirs::after {
  content: "→";
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.3);
  border: 1px solid rgba(59, 130, 246, 0.7);
  color: #93c5fd;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  transition: all 0.15s ease-in-out;
}
.mc-glyph-arrow-theirs:hover::after {
  background: #2563eb;
  border-color: #bfdbfe;
  color: #ffffff;
  transform: scale(1.18);
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}
.mc-glyph-arrow-ours {
  display: flex !important;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.mc-glyph-arrow-ours::after {
  content: "←";
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: rgba(34, 197, 94, 0.3);
  border: 1px solid rgba(34, 197, 94, 0.7);
  color: #86efac;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  transition: all 0.15s ease-in-out;
}
.mc-glyph-arrow-ours:hover::after {
  background: #16a34a;
  border-color: #bbf7d0;
  color: #ffffff;
  transform: scale(1.18);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}
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
    const decision = r.id && decisions ? decisions[r.id] : undefined;

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
  lineRanges: SourceConflictRange[],
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

      // One gutter arrow per conflict chunk on its first line
      if (side === "theirs" || side === "ours") {
        dec.push({
          range: new monaco.Range(r.startLine, 1, r.startLine, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName:
              side === "theirs" ? "mc-glyph-arrow-theirs" : "mc-glyph-arrow-ours",
            glyphMarginHoverMessage: {
              value:
                side === "theirs"
                  ? "Accept incoming (theirs) →"
                  : "← Accept current (ours)",
            },
            stickiness: 1,
          },
        });
      }
    }
  }

  return dec;
}
