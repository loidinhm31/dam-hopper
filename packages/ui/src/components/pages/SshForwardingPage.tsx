import { useRef } from "react";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { SshConnectionCard } from "@/components/molecules/SshConnectionCard.js";
import { SshConnectionDialog } from "@/components/organisms/SshConnectionDialog.js";
import { SshForwardRuleDialog } from "@/components/organisms/SshForwardRuleDialog.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { SshHostKeyApprovalDialog } from "@/components/organisms/SshHostKeyApprovalDialog.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";
import { useSshForwardPageController } from "@/hooks/use-ssh-forward-page-controller.js";
import { getSshForwardErrorPresentation } from "@/lib/ssh-forward-error-copy.js";
import { isSshForwardRuleRuntimeActive } from "@/lib/ssh-forward-host.js";

const MAX_SAVED_CONNECTIONS = 64;
const MAX_ACTIVE_CONNECTIONS = 16;
const MAX_ENABLED_RULES = 64;

export function SshForwardingPage() {
  const controller = useSshForwardPageController();
  const { host, environment, forwarding } = controller;
  const errorPresentation = forwarding.error
    ? getSshForwardErrorPresentation(forwarding.error)
    : null;
  const notice =
    controller.notice && controller.notice !== errorPresentation?.message
      ? controller.notice
      : null;
  if (host === null || environment.kind !== "nativeDesktop") return null;

  const rules = forwarding.snapshot?.rules ?? [];
  const rulesByConnection = new Map<string, typeof rules>();
  for (const rule of rules) {
    const group = rulesByConnection.get(rule.connectionProfileId) ?? [];
    group.push(rule);
    rulesByConnection.set(rule.connectionProfileId, group);
  }
  const orphanRules = rules.filter(
    (rule) =>
      !controller.connections.some(
        (connection) => connection.id === rule.connectionProfileId,
      ),
  );
  const enabledRuleCount = rules.filter(
    (rule) =>
      rule.desiredEnabled ||
      forwarding.snapshot?.ruleRuntimes.some(
        (runtime) =>
          runtime.ruleId === rule.id &&
          isSshForwardRuleRuntimeActive(runtime.state),
      ),
  ).length;
  const activeConnectionCount = Array.from(
    controller.connectionRuntimes.values(),
  ).filter((runtime) => runtime.state !== "disconnected").length;
  const stateBlocked = orphanRules.length > 0;
  const connectionLimitReached =
    controller.connections.length >= MAX_SAVED_CONNECTIONS;
  const enabledRuleLimitReached = enabledRuleCount >= MAX_ENABLED_RULES;

  return (
    <AppLayout
      title="SSH Forwarding"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={controller.openNewConnection}
          disabled={
            forwarding.pending || stateBlocked || connectionLimitReached
          }
          title={
            connectionLimitReached
              ? "The 64 saved-connection limit is reached"
              : undefined
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add connection
        </Button>
      }
    >
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="max-w-3xl text-xs text-[var(--color-text-muted)]">
              Desktop-local SSH forwarding to services on the SSH server&apos;s
              <code className="mx-1 font-mono text-[var(--color-text)]">
                127.0.0.1
              </code>
              only. Save connections without secrets. Configure forwarding rules
              at any time, then Connect to start the SSH session and desired
              rules.
            </p>
            <div
              className="mt-2 flex flex-wrap gap-2"
              aria-label="SSH forwarding limits"
            >
              <Badge variant="neutral">
                {controller.connections.length}/{MAX_SAVED_CONNECTIONS} saved
                connections
              </Badge>
              <Badge
                variant={
                  activeConnectionCount >= MAX_ACTIVE_CONNECTIONS
                    ? "danger"
                    : "neutral"
                }
              >
                {activeConnectionCount}/{MAX_ACTIVE_CONNECTIONS} active
                connections
              </Badge>
              <Badge
                variant={
                  enabledRuleCount >= MAX_ENABLED_RULES ? "danger" : "neutral"
                }
              >
                {enabledRuleCount}/{MAX_ENABLED_RULES} enabled rules
              </Badge>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void forwarding.refresh()}
            loading={forwarding.pendingAction === "snapshot"}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        <aside
          role="note"
          className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-text-muted)]"
        >
          <strong className="text-[var(--color-text)]">
            Local process access is not isolated.
          </strong>{" "}
          Any process on this computer can connect to a configured
          <code className="mx-1 font-mono text-[var(--color-text)]">
            127.0.0.1
          </code>
          listener. Loopback prevents LAN access but does not isolate other
          local processes.
        </aside>

        {notice ? (
          <p
            role="alert"
            className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]"
          >
            {notice}
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
        {orphanRules.length ? (
          <p
            role="alert"
            className="rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]"
          >
            Forwarding state is inconsistent: {orphanRules.length} rule
            {orphanRules.length === 1 ? "" : "s"} reference a missing
            connection. Refresh before changing forwarding state.
          </p>
        ) : null}

        {forwarding.snapshot && controller.connections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-[var(--color-primary)]" />
            <p className="mt-3 text-sm text-[var(--color-text)]">
              No SSH connections in this DamHopper scope.
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Add a reviewed credential-free endpoint and forwarding rules,
              then Connect to verify trust and authentication.
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="primary"
              onClick={controller.openNewConnection}
              disabled={
                forwarding.pending || stateBlocked || connectionLimitReached
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add connection
            </Button>
          </div>
        ) : null}

        <div className="space-y-4">
          {controller.connections.map((connection) => {
            const runtime = controller.connectionRuntimes.get(connection.id);
            return (
              <SshConnectionCard
                key={connection.id}
                connection={connection}
                runtime={runtime}
                credential={controller.credentials.get(connection.id)}
                challenge={controller.challenges.get(connection.id)}
                rules={rulesByConnection.get(connection.id) ?? []}
                ruleRuntimes={controller.ruleRuntimes}
                pending={forwarding.pending || stateBlocked}
                enabledRuleLimitReached={enabledRuleLimitReached}
                onConnect={() => void controller.connect(connection)}
                onDisconnect={() =>
                  void controller.requestDisconnect(connection)
                }
                onEdit={() => controller.openEditConnection(connection)}
                onDelete={() => controller.requestDeleteConnection(connection)}
                onForget={() => controller.requestForgetCredential(connection)}
                onTrust={() =>
                  controller.openTrust(
                    connection,
                    runtime?.errorCode,
                    controller.challenges.get(connection.id),
                  )
                }
                onAddRule={() => controller.openNewRule(connection)}
                onEditRule={(rule) => controller.openEditRule(connection, rule)}
                onDeleteRule={(rule) =>
                  controller.requestDeleteRule(connection, rule)
                }
                onSetRuleEnabled={(rule, enabled) =>
                  void controller.setRuleEnabled(connection, rule, enabled)
                }
                onBlockedAction={controller.setNotice}
              />
            );
          })}
        </div>
      </div>

      {controller.connectionFormOpen ? (
        <SshConnectionDialog
          open
          existing={controller.connectionFormExisting}
          sourceProfile={controller.connectionFormSource}
          pending={forwarding.pending}
          error={forwarding.error}
          onClose={controller.closeConnectionForm}
          onSubmit={(draft) => void controller.saveConnection(draft)}
          onListKeys={forwarding.listKeys}
        />
      ) : null}
      {controller.ruleFormOpen && controller.ruleFormConnection ? (
        <SshForwardRuleDialog
          open
          connection={controller.ruleFormConnection}
          existing={controller.ruleFormExisting}
          pending={forwarding.pending}
          error={forwarding.error}
          onClose={controller.closeRuleForm}
          onSubmit={(draft) => void controller.saveRule(draft)}
        />
      ) : null}
      {controller.trustTarget ? (
        <SshHostKeyApprovalDialog
          open
          connection={controller.trustTarget.connection}
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
          key={controller.passphraseTarget.connection.id}
          title={`Credentials for ${controller.passphraseTarget.connection.name}`}
          description={`SSH could not authenticate ${controller.passphraseTarget.connection.sshUser}@${controller.passphraseTarget.connection.sshHost}. ${controller.passphraseTarget.connection.auth.mode === "agent" ? "Enter username and password, or choose a local SSH key." : "Enter the passphrase for the configured SSH key."} Credentials are used only for this explicit Connect attempt unless you keep the default 30-day vault option.`}
          submitLabel="Unlock and connect"
          allowSaveForLater
          saveForLaterAuth={
            controller.passphraseTarget.connection.auth.mode === "agent"
              ? "password"
              : "key"
          }
          defaultSaveForLater
          requireKeySelection
          keyOptions={controller.passphraseTarget.keys.map((key) => ({
            value: key.keyId,
            label: `${key.label} · ${key.algorithm}`,
          }))}
          loading={controller.passphraseLoading}
          error={controller.passphraseError ?? undefined}
          onSubmit={(passphrase, keyId, remember) =>
            void controller.submitPassphrase(passphrase, keyId, remember)
          }
          passwordAuth={
            controller.passphraseTarget.connection.auth.mode === "agent"
              ? {
                  username: controller.passphraseTarget.connection.sshUser,
                  onSubmit: (username, password, rememberForDays) =>
                    void controller.submitPassword(
                      username,
                      password,
                      rememberForDays,
                    ),
                }
              : undefined
          }
          onCancel={controller.cancelPassphrase}
        />
      ) : null}
      {controller.confirmation ? (
        <SshForwardConfirmationDialog
          title={controller.confirmation.title}
          message={controller.confirmation.message}
          action={
            controller.confirmation.kind === "forgetCredential"
              ? "Forget"
              : controller.confirmation.kind === "disconnect"
                ? "Disconnect"
                : "Delete"
          }
          pending={forwarding.pending}
          onConfirm={() => void controller.confirmAction()}
          onCancel={controller.cancelConfirmation}
        />
      ) : null}
    </AppLayout>
  );
}

function SshForwardConfirmationDialog({
  title,
  message,
  action,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  action: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const firstAction = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap(true, pending, onCancel, firstAction);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div
        ref={dialogRef}
        className="dialog-viewport-fit relative w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-confirm-title"
        aria-describedby="ssh-confirm-description"
      >
        <h2
          id="ssh-confirm-title"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          {title}
        </h2>
        <p
          id="ssh-confirm-description"
          className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]"
        >
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <button
            ref={firstAction}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50 ${action === "Delete" ? "bg-[var(--color-danger)]/80 hover:bg-[var(--color-danger)]" : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]"}`}
          >
            {pending ? "Working…" : action}
          </button>
        </div>
      </div>
    </div>
  );
}
