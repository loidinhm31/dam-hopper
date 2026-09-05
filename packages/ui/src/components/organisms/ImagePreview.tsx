/**
 * ImagePreview — direct native rendering for an Explorer image tab.
 *
 * The browser owns image loading. The component only exchanges a short-lived
 * preview ticket and assigns its opaque capability URL to one native image.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Image as ImageIcon,
  Loader2,
  RotateCw,
} from "lucide-react";
import {
  issueImageTicket,
  type ImagePreviewTicket,
} from "@/api/image-tickets.js";
import { Button } from "@/components/atoms/Button.js";
import { isProjectTargetError, type ProjectTargetRef } from "@/api/client.js";
import {
  getProfileChangeVersion,
  subscribeToProfileChanges,
} from "@/api/server-config.js";

type ImageState = "loading" | "ready" | "error";
type MediaTicketErrorCode = "MEDIA_SESSION_UNSUPPORTED";

interface ImagePreviewProps {
  project: string;
  target?: ProjectTargetRef;
  path: string;
  fileName: string;
  mime?: string;
  onTargetUnavailable?: () => void;
}

const imageStateCopy: Record<ImageState, string> = {
  loading: "Preparing image preview…",
  ready: "Ready to view",
  error: "Image preview unavailable",
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
  return code === "MEDIA_SESSION_UNSUPPORTED" ? code : null;
}

function revokePreview(ticket: ImagePreviewTicket | null): void {
  if (!ticket) return;
  // Cleanup is best effort; a ticket also expires server-side.
  void Promise.resolve(ticket.revoke()).catch(() => undefined);
}

export function ImagePreview({
  project,
  target,
  path,
  fileName,
  mime,
  onTargetUnavailable,
}: ImagePreviewProps) {
  const worktreePath = target?.worktreePath;
  const targetProject = target?.project ?? project;
  const imageRef = useRef<HTMLImageElement | null>(null);
  const issueControllerRef = useRef<AbortController | null>(null);
  const previewRef = useRef<ImagePreviewTicket | null>(null);
  const generationRef = useRef(0);
  const sourceGenerationRef = useRef(0);
  const sourceUrlRef = useRef<string | null>(null);
  const [imageState, setImageState] = useState<ImageState>("loading");
  const [ticketErrorCode, setTicketErrorCode] =
    useState<MediaTicketErrorCode | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const onTargetUnavailableRef = useRef(onTargetUnavailable);

  useEffect(() => {
    onTargetUnavailableRef.current = onTargetUnavailable;
  }, [onTargetUnavailable]);

  const teardownPreview = useCallback(
    (imageOverride: HTMLImageElement | null = imageRef.current) => {
      issueControllerRef.current?.abort();
      issueControllerRef.current = null;

      // Detach the capability before revoke so a native request cannot keep
      // using a ticket while the old handle is being cleaned up.
      imageOverride?.removeAttribute("src");
      sourceGenerationRef.current = 0;
      sourceUrlRef.current = null;
      const oldPreview = previewRef.current;
      previewRef.current = null;
      revokePreview(oldPreview);
    },
    [],
  );

  useEffect(() => {
    const profileVersion = getProfileChangeVersion();
    const generation = ++generationRef.current;
    const cleanupImage = imageRef.current;
    teardownPreview();
    setImageState("loading");
    setTicketErrorCode(null);

    const controller = new AbortController();
    issueControllerRef.current = controller;

    void issueImageTicket(
      worktreePath == null
        ? targetProject
        : { project: targetProject, worktreePath },
      path,
      controller.signal,
    )
      .then((ticket) => {
        if (ticket.purpose !== "preview") {
          revokePreview(ticket);
          return;
        }

        const image = imageRef.current;
        const stale =
          generationRef.current !== generation ||
          controller.signal.aborted ||
          getProfileChangeVersion() !== profileVersion ||
          !image;
        if (stale) {
          revokePreview(ticket);
          return;
        }

        previewRef.current = ticket;
        sourceGenerationRef.current = generation;
        sourceUrlRef.current = ticket.url;
        // This must be set before src so native loading includes the bound
        // session cookie without reading or transforming the opaque URL.
        image.crossOrigin = "use-credentials";
        image.src = ticket.url;
        if (image.complete && image.naturalWidth > 0) {
          setImageState("ready");
        } else {
          setImageState("loading");
          const decode = image.decode?.();
          if (decode) {
            void decode
              .then(() => {
                if (
                  imageRef.current === image &&
                  generationRef.current === generation &&
                  sourceGenerationRef.current === generation &&
                  sourceUrlRef.current === ticket.url &&
                  image.complete &&
                  image.naturalWidth > 0
                ) {
                  setImageState("ready");
                }
              })
              .catch(() => undefined);
          }
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          isAbortError(error)
        ) {
          return;
        }
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : undefined;
        if (
          isProjectTargetError(
            code,
            error instanceof Error ? error.message : undefined,
          )
        ) {
          onTargetUnavailableRef.current?.();
        }
        setTicketErrorCode(mediaTicketErrorCode(error));
        setImageState("error");
      });

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      teardownPreview(cleanupImage);
    };
  }, [path, retryToken, targetProject, teardownPreview, worktreePath]);

  useEffect(
    () =>
      subscribeToProfileChanges(() => {
        setRetryToken((value) => value + 1);
      }),
    [],
  );

  const acceptsImageEvent = useCallback(() => {
    const image = imageRef.current;
    const sourceUrl = sourceUrlRef.current;
    return Boolean(
      image &&
      sourceUrl &&
      sourceGenerationRef.current === generationRef.current &&
      (image.currentSrc === sourceUrl || image.src === sourceUrl),
    );
  }, []);

  const handleImageError = useCallback(() => {
    if (!acceptsImageEvent()) return;
    setTicketErrorCode(null);
    setImageState("error");
  }, [acceptsImageEvent]);

  return (
    <section
      aria-labelledby="image-preview-title"
      className="h-full min-h-0 overflow-auto bg-[var(--color-surface)] px-3 py-4 sm:px-5"
    >
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4">
        <header className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 rounded-md border border-blue-400/20 bg-blue-400/10 p-1.5 text-blue-300">
              <ImageIcon aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1
                id="image-preview-title"
                title={fileName}
                className="truncate text-sm font-medium text-[var(--color-text)]"
              >
                {fileName}
              </h1>
              <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                Native browser preview{mime ? ` · ${mime}` : ""}
              </p>
            </div>
          </div>
        </header>

        <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-black/80 p-1 shadow-inner sm:min-h-[260px]">
          <img
            ref={imageRef}
            alt={`Image preview: ${fileName}`}
            decoding="async"
            crossOrigin="use-credentials"
            className="max-h-[min(calc(var(--app-viewport-height)*0.7),720px)] max-w-full object-contain"
            onLoad={() => {
              if (acceptsImageEvent()) setImageState("ready");
            }}
            onError={handleImageError}
          />
          {imageState === "loading" && (
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
          {imageState === "error" ? (
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
              imageState === "error"
                ? "text-amber-200"
                : "text-[var(--color-text-muted)]"
            }
          >
            {ticketErrorCode
              ? mediaTicketErrorCopy[ticketErrorCode].title
              : imageStateCopy[imageState]}
          </span>
        </div>

        {imageState === "error" && (
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setRetryToken((value) => value + 1)}
              aria-label="Retry image preview"
            >
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
