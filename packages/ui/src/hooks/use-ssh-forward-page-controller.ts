import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveProfile, type ServerProfile } from "@/api/server-config.js";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import { useSshForward } from "@/hooks/use-ssh-forward.js";
import {
  getSshForwardErrorPresentation,
  toSshForwardError,
} from "@/lib/ssh-forward-error-copy.js";
import { generateUUID } from "@/lib/utils.js";
import type {
  HostKeyChallenge,
  KeyInventory,
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

type LifecycleAction = "start" | "restart";

interface PassphraseTarget {
  profile: SshForwardProfile;
  action: LifecycleAction;
  keys: KeyInventory["keys"];
}

const PASSPHRASE_PROMPT_CODES = new Set<SshForwardError["code"]>([
  "AGENT_UNAVAILABLE",
  "KEY_ENCRYPTED_USE_AGENT",
  "AUTH_FAILED",
]);

export function useSshForwardPageController() {
  const { host, environment, readiness } = useSshForwardHost();
  const forwarding = useSshForward();
  const [formOpen, setFormOpen] = useState(false);
  const [formExisting, setFormExisting] = useState<SshForwardProfile | null>(
    null,
  );
  const [formSource, setFormSource] = useState<ServerProfile | null>(null);
  const [trustTarget, setTrustTarget] = useState<TrustTarget | null>(null);
  const [trustApproved, setTrustApproved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [passphraseTarget, setPassphraseTarget] =
    useState<PassphraseTarget | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseLoading, setPassphraseLoading] = useState(false);
  const lifecycleTargets = useRef(
    new Map<string, { profile: SshForwardProfile; action: LifecycleAction }>(),
  );
  const saveInFlight = useRef(false);
  const passphrasePromptInFlight = useRef(false);
  const refresh = forwarding.refresh;
  const listKeys = forwarding.listKeys;
  useEffect(() => {
    if (
      host &&
      environment.kind === "nativeDesktop" &&
      readiness === "unmanaged"
    )
      void refresh();
  }, [environment.kind, host, readiness, refresh]);
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
  const closeForm = (force = false) => {
    if (force || !forwarding.pending) {
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
  const requestPassphrase = useCallback(
    async (
      profile: SshForwardProfile,
      action: LifecycleAction,
      errorCode?: SshForwardError["code"],
    ) => {
      if (passphrasePromptInFlight.current || passphraseTarget) return;
      passphrasePromptInFlight.current = true;
      setPassphraseError(
        errorCode === "KEY_ENCRYPTED_USE_AGENT"
          ? "Unlock the encrypted local SSH key to retry this forward."
          : errorCode === "AUTH_FAILED"
            ? "SSH authentication failed. Choose a key or use username and password."
            : null,
      );
      setNotice(null);
      try {
        const inventory = await listKeys();
        const keys = inventory.keys.filter(
          (key) =>
            key.source === "local" &&
            key.encrypted &&
            (profile.auth.mode === "agent" || key.keyId === profile.auth.keyId),
        );
        setPassphraseTarget({
          profile,
          action,
          keys,
        });
      } catch (error) {
        setNotice(getSshForwardErrorPresentation(error).message);
      } finally {
        passphrasePromptInFlight.current = false;
      }
    },
    [listKeys, passphraseTarget],
  );

  const lifecycle = async (
    profile: SshForwardProfile,
    action: LifecycleAction,
    operation: () => Promise<SshForwardSnapshot>,
  ) => {
    if (lifecycleTargets.current.has(profile.id)) return;
    if (passphrasePromptInFlight.current || passphraseTarget) {
      setNotice(
        "Finish the SSH credential prompt before retrying this forward.",
      );
      return;
    }
    lifecycleTargets.current.set(profile.id, { profile, action });
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
      if (
        runtime?.errorCode &&
        PASSPHRASE_PROMPT_CODES.has(runtime.errorCode)
      ) {
        lifecycleTargets.current.delete(profile.id);
        void requestPassphrase(profile, action, runtime.errorCode);
      } else if (
        runtime &&
        runtime.state !== "starting" &&
        runtime.state !== "reconnecting"
      ) {
        lifecycleTargets.current.delete(profile.id);
      }
    } catch (error) {
      const parsed = toSshForwardError(error);
      if (PASSPHRASE_PROMPT_CODES.has(parsed.code)) {
        lifecycleTargets.current.delete(profile.id);
        void requestPassphrase(profile, action, parsed.code);
        return;
      }
      lifecycleTargets.current.delete(profile.id);
      setNotice(getSshForwardErrorPresentation(parsed).message);
      if (
        parsed.code === "HOST_KEY_APPROVAL_REQUIRED" ||
        parsed.code === "HOST_KEY_CHANGED" ||
        parsed.code === "HOST_KEY_ALGORITHM_CHANGED"
      )
        openTrust(profile, parsed.code, challenges.get(profile.id));
    }
  };

  useEffect(() => {
    for (const [profileId, target] of lifecycleTargets.current) {
      const runtime = runtimes.get(profileId);
      if (!runtime) continue;
      if (runtime.state !== "failed" || !runtime.errorCode) {
        if (runtime.state !== "starting" && runtime.state !== "reconnecting")
          lifecycleTargets.current.delete(profileId);
        continue;
      }
      lifecycleTargets.current.delete(profileId);
      if (PASSPHRASE_PROMPT_CODES.has(runtime.errorCode))
        void requestPassphrase(
          target.profile,
          target.action,
          runtime.errorCode,
        );
    }
  }, [requestPassphrase, runtimes]);

  const retryWithCredential = async (
    target: PassphraseTarget,
    loadCredential: () => Promise<SshForwardSnapshot>,
    credentialAttemptId?: string,
  ) => {
    const loaded = await loadCredential();
    const generation =
      loaded.runtimes.find((runtime) => runtime.profileId === target.profile.id)
        ?.generation ?? profileGeneration(target.profile.id);
    lifecycleTargets.current.set(target.profile.id, {
      profile: target.profile,
      action: target.action,
    });
    const retried =
      target.action === "restart"
        ? await forwarding.restart(
            target.profile.id,
            generation,
            credentialAttemptId,
          )
        : await forwarding.start(
            target.profile.id,
            generation,
            credentialAttemptId,
          );
    const runtime = retried.runtimes.find(
      (candidate) => candidate.profileId === target.profile.id,
    );
    if (runtime?.state === "failed" && runtime.errorCode) {
      lifecycleTargets.current.delete(target.profile.id);
      throw {
        code: runtime.errorCode,
        message: "",
        retryable: false,
      } satisfies SshForwardError;
    }
    if (
      runtime &&
      runtime.state !== "starting" &&
      runtime.state !== "reconnecting"
    )
      lifecycleTargets.current.delete(target.profile.id);
    setPassphraseTarget(null);
  };

  const submitPassphrase = async (passphrase: string, keyId?: string) => {
    const target = passphraseTarget;
    if (!target || !keyId) return;
    setPassphraseLoading(true);
    setPassphraseError(null);
    setNotice(null);
    try {
      await retryWithCredential(target, () =>
        forwarding.loadKey(target.profile.id, keyId, passphrase),
      );
    } catch (error) {
      setPassphraseError(getSshForwardErrorPresentation(error).message);
    } finally {
      setPassphraseLoading(false);
    }
  };

  const submitPassword = async (username: string, password: string) => {
    const target = passphraseTarget;
    if (!target || !username.trim() || !password) return;
    const credentialAttemptId = generateUUID();
    setPassphraseLoading(true);
    setPassphraseError(null);
    setNotice(null);
    try {
      await retryWithCredential(
        target,
        () =>
          forwarding.loadPassword(
            target.profile.id,
            username.trim(),
            password,
            credentialAttemptId,
          ),
        credentialAttemptId,
      );
    } catch (error) {
      setPassphraseError(getSshForwardErrorPresentation(error).message);
    } finally {
      setPassphraseLoading(false);
    }
  };

  const cancelPassphrase = () => {
    if (passphraseLoading) return;
    if (passphraseTarget)
      lifecycleTargets.current.delete(passphraseTarget.profile.id);
    setPassphraseTarget(null);
    setPassphraseError(null);
  };
  const saveProfile = async (profile: SshForwardProfile) => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      if (formExisting)
        await run(async () => {
          await forwarding.updateProfile(
            profile.id,
            profileGeneration(profile.id),
            profile,
          );
          closeForm(true);
        });
      else
        await run(async () => {
          await forwarding.createProfile(profile);
          closeForm(true);
        });
    } finally {
      saveInFlight.current = false;
    }
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
    passphraseTarget,
    passphraseError,
    passphraseLoading,
    setNotice,
    openNew,
    openEdit,
    closeForm,
    run,
    lifecycle,
    submitPassphrase,
    submitPassword,
    cancelPassphrase,
    saveProfile,
    deleteProfile,
    approveHost,
    openTrust,
    setTrustTarget,
    profileGeneration,
  };
}
