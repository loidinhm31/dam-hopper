import { useEffect, useRef, useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import type {
  SemanticDescriptorAvailability,
  SemanticTrust,
  SemanticTrustChallenge,
  SemanticTrustState,
} from "@dam-hopper/shared";
import { Button } from "@/components/atoms/Button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import type { SemanticTrustApi } from "@/api/semantic-trust.js";

interface Props {
  projectId: string;
  state: SemanticTrustState;
  api: SemanticTrustApi;
  availability?: SemanticDescriptorAvailability[];
  onChanged: (state: SemanticTrustState) => void;
}

export function SemanticTrustDialog({
  projectId,
  state,
  api,
  availability = [],
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [challenge, setChallenge] = useState<SemanticTrustChallenge | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const enabling = state.trust !== "trusted";

  useEffect(() => {
    setOpen(false);
    setChallenge(null);
    setError(null);
  }, [projectId, state.policyRevision]);

  async function begin(): Promise<void> {
    setError(null);
    if (!enabling) {
      setOpen(true);
      return;
    }
    try {
      setChallenge(await api.challenge(projectId));
      setOpen(true);
    } catch {
      setError("Trust confirmation is unavailable.");
    }
  }

  async function confirm(): Promise<void> {
    if (!challenge) return;
    setPending(true);
    setError(null);
    try {
      const next = await api.transition(
        projectId,
        "trusted",
        challenge.challenge,
      );
      onChanged(next);
      setOpen(false);
      setChallenge(null);
    } catch {
      setError("Trust confirmation expired or was rejected. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      onChanged(await api.revoke(projectId));
      setOpen(false);
    } catch {
      setError("Trust revocation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div
        className="flex items-center gap-2 text-[10px]"
        data-testid="semantic-trust-status"
      >
        {state.trust === "trusted" ? (
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <ShieldOff className="h-3.5 w-3.5 text-amber-400" />
        )}
        <span className="text-[var(--color-text-muted)]">
          Semantic: {state.trust} · policy {state.policyRevision}
        </span>
        {state.trust === "trusted" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void begin()}
          >
            Revoke
          </Button>
        ) : state.canTransition ? (
          <Button
            type="button"
            size="sm"
            onClick={(event) => {
              opener.current = event.currentTarget;
              void begin();
            }}
          >
            Enable
          </Button>
        ) : null}
      </div>
      {availability.length > 0 && (
        <div
          className="text-[10px] text-[var(--color-text-muted)]"
          data-testid="semantic-availability"
        >
          {availability.map((item) => (
            <p key={item.descriptorId}>
              {item.language}: {item.state}
              {item.reason
                ? ` (${semanticAvailabilityReason(item.reason)})`
                : ""}
            </p>
          ))}
          <p>Fixed policy: no sandbox, project commands, paths, or options.</p>
        </div>
      )}
      {error && (
        <p className="text-[10px] text-red-400" role="alert">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {enabling
                ? "Enable semantic navigation?"
                : "Revoke semantic trust?"}
            </DialogTitle>
            <DialogDescription>
              {enabling
                ? "Trusted mode enables only DamHopper's fixed, reviewed language-server initialization policy. It does not sandbox the process and does not allow project commands, paths, plugins, or options."
                : "Revocation stops affected semantic work, clears semantic results, and returns this project to restricted mode. Unsaved editor content is preserved."}
            </DialogDescription>
          </DialogHeader>
          {challenge && enabling && (
            <p className="rounded bg-[var(--color-surface-2)] p-2 text-xs">
              Confirm server challenge{" "}
              <code className="break-all">{challenge.challenge}</code>
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            {enabling ? (
              <Button
                type="button"
                loading={pending}
                disabled={pending || !challenge}
                onClick={() => void confirm()}
              >
                Confirm trust
              </Button>
            ) : (
              <Button
                type="button"
                variant="danger"
                loading={pending}
                disabled={pending}
                onClick={() => void revoke()}
              >
                Revoke trust
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function semanticAvailabilityReason(reason: string): string {
  return reason
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export function semanticTrustLabel(trust: SemanticTrust): string {
  return trust === "trusted"
    ? "Trusted"
    : trust === "revoked"
      ? "Revoked"
      : "Restricted";
}
