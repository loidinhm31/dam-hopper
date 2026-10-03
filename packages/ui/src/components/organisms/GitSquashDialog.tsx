import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import type { GitSquashActions } from "@/hooks/use-git-squash.js";

export function GitSquashDialog({ squash }: { squash: GitSquashActions }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const messageId = useId();
  const helperId = useId();
  const pending = squash.phase === "pending";
  const loading = squash.phase === "loading";
  const ready = squash.phase === "ready";
  useEffect(() => {
    if (ready && document.activeElement === titleRef.current)
      messageRef.current?.focus();
  }, [ready]);
  useEffect(() => {
    if (squash.error) errorRef.current?.focus();
  }, [squash.error]);
  return (
    <Dialog
      open={squash.open}
      onOpenChange={(open) => {
        if (!open && !pending) squash.close();
      }}
    >
      <DialogContent
        className="max-w-[560px] flex flex-col min-h-0 gap-4 text-[var(--color-text)] [&>button]:size-11 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:right-2 [&>button]:top-2 [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-[var(--color-primary)]"
        closeDisabled={pending}
        style={{
          maxWidth:
            "min(560px, calc(var(--app-viewport-width) - 1rem - var(--safe-area-left) - var(--safe-area-right)))",
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          squash.restoreFocus();
        }}
      >
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle ref={titleRef} tabIndex={-1}>
            Squash {squash.entries.length} commits
          </DialogTitle>
          <DialogDescription className="break-words text-xs leading-relaxed text-[var(--color-text)]">
            {squash.scopeLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4 text-xs leading-relaxed">
          <div>
            <p>Oldest → newest · {squash.entries.length} selected commits</p>
            <ol className="mt-1 space-y-1">
              {squash.entries.map((entry) => (
                <li key={entry.hash} className="break-words">
                  <details>
                    <summary className="min-h-11 cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]">
                      <code>{entry.hash.slice(0, 7)}</code> · {entry.message}
                    </summary>
                    <code className="break-all select-all">{entry.hash}</code>
                  </details>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 p-3">
            <p className="flex gap-2">
              <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>
                Creates one local commit and rewrites later commit IDs. Files,
                index and remote stay unchanged.
              </span>
            </p>
            <p className="mt-2">
              Uses the oldest selected author and current repository committer.
              Later descendants are also rewritten.
            </p>
            <p className="mt-2">
              If this history is shared, collaborators may need to reconcile
              history.
            </p>
            {squash.entries.some((entry) => entry.isPushed) && (
              <p className="mt-2 font-semibold">
                Includes commits already pushed upstream. Publishing is a
                separate leased confirmation.
              </p>
            )}
          </div>
          <div>
            <label htmlFor={messageId} className="block font-medium mb-2">
              Combined commit message
            </label>
            <textarea
              ref={messageRef}
              id={messageId}
              aria-describedby={helperId}
              value={squash.draft}
              onChange={(event) => squash.setDraft(event.target.value)}
              disabled={loading || pending || squash.phase === "read-error"}
              readOnly={squash.phase === "uncertain"}
              rows={8}
              className="w-full min-h-32 resize-y rounded border border-[var(--color-text-muted)] bg-[var(--color-background)] p-3 font-mono text-sm leading-relaxed focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-60"
            />
            <p id={helperId} className="mt-1">
              Full messages, oldest first. Edit the final message.
            </p>
            {(loading || pending) && (
              <p role="status" aria-live="polite" className="mt-2">
                {pending
                  ? "Squashing locally…"
                  : "Loading full commit messages…"}
              </p>
            )}
          </div>
          {squash.error && (
            <div
              ref={errorRef}
              tabIndex={-1}
              role="alert"
              className="rounded border border-[var(--color-danger)]/50 p-3 focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
            >
              <p>{squash.error}</p>
              {squash.phase === "read-error" && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 min-h-11"
                  onClick={squash.retryMessages}
                >
                  Retry full messages
                </Button>
              )}
              {(squash.phase === "blocked" || squash.phase === "uncertain") && (
                <>
                  <p className="mt-2">
                    Copy your draft if needed. Close, refresh and select again
                    before another rewrite.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 min-h-11"
                    onClick={squash.inspectHistory}
                  >
                    Inspect / refresh history
                  </Button>
                </>
              )}
            </div>
          )}
          {squash.signatureConsentRequired && (
            <div className="rounded border border-[var(--color-warning)]/50 p-3">
              <p>
                Invalidated signatures must be removed from selected commits and
                every rewritten descendant.
              </p>
              <label className="mt-2 flex min-h-11 items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={squash.allowSignatureRemoval}
                  disabled={pending}
                  onChange={(event) => squash.setConsent(event.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                />
                Allow removal of invalidated signatures
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={pending}
            onClick={squash.close}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="min-h-11"
            disabled={
              !ready ||
              !squash.draft.trim() ||
              (squash.signatureConsentRequired && !squash.allowSignatureRemoval)
            }
            onClick={() => void squash.submit()}
          >
            {pending ? "Squashing…" : "Squash locally"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
