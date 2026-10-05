import { useEffect, type RefObject } from "react";
import type * as monacoNs from "monaco-editor";

/**
 * Synchronizes wheel scrolling over the blame gutter with Monaco's vertical scroll.
 * Avoids trapping page scroll when editor is at boundary limits.
 */
export function useBlameGutterWheelSync(
  gutterRef: RefObject<HTMLDivElement | null>,
  editor: monacoNs.editor.IStandaloneCodeEditor | null,
) {
  useEffect(() => {
    const gutterEl = gutterRef.current;
    if (!gutterEl || !editor) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      const currentScrollTop = editor.getScrollTop();
      const layoutInfo = editor.getLayoutInfo();
      const maxScroll = Math.max(0, editor.getScrollHeight() - layoutInfo.height);
      const targetScroll = Math.max(
        0,
        Math.min(maxScroll, currentScrollTop + e.deltaY),
      );

      if (targetScroll !== currentScrollTop) {
        e.preventDefault();
        editor.setScrollTop(targetScroll);
      }
    };

    gutterEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      gutterEl.removeEventListener("wheel", handleWheel);
    };
  }, [gutterRef, editor]);
}
