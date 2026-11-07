import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import type { HubTerminalMount } from "./hub-terminal-mounts-store.js";

export interface HubMountDescriptor extends HubTerminalMount {
  readonly hubWindowId?: string;
}

export interface MergeTerminalMountDescriptorsOptions {
  readonly hubMounts: readonly HubMountDescriptor[];
  readonly derived: readonly MountedSession[];
  readonly renderedKeys?: ReadonlySet<string>;
  readonly retainedKeys?: ReadonlyMap<string, string>;
  readonly isValidHubTarget?: (target: TerminalTarget) => boolean;
}

export interface MergeTerminalMountDescriptorsResult {
  readonly sessions: MountedSession[];
  readonly retainedKeys: Map<string, string>;
}

interface DescriptorGroup {
  readonly rendererId: string;
  readonly isTargeted: boolean;
  readonly target?: TerminalTarget;
  readonly ptyKey: string;
  readonly descriptors: MountedSession[];
  primarySession: MountedSession;
}

export function mergeTerminalMountDescriptors({
  hubMounts,
  derived,
  renderedKeys,
  retainedKeys,
  isValidHubTarget,
}: MergeTerminalMountDescriptorsOptions): MergeTerminalMountDescriptorsResult {
  const nextRetainedKeys = new Map<string, string>();
  const groups: DescriptorGroup[] = [];
  const groupsByRendererId = new Map<string, DescriptorGroup>();

  // Track untargeted standalone sessions by profileId::sessionId for folding (R3)
  const untargetedStandaloneByPty = new Map<string, MountedSession>();
  for (const d of derived) {
    if (!d.terminalTarget) {
      const ptyKey = `${d.profileId ?? "default"}::${d.sessionId}`;
      untargetedStandaloneByPty.set(ptyKey, d);
    }
  }

  // Helper to add or append to a group
  function registerSession(
    session: MountedSession,
    rendererId: string,
    isTargeted: boolean,
    ptyKey: string,
    target?: TerminalTarget,
  ): void {
    const existing = groupsByRendererId.get(rendererId);
    if (existing) {
      existing.descriptors.push(session);
      return;
    }
    const group: DescriptorGroup = {
      rendererId,
      isTargeted,
      target,
      ptyKey,
      descriptors: [session],
      primarySession: { ...session },
    };
    groups.push(group);
    groupsByRendererId.set(rendererId, group);
  }

  // 1. Process derived standalone sessions first (keeps derived order)
  for (const s of derived) {
    if (s.terminalTarget) {
      const rendererId = terminalTargetKey(s.terminalTarget);
      const ptyKey = `${s.terminalTarget.profileId}::${s.terminalTarget.terminalId}`;
      registerSession(s, rendererId, true, ptyKey, s.terminalTarget);
    } else {
      const ptyKey = `${s.profileId ?? "default"}::${s.sessionId}`;
      registerSession(s, ptyKey, false, ptyKey);
    }
  }

  // 2. Filter valid Hub mounts and convert to MountedSession
  for (const m of hubMounts) {
    if (isValidHubTarget && !isValidHubTarget(m.target)) {
      continue;
    }

    const ptyKey = `${m.target.profileId}::${m.target.terminalId}`;
    const rendererId = terminalTargetKey(m.target);

    // R3 Folding: A Hub descriptor whose (profileId, terminalId) matches
    // an untargeted standalone descriptor is folded into that standalone renderer
    const matchingUntargeted = untargetedStandaloneByPty.get(ptyKey);
    if (matchingUntargeted) {
      // Find the group for the untargeted standalone renderer and add this Hub descriptor's key
      const untargetedGroup = groupsByRendererId.get(ptyKey);
      if (untargetedGroup) {
        const hubPrefix = m.hubWindowId ? `hub:${m.hubWindowId}` : "hub";
        const candidateKey = `${hubPrefix}:${m.target.profileId}:${m.target.terminalId}:${m.target.incarnation}`;
        untargetedGroup.descriptors.push({
          mountKey: candidateKey,
          sessionId: m.target.terminalId,
          project: m.project,
          command: m.command,
        });
      }
      continue;
    }

    const hubPrefix = m.hubWindowId ? `hub:${m.hubWindowId}` : "hub";
    const mountKey = `${hubPrefix}:${m.target.profileId}:${m.target.terminalId}:${m.target.incarnation}`;
    const hubSession: MountedSession = {
      mountKey,
      sessionId: m.target.terminalId,
      terminalRef: {
        profileId: m.target.profileId,
        id: m.target.terminalId,
      },
      terminalTarget: m.target,
      attachPolicy: "existing-only",
      project: m.project,
      command: m.command,
      cwd: m.cwd,
      worktreePath: m.worktreePath,
      profileId: m.target.profileId,
    };

    registerSession(hubSession, rendererId, true, ptyKey, m.target);
  }

  // 3. Resolve stable mount keys (R4)
  const resultSessions: MountedSession[] = [];
  for (const group of groups) {
    const candidateKeys = group.descriptors
      .map((d) => d.mountKey)
      .filter((k): k is string => Boolean(k));

    let chosenKey: string | undefined;

    // (1) Check if any contributing descriptor was already rendered
    if (renderedKeys && renderedKeys.size > 0) {
      for (const candidate of candidateKeys) {
        if (renderedKeys.has(candidate)) {
          chosenKey = candidate;
          break;
        }
      }
    }

    // (2) Check retained identity -> key map
    if (!chosenKey && retainedKeys) {
      chosenKey = retainedKeys.get(group.rendererId);
      // Untargeted -> targeted transition: if targeted has no retained key yet,
      // allow adopting the retained key from the untargeted session for the same PTY
      if (!chosenKey && group.isTargeted) {
        const untargetedKey = retainedKeys.get(group.ptyKey);
        if (untargetedKey) {
          chosenKey = untargetedKey;
        }
      }
    }

    // (3) Fall back to first descriptor's candidate key
    if (!chosenKey) {
      chosenKey = candidateKeys[0] ?? group.rendererId;
    }

    group.primarySession.mountKey = chosenKey;
    resultSessions.push(group.primarySession);

    // Save to retained keys:
    // Targeted sessions save under terminalTargetKey only (Advisor Note 1: full target scoped,
    // do not alias different incarnations/epochs under bare ptyKey).
    // Untargeted sessions save under their untargeted ptyKey.
    nextRetainedKeys.set(group.rendererId, chosenKey);
    if (!group.isTargeted) {
      nextRetainedKeys.set(group.ptyKey, chosenKey);
    }
  }

  return {
    sessions: resultSessions,
    retainedKeys: nextRetainedKeys,
  };
}
