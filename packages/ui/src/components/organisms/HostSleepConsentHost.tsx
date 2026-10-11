import { useHostSleepConsent } from "@/hooks/use-host-sleep-consent.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { HostSleepConsentDialog } from "@/components/organisms/HostSleepConsentDialog.js";

/**
 * Always-mounted shared host for agent-free automatic sleep consent requests.
 * Observes all connected server profiles across IDE, traditional, compact, and
 * non-workspace routes without duplicating per-popover or per-terminal mounts.
 */
export function HostSleepConsentHost() {
  const cognitoActive = useCognitoModeStore((s) => s.active);
  const { queue, activeItem, otherPendingCount, approve, deny, dismiss } =
    useHostSleepConsent(true);

  if (cognitoActive || !activeItem) {
    return null;
  }

  return (
    <HostSleepConsentDialog
      item={activeItem}
      queueLength={queue.length}
      otherPendingCount={otherPendingCount}
      onApprove={approve}
      onDeny={deny}
      onDismiss={dismiss}
    />
  );
}
