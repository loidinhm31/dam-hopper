/**
 * LargeFileViewer — read-only viewer for files ≥5 MB.
 *
 * Fetches 64 KB chunks on demand as the user scrolls, using an
 * IntersectionObserver sentinel at the bottom of the list.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import {
  isProjectTargetError,
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";

const CHUNK_BYTES = 64 * 1024; // 64 KB

interface LargeFileViewerProps {
  project: string;
  target?: ProjectTargetInput;
  path: string;
  fileName: string;
  size: number;
  onTargetUnavailable?: () => void;
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function LargeFileViewer({
  project,
  target,
  path,
  fileName,
  size,
  onTargetUnavailable,
}: LargeFileViewerProps) {
  const targetRef = useMemo(
    () => normalizeProjectTarget(target ?? project),
    [project, target],
  );
  const targetKey = projectTargetCacheKey(targetRef);
  const targetIdentity = `${targetRef.project}::${targetKey}`;
  const [lines, setLines] = useState<string[]>([]);
  const [loadedBytes, setLoadedBytes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchingRef = useRef(false);
  const generationRef = useRef(0);
  const decoderRef = useRef<TextDecoder | null>(null);
  const onTargetUnavailableRef = useRef(onTargetUnavailable);

  useEffect(() => {
    onTargetUnavailableRef.current = onTargetUnavailable;
  }, [onTargetUnavailable]);

  const fetchChunk = useCallback(
    async (offset: number, generation: number) => {
      if (
        generation !== generationRef.current ||
        fetchingRef.current ||
        offset >= size
      )
        return;
      fetchingRef.current = true;
      setLoading(true);
      try {
        const t = getTransport() as WsTransport;
        const result = await t.fsRead(targetRef, path, {
          offset,
          len: CHUNK_BYTES,
        });
        if (generation !== generationRef.current) return;
        if (!result.ok) {
          if (
            isProjectTargetError(
              result.code,
              "message" in result ? result.message : undefined,
            )
          ) {
            onTargetUnavailableRef.current?.();
          }
          setError(`Read error: ${result.code}`);
          return;
        }
        const newOffset = offset + result.size;
        const isLastChunk = newOffset >= size;
        const decoder = decoderRef.current;
        if (!decoder) return;
        // stream:true buffers incomplete multi-byte chars across 64KB chunk boundaries
        const text = decoder.decode(b64ToBytes(result.content), {
          stream: !isLastChunk,
        });
        if (generation !== generationRef.current) return;
        const newLines = text.split("\n");
        setLines((prev) => [...prev, ...newLines]);
        setLoadedBytes(newOffset);
      } catch (e) {
        if (generation === generationRef.current) {
          const code =
            e && typeof e === "object" && "code" in e
              ? String((e as { code?: unknown }).code ?? "")
              : undefined;
          const message = e instanceof Error ? e.message : undefined;
          if (isProjectTargetError(code, message)) {
            onTargetUnavailableRef.current?.();
          }
          setError(e instanceof Error ? e.message : "Fetch error");
        }
      } finally {
        if (generation === generationRef.current) {
          fetchingRef.current = false;
          setLoading(false);
        }
      }
    },
    [path, size, targetRef],
  );

  // Load first chunk on mount / path change
  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    fetchingRef.current = false;
    decoderRef.current = new TextDecoder("utf-8", { fatal: false });
    setLines([]);
    setLoadedBytes(0);
    setError(null);
    void fetchChunk(0, generation);
    return () => {
      if (generationRef.current === generation) {
        generationRef.current += 1;
        fetchingRef.current = false;
      }
    };
  }, [fetchChunk, targetIdentity]);

  // IntersectionObserver: fetch next chunk when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void fetchChunk(loadedBytes, generationRef.current);
        }
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

      {error && <div className="px-3 py-2 text-xs text-red-400">{error}</div>}

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
