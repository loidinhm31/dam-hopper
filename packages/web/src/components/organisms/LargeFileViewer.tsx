/**
 * LargeFileViewer — read-only viewer for files ≥5 MB.
 *
 * Fetches 64 KB chunks on demand as the user scrolls, using an
 * IntersectionObserver sentinel at the bottom of the list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";

const CHUNK_BYTES = 64 * 1024; // 64 KB

// Streaming decoder: preserves incomplete multi-byte sequences across chunks
// (handles CJK, emoji, etc. that may straddle 64 KB boundaries).
const streamDecoder = new TextDecoder("utf-8", { fatal: false });

interface LargeFileViewerProps {
  project: string;
  path: string;
  fileName: string;
  size: number;
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function LargeFileViewer({ project, path, fileName, size }: LargeFileViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchingRef = useRef(false);

  const fetchChunk = useCallback(async (offset: number) => {
    if (fetchingRef.current || offset >= size) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const t = getTransport() as WsTransport;
      const result = await t.fsRead(project, path, { offset, len: CHUNK_BYTES });
      if (!result.ok) {
        setError(`Read error: ${result.code}`);
        return;
      }
      const newOffset = offset + result.size;
      const isLastChunk = newOffset >= size;
      // stream:true buffers incomplete multi-byte chars across 64KB chunk boundaries
      const text = streamDecoder.decode(b64ToBytes(result.content), { stream: !isLastChunk });
      const newLines = text.split("\n");
      setLines((prev) => [...prev, ...newLines]);
      setLoadedBytes(newOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch error");
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [project, path, size]);

  // Load first chunk on mount / path change
  useEffect(() => {
    setLines([]);
    setLoadedBytes(0);
    setError(null);
    void fetchChunk(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, path]);

  // IntersectionObserver: fetch next chunk when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void fetchChunk(loadedBytes);
      },
      { threshold: 0.1 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [fetchChunk, loadedBytes]);

  const done = loadedBytes >= size;

  return (
    <div className="h-full flex flex-col glass-card">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <FileText className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
        <span className="text-xs text-[var(--color-text)]">{fileName}</span>
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          Read-only · {(size / 1024 / 1024).toFixed(1)} MB
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      <div className="flex-1 overflow-auto font-mono text-[11px] text-[var(--color-text)]">
        {lines.map((line, i) => (
          <div key={i} className="flex min-h-[18px] px-2">
            <span className="select-none text-[var(--color-text-muted)] w-10 shrink-0 text-right pr-3">
              {i + 1}
            </span>
            <span className="whitespace-pre">{line}</span>
          </div>
        ))}

        {!done && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center gap-2 py-3 text-xs text-[var(--color-text-muted)]"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            {loading ? "Loading…" : "Scroll to load more"}
          </div>
        )}

        {done && lines.length > 0 && (
          <div className="py-2 text-center text-[10px] text-[var(--color-text-muted)] italic">
            End of file
          </div>
        )}
      </div>
    </div>
  );
}
