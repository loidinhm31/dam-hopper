import { Plus, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button } from "@/components/atoms/Button.js";
import { SshForwardProfileCard } from "@/components/molecules/SshForwardProfileCard.js";
import { SshForwardProfileDialog } from "@/components/organisms/SshForwardProfileDialog.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { SshHostKeyApprovalDialog } from "@/components/organisms/SshHostKeyApprovalDialog.js";
import { useSshForwardPageController } from "@/hooks/use-ssh-forward-page-controller.js";
import { getSshForwardErrorPresentation } from "@/lib/ssh-forward-error-copy.js";

export function SshForwardingPage() {
  const controller = useSshForwardPageController();
  const { host, environment, forwarding, runtimes, challenges } = controller;
  const errorPresentation = forwarding.error
    ? getSshForwardErrorPresentation(forwarding.error)
    : null;
  if (host === null || environment.kind !== "nativeDesktop") return null;

  return (
    <AppLayout
      title="SSH Forwarding"
      actions={
        <Button size="sm" variant="primary" onClick={controller.openNew}>
          <Plus className="h-3.5 w-3.5" /> Add SSH forward
        </Button>
      }
    >
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Desktop-local SSH forwarding to services on the SSH server’s
            127.0.0.1 only. Saved endpoints are independent from HTTP server
            profile edits.
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void forwarding.refresh()}
            loading={forwarding.pendingAction === "snapshot"}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {controller.notice ? (
          <p
            role="alert"
            className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]"
          >
            {controller.notice}
          </p>
        ) : null}
        {errorPresentation ? (
          <p
            role="alert"
            className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]"
          >
            {errorPresentation.message}
          </p>
        ) : null}
        {!forwarding.snapshot && !forwarding.error ? (
          <p
            role="status"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs text-[var(--color-text-muted)]"
          >
            Loading native forwarding state…
          </p>
        ) : null}
        {forwarding.snapshot?.profiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center">
            <p className="text-sm text-[var(--color-text)]">
              No SSH forwards in this server scope.
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Add one explicit reviewed endpoint to expose a remote loopback
              service locally.
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="primary"
              onClick={controller.openNew}
            >
              <Plus className="h-3.5 w-3.5" /> Add SSH forward
            </Button>
          </div>
        ) : null}
        <div className="space-y-4">
          {forwarding.snapshot?.profiles.map((profile) => {
            const runtime = runtimes.get(profile.id);
            const challenge = challenges.get(profile.id);
            return (
              <SshForwardProfileCard
                key={profile.id}
                profile={profile}
                runtime={runtime}
                challenge={challenge}
                pending={forwarding.pending}
                onStart={() =>
                  void controller.lifecycle(profile, "start", () =>
                    forwarding.start(
                      profile.id,
                      controller.profileGeneration(profile.id),
                    ),
                  )
                }
                onStop={() =>
                  void controller.run(() =>
                    forwarding.stop(
                      profile.id,
                      controller.profileGeneration(profile.id),
                    ),
                  )
                }
                onRestart={() =>
                  void controller.lifecycle(profile, "restart", () =>
                    forwarding.restart(
                      profile.id,
                      controller.profileGeneration(profile.id),
                    ),
                  )
                }
                onEdit={() => controller.openEdit(profile)}
                onDelete={() => controller.deleteProfile(profile)}
                onTrust={() =>
                  controller.openTrust(profile, runtime?.errorCode, challenge)
                }
                onBlockedAction={() =>
                  controller.setNotice(
                    "Stop the forward before editing or deleting it.",
                  )
                }
              />
            );
          })}
        </div>
      </div>
      {forwarding.snapshot && controller.formOpen ? (
        <SshForwardProfileDialog
          open
          scopeId={forwarding.snapshot.scopeId}
          existing={controller.formExisting}
          sourceProfile={controller.formSource}
          pending={forwarding.pending}
          error={forwarding.error}
          onClose={controller.closeForm}
          onSubmit={(profile) => void controller.saveProfile(profile)}
          onListKeys={forwarding.listKeys}
        />
      ) : null}
      {controller.trustTarget ? (
        <SshHostKeyApprovalDialog
          open
          profile={controller.trustTarget.profile}
          challenge={controller.trustTarget.challenge}
          errorCode={controller.trustTarget.errorCode}
          metadata={forwarding.snapshot?.trustRepair}
          pending={forwarding.pending}
          approved={controller.trustApproved}
          onApprove={controller.approveHost}
          onClose={() => controller.setTrustTarget(null)}
        />
      ) : null}
      {controller.passphraseTarget ? (
        <PassphraseDialog
          open
          title={`Unlock SSH key for ${controller.passphraseTarget.profile.name}`}
          description={`SSH could not authenticate ${controller.passphraseTarget.profile.sshUser}@${controller.passphraseTarget.profile.sshHost}. Use the configured key or choose username and password, like VS Code. Credentials are used only in memory.`}
          submitLabel="Unlock and retry"
          allowSaveForLater={false}
          requireKeySelection
          keyOptions={controller.passphraseTarget.keys.map((key) => ({
            value: key.keyId,
            label: `${key.label} · ${key.algorithm}`,
          }))}
          loading={controller.passphraseLoading}
          error={controller.passphraseError ?? undefined}
          onSubmit={(passphrase, keyId) =>
            void controller.submitPassphrase(passphrase, keyId)
          }
          passwordAuth={{
            username: controller.passphraseTarget.profile.sshUser,
            onSubmit: (username, password) =>
              void controller.submitPassword(username, password),
          }}
          onCancel={controller.cancelPassphrase}
        />
      ) : null}
    </AppLayout>
  );
}
