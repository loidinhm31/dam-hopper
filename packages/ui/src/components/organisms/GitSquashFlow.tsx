import { useRef } from "react";
import { Button } from "@/components/atoms/Button.js";
import { GitSquashDialog } from "@/components/organisms/GitSquashDialog.js";
import { GitForcePushDialog } from "@/components/organisms/GitForcePushDialog.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import type { GitSquashActions } from "@/hooks/use-git-squash.js";

/** Both surfaces publish only through the history owner's dedicated leased flow. */
export function GitSquashFlow({ squash }: { squash: GitSquashActions }) {
  const publishLauncherRef = useRef<HTMLDivElement>(null);
  const publication = squash.publication;
  return (
    <>
      {squash.success && (
        <div
          ref={publishLauncherRef}
          className="rounded border border-[var(--color-primary)]/40 p-3 text-xs leading-relaxed text-[var(--color-text)]"
        >
          <p role="status" aria-live="polite">
            {squash.success}
          </p>
          {squash.receipt && (
            <>
              <p className="mt-1 break-all">
                Squash commit: <code>{squash.receipt.targetOid}</code>
              </p>
              <p className="break-all">
                Branch tip: <code>{squash.receipt.sourceOid}</code>
              </p>
              <Button
                variant="danger"
                size="sm"
                className="mt-2 min-h-11"
                disabled={publication.state !== "closed" || squash.open}
                onClick={() => void publication.prepare()}
              >
                Publish rewritten branch
              </Button>
            </>
          )}
        </div>
      )}
      <GitSquashDialog squash={squash} />
      <PassphraseDialog {...publication.passphraseDialogProps} />
      <GitForcePushDialog
        open={
          publication.state !== "closed" &&
          !squash.open &&
          Boolean(squash.receipt)
        }
        project={squash.project}
        rootLabel={squash.rootLabel}
        scopeLabel={squash.scopeLabel}
        state={publication.state}
        preview={publication.preview}
        result={publication.result}
        error={publication.error}
        onPrepare={() => void publication.prepare()}
        onPublish={() => void publication.publish()}
        onClose={publication.close}
        onRestoreFocus={() =>
          squash.restorePublicationFocus(
            publishLauncherRef.current?.querySelector("button"),
          )
        }
      />
    </>
  );
}
