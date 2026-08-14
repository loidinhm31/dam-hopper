import { useEffect, useMemo, useState } from "react";
import { getActiveProfile, type ServerProfile } from "@/api/server-config.js";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import { useSshForward } from "@/hooks/use-ssh-forward.js";
import {
  getSshForwardErrorPresentation,
  toSshForwardError,
} from "@/lib/ssh-forward-error-copy.js";
import type {
  HostKeyChallenge,
  SshForwardError,
  SshForwardProfile,
  SshForwardSnapshot,
  WireCounter,
} from "@/lib/ssh-forward-host.js";

export interface TrustTarget {
  profile: SshForwardProfile;
  challenge?: HostKeyChallenge;
  errorCode?: SshForwardError["code"];
}

export function useSshForwardPageController() {
  const { host, environment } = useSshForwardHost();
  const forwarding = useSshForward();
  const [formOpen, setFormOpen] = useState(false);
  const [formExisting, setFormExisting] = useState<SshForwardProfile | null>(
    null,
  );
  const [formSource, setFormSource] = useState<ServerProfile | null>(null);
  const [trustTarget, setTrustTarget] = useState<TrustTarget | null>(null);
  const [trustApproved, setTrustApproved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = forwarding.refresh;
  useEffect(() => {
    if (host && environment.kind === "nativeDesktop") void refresh();
  }, [environment.kind, host, refresh]);
  const runtimes = useMemo(
    () =>
      new Map(
        (forwarding.snapshot?.runtimes ?? []).map((runtime) => [
          runtime.profileId,
          runtime,
        ]),
      ),
    [forwarding.snapshot?.runtimes],
  );
  const challenges = useMemo(
    () =>
      new Map(
        (forwarding.snapshot?.hostKeyChallenges ?? []).map((challenge) => [
          challenge.profileId,
          challenge,
        ]),
      ),
    [forwarding.snapshot?.hostKeyChallenges],
  );
  const profileGeneration = (profileId: string): WireCounter =>
    runtimes.get(profileId)?.generation ?? ("0" as WireCounter);
  const openNew = () => {
    setNotice(null);
    setFormOpen(true);
    setFormExisting(null);
    setFormSource(getActiveProfile());
  };
  const openEdit = (profile: SshForwardProfile) => {
    setNotice(null);
    setFormOpen(true);
    setFormExisting(profile);
    setFormSource(null);
  };
  const closeForm = () => {
    if (!forwarding.pending) {
      setFormOpen(false);
      setFormExisting(null);
      setFormSource(null);
    }
  };
  const run = async (operation: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await operation();
    } catch (error) {
      setNotice(getSshForwardErrorPresentation(error).message);
    }
  };
  const openTrust = (
    profile: SshForwardProfile,
    errorCode?: SshForwardError["code"],
    challenge?: HostKeyChallenge,
  ) => {
    setTrustApproved(false);
    setTrustTarget({ profile, errorCode, challenge });
  };
  const lifecycle = async (
    profile: SshForwardProfile,
    operation: () => Promise<SshForwardSnapshot>,
  ) => {
    try {
      const result = await operation();
      const runtime = result.runtimes.find(
        (candidate) => candidate.profileId === profile.id,
      );
      const challenge =
        result.hostKeyChallenges.find(
          (candidate) => candidate.profileId === profile.id,
        ) ?? challenges.get(profile.id);
      if (
        runtime?.errorCode === "HOST_KEY_APPROVAL_REQUIRED" ||
        runtime?.errorCode === "HOST_KEY_CHANGED" ||
        runtime?.errorCode === "HOST_KEY_ALGORITHM_CHANGED"
      )
        openTrust(profile, runtime.errorCode, challenge);
    } catch (error) {
      const parsed = toSshForwardError(error);
      setNotice(getSshForwardErrorPresentation(parsed).message);
      if (
        parsed.code === "HOST_KEY_APPROVAL_REQUIRED" ||
        parsed.code === "HOST_KEY_CHANGED" ||
        parsed.code === "HOST_KEY_ALGORITHM_CHANGED"
      )
        openTrust(profile, parsed.code, challenges.get(profile.id));
    }
  };
  const saveProfile = async (profile: SshForwardProfile) => {
    if (formExisting)
      await run(async () => {
        await forwarding.updateProfile(
          profile.id,
          profileGeneration(profile.id),
          profile,
        );
        closeForm();
      });
    else
      await run(async () => {
        await forwarding.createProfile(profile);
        closeForm();
      });
  };
  const deleteProfile = (profile: SshForwardProfile) => {
    if (window.confirm(`Delete SSH forward “${profile.name}”?`))
      void run(() =>
        forwarding.deleteProfile(profile.id, profileGeneration(profile.id)),
      );
  };
  const approveHost = () => {
    if (!trustTarget?.challenge) return;
    void run(async () => {
      await forwarding.approveHost(
        trustTarget.profile.id,
        profileGeneration(trustTarget.profile.id),
        trustTarget.challenge!.challengeId,
        trustTarget.challenge!.algorithm,
        trustTarget.challenge!.fingerprint,
      );
      setTrustApproved(true);
    });
  };
  return {
    host,
    environment,
    forwarding,
    runtimes,
    challenges,
    formOpen,
    formExisting,
    formSource,
    trustTarget,
    trustApproved,
    notice,
    setNotice,
    openNew,
    openEdit,
    closeForm,
    run,
    lifecycle,
    saveProfile,
    deleteProfile,
    approveHost,
    openTrust,
    setTrustTarget,
    profileGeneration,
  };
}
