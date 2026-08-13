/**
 * VideoPreview — native browser playback for an Explorer video tab.
 *
 * The player never buffers media in JavaScript. A short-lived playback ticket
 * is exchanged for a capability URL and attached directly to one native video
 * element. Downloads deliberately use a separate ticket and lifecycle.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Film, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { issueVideoTicket } from "@/api/video-tickets.js";
import { startVideoDownload } from "@/lib/start-video-download.js";
import {
  getProfileChangeVersion,
  subscribeToProfileChanges,
} from "@/api/server-config.js";

type MediaState = "loading" | "ready" | "buffering" | "seeking" | "error";
type MediaTicketErrorCode =
  | "MEDIA_SESSION_UNSUPPORTED"
  | "INSECURE_MEDIA_SERVER";

interface VideoPreviewProps {
  project: string;
  path: string;
  fileName: string;
  mime?: string;
}

interface VideoPlaybackHandle {
  purpose: "playback";
  url: string;
  expiresAt: number;
  revoke: () => Promise<void> | void;
}

const mediaStateCopy: Record<MediaState, string> = {
  loading: "Preparing video preview…",
  ready: "Ready to play",
  buffering: "Buffering video…",
  seeking: "Seeking…",
  error: "Playback unavailable",
};

const mediaTicketErrorCopy: Record<
  MediaTicketErrorCode,
  { title: string; description: string }
> = {
  MEDIA_SESSION_UNSUPPORTED: {
    title: "Browser media access is unavailable",
    description:
      "Use a supported Chromium or Microsoft Edge browser. Allow site data for this server and turn off privacy blocking, then retry.",
  },
  INSECURE_MEDIA_SERVER: {
    title: "Secure connection required",
    description:
      "This media server must use HTTPS before the preview or download can load. Update the server address, then retry.",
  },
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function mediaTicketErrorCode(error: unknown): MediaTicketErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const { code } = error as { code?: unknown };
  return code === "MEDIA_SESSION_UNSUPPORTED" ||
    code === "INSECURE_MEDIA_SERVER"
    ? code
    : null;
}

function revokePlayback(handle: VideoPlaybackHandle | null): void {
  if (!handle) return;
  // Revoke is intentionally best-effort: cleanup must never prevent a new
  // selection/retry from mounting its own native source.
  void Promise.resolve(handle.revoke()).catch(() => undefined);
}

function playbackErrorMessage(video: HTMLVideoElement): string {
  switch (video.error?.code) {
    case 2:
      return "The video could not be reached. Retry or download it directly.";
    case 3:
    case 4:
      return "This browser cannot decode the video container or codec. Download it or open it in an external player.";
    default:
      return "The video could not be played. Retry or download it directly.";
  }
}

export function VideoPreview({
  project,
  path,
  fileName,
  mime,
}: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const issueControllerRef = useRef<AbortController | null>(null);
  const playbackRef = useRef<VideoPlaybackHandle | null>(null);
  const generationRef = useRef(0);
  const sourceGenerationRef = useRef(0);
  const sourceUrlRef = useRef<string | null>(null);
  const [mediaState, setMediaState] = useState<MediaState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ticketErrorCode, setTicketErrorCode] =
    useState<MediaTicketErrorCode | null>(null);
  const [ticketErrorAction, setTicketErrorAction] = useState<
    "playback" | "download" | null
  >(null);
  const [retryToken, setRetryToken] = useState(0);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadPendingRef = useRef(false);

  const teardownPlayback = useCallback(
    (videoOverride: HTMLVideoElement | null = videoRef.current) => {
      issueControllerRef.current?.abort();
      issueControllerRef.current = null;

      const video = videoOverride;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        // load() cancels a pending native request after removing the source.
        try {
          video.load();
        } catch {
          // A detached/jsdom media element may not implement load().
        }
      }

      sourceGenerationRef.current = 0;
      sourceUrlRef.current = null;
      const oldPlayback = playbackRef.current;
      playbackRef.current = null;
      revokePlayback(oldPlayback);
    },
    [],
  );

  useEffect(() => {
    const profileVersion = getProfileChangeVersion();
    const generation = ++generationRef.current;
    const cleanupVideo = videoRef.current;
    // The previous effect cleanup normally ran first; this is also safe when
    // React replays effects in development StrictMode.
    teardownPlayback();
    setMediaState("loading");
    setErrorMessage(null);
    setTicketErrorCode(null);
    setTicketErrorAction(null);

    const controller = new AbortController();
    issueControllerRef.current = controller;

    void issueVideoTicket(project, path, "playback", controller.signal)
      .then((handle) => {
        // issueVideoTicket returns a purpose-discriminated handle. Keep this
        // guard even though this call requests playback: it prevents a client
        // regression from attaching a download capability to the player.
        if (handle.purpose !== "playback") return;
        const video = videoRef.current;
        const stale =
          generationRef.current !== generation ||
          controller.signal.aborted ||
          getProfileChangeVersion() !== profileVersion ||
          !video;
        if (stale) {
          revokePlayback(handle);
          return;
        }

        playbackRef.current = handle;
        sourceGenerationRef.current = generation;
        sourceUrlRef.current = handle.url;
        // This must be set before src: native media then sends the session
        // cookie without exposing the opaque ticket to JavaScript.
        video.crossOrigin = "use-credentials";
        video.src = handle.url;
        video.load();
        setMediaState("loading");
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          isAbortError(error)
        ) {
          return;
        }
        setMediaState("error");
        const code = mediaTicketErrorCode(error);
        setTicketErrorCode(code);
        setTicketErrorAction(code ? "playback" : null);
        // Never expose response text, ticket values, paths, or authorization
        // details. Typed compatibility errors receive safe remediation copy.
        setErrorMessage(
          code
            ? mediaTicketErrorCopy[code].title
            : "A playback ticket could not be issued. Retry or download it directly.",
        );
      });

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      teardownPlayback(cleanupVideo);
    };
  }, [path, project, retryToken, teardownPlayback]);

  useEffect(
    () =>
      subscribeToProfileChanges(() => {
        // Restart playback against the new profile. Download state is kept
        // independent and is not cancelled by this player refresh.
        setRetryToken((value) => value + 1);
      }),
    [],
  );

  const acceptsMediaEvent = useCallback(() => {
    const video = videoRef.current;
    const sourceUrl = sourceUrlRef.current;
    return Boolean(
      video &&
      sourceUrl &&
      sourceGenerationRef.current === generationRef.current &&
      video.currentSrc === sourceUrl,
    );
  }, []);

  const onMediaError = useCallback(() => {
    const video = videoRef.current;
    if (!video || !acceptsMediaEvent()) return;
    setTicketErrorCode(null);
    setTicketErrorAction(null);
    setMediaState("error");
    setErrorMessage(playbackErrorMessage(video));
  }, [acceptsMediaEvent]);

  const handleDownload = useCallback(async () => {
    if (downloadPendingRef.current) return;
    downloadPendingRef.current = true;
    setDownloadPending(true);
    setDownloadError(null);
    setTicketErrorCode(null);
    setTicketErrorAction(null);
    try {
      // This intentionally issues a fresh download ticket. It does not touch
      // or await the playback handle/source currently used by the player.
      await startVideoDownload(project, path);
    } catch (error: unknown) {
      const code = mediaTicketErrorCode(error);
      setTicketErrorCode(code);
      setTicketErrorAction(code ? "download" : null);
      setDownloadError(
        code ? null : "Download could not be started. Please try again.",
      );
    } finally {
      downloadPendingRef.current = false;
      setDownloadPending(false);
    }
  }, [path, project]);

  return (
    <section
      aria-labelledby="video-preview-title"
      className="h-full min-h-0 overflow-auto bg-[var(--color-surface)] px-3 py-4 sm:px-5"
    >
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 rounded-md border border-blue-400/20 bg-blue-400/10 p-1.5 text-blue-300">
              <Film aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1
                id="video-preview-title"
                title={fileName}
                className="truncate text-sm font-medium text-[var(--color-text)]"
              >
                {fileName}
              </h1>
              <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                Native browser preview{mime ? ` · ${mime}` : ""}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={downloadPending}
            disabled={downloadPending || ticketErrorCode !== null}
            onClick={() => void handleDownload()}
            aria-label={`Download ${fileName}`}
            title={
              ticketErrorCode
                ? "Downloads require a supported browser and secure HTTPS server."
                : undefined
            }
          >
            {!downloadPending && (
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {downloadPending ? "Starting download…" : "Download"}
          </Button>
        </header>

        <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-black/80 p-1 shadow-inner sm:min-h-[260px]">
          <video
            ref={videoRef}
            controls
            preload="metadata"
            playsInline
            crossOrigin="use-credentials"
            aria-label={`Video preview: ${fileName}`}
            className="max-h-[min(70vh,720px)] w-full max-w-full object-contain"
            onLoadStart={() => {
              if (acceptsMediaEvent()) setMediaState("loading");
            }}
            onLoadedMetadata={() => {
              if (acceptsMediaEvent()) setMediaState("ready");
            }}
            onCanPlay={() => {
              if (acceptsMediaEvent()) setMediaState("ready");
            }}
            onWaiting={() => {
              if (acceptsMediaEvent()) setMediaState("buffering");
            }}
            onPlaying={() => {
              if (acceptsMediaEvent()) setMediaState("ready");
            }}
            onSeeking={() => {
              if (acceptsMediaEvent()) setMediaState("seeking");
            }}
            onSeeked={() => {
              if (acceptsMediaEvent()) setMediaState("ready");
            }}
            onError={onMediaError}
          />
          {mediaState === "loading" && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
              <Loader2
                aria-hidden="true"
                className="h-5 w-5 animate-spin text-white/70 motion-reduce:animate-none"
              />
            </div>
          )}
        </div>

        <div
          className="flex min-h-5 items-start gap-2 text-xs"
          aria-live="polite"
          aria-atomic="true"
        >
          {mediaState === "error" ? (
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300"
            />
          ) : (
            <span
              aria-hidden="true"
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300"
            />
          )}
          <span
            className={
              mediaState === "error"
                ? "text-amber-200"
                : "text-[var(--color-text-muted)]"
            }
          >
            {errorMessage ?? mediaStateCopy[mediaState]}
          </span>
        </div>

        {(mediaState === "error" || downloadError || ticketErrorCode) && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2.5"
            role={ticketErrorCode ? "alert" : undefined}
          >
            {ticketErrorCode && (
              <div className="w-full space-y-1">
                <p className="text-sm font-medium text-amber-100">
                  {mediaTicketErrorCopy[ticketErrorCode].title}
                </p>
                <p className="max-w-2xl text-xs leading-5 text-amber-200">
                  {mediaTicketErrorCopy[ticketErrorCode].description}
                </p>
              </div>
            )}
            {(mediaState === "error" || ticketErrorCode) && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (ticketErrorAction === "download") {
                    void handleDownload();
                    return;
                  }
                  setRetryToken((value) => value + 1);
                }}
                aria-label={
                  ticketErrorAction === "download"
                    ? "Retry video download"
                    : "Retry video playback"
                }
              >
                <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            {downloadError && (
              <span className="text-xs text-amber-200">{downloadError}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
