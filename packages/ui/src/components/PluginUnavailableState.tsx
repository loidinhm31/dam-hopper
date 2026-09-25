import { AlertTriangle, Ban, Cable, PackageX, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";

export type PluginUnavailableReason =
  | "no-project"
  | "connection"
  | "not-visible"
  | "disabled"
  | "no-ui"
  | "incompatible"
  | "asset"
  | "bridge";

const COPY: Record<
  PluginUnavailableReason,
  { title: string; message: string; icon: typeof AlertTriangle }
> = {
  "no-project": {
    title: "Select a project",
    message: "Plugin access is scoped to the current project and worktree.",
    icon: PackageX,
  },
  connection: {
    title: "Plugin connection unavailable",
    message: "Reconnect the owning server profile to continue.",
    icon: Cable,
  },
  "not-visible": {
    title: "Plugin unavailable for this target",
    message:
      "The installation is absent or your account has no grant for the selected project target.",
    icon: ShieldAlert,
  },
  disabled: {
    title: "Plugin disabled",
    message: "This installed plugin is not active and cannot open a context.",
    icon: Ban,
  },
  "no-ui": {
    title: "Plugin has no interface",
    message: "This installation does not publish an approved UI document.",
    icon: PackageX,
  },
  incompatible: {
    title: "Plugin interface incompatible",
    message:
      "The active installation does not expose a valid digest and generation for this host.",
    icon: AlertTriangle,
  },
  asset: {
    title: "Plugin interface rejected",
    message:
      "The protected UI bytes failed an integrity, response-policy, or document-shape check.",
    icon: ShieldAlert,
  },
  bridge: {
    title: "Plugin session closed",
    message:
      "The isolated frame failed its handshake or its owner, target, or activation changed.",
    icon: Cable,
  },
};

interface PluginUnavailableStateProps {
  reason: PluginUnavailableReason;
  detail?: string;
}

export function PluginUnavailableState({
  reason,
  detail,
}: PluginUnavailableStateProps) {
  const copy = COPY[reason];
  const Icon = copy.icon;
  return (
    <section
      className="plugin-unavailable-state"
      aria-labelledby="plugin-unavailable-title"
      role="status"
      aria-live="polite"
    >
      <div className="plugin-unavailable-icon" aria-hidden="true">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h1
          id="plugin-unavailable-title"
          className="text-sm font-semibold text-[var(--color-text)]"
        >
          {copy.title}
        </h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
          {copy.message}
        </p>
        {detail ? (
          <p className="mt-2 max-w-2xl break-words text-xs text-[var(--color-warning)]">
            {detail}
          </p>
        ) : null}
        <Link
          to="/"
          className="mt-4 inline-flex min-h-11 items-center rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        >
          Return to dashboard
        </Link>
      </div>
    </section>
  );
}
