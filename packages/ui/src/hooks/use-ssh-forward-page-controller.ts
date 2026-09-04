import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveProfile, type ServerProfile } from "@/api/server-config.js";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import { useSshForward } from "@/hooks/use-ssh-forward.js";
import {
  buildSshConnectionProfile,
  buildSshForwardRule,
  type SshConnectionProfileDraft,
  type SshForwardRuleDraft,
} from "@/lib/ssh-forward-form.js";
import {
  getSshForwardErrorPresentation,
  toSshForwardError,
} from "@/lib/ssh-forward-error-copy.js";
import { generateUUID } from "@/lib/utils.js";
import { isSshForwardRuleRuntimeActive } from "@/lib/ssh-forward-host.js";
import type {
  HostKeyChallenge,
  KeyInventory,
  SshConnectionProfile,
  SshForwardError,
  SshForwardRule,
  SshForwardSnapshot,
  WireCounter,
} from "@/lib/ssh-forward-host.js";

export interface TrustTarget {
  connection: SshConnectionProfile;
  challenge?: HostKeyChallenge;
  errorCode?: SshForwardError["code"];
}

export interface PassphraseTarget {
  connection: SshConnectionProfile;
  keys: KeyInventory["keys"];
  errorCode?: SshForwardError["code"];
}

export interface ConfirmationTarget {
  kind: "disconnect" | "deleteConnection" | "deleteRule" | "forgetCredential";
  connection: SshConnectionProfile;
  rule?: SshForwardRule;
  title: string;
  message: string;
}

const CREDENTIAL_PROMPT_CODES = new Set<SshForwardError["code"]>([
  "AUTH_REQUIRED",
  "AUTH_FAILED",
  "AGENT_UNAVAILABLE",
  "KEY_ENCRYPTED_USE_AGENT",
  "KEY_PASSPHRASE_INVALID",
  "CREDENTIAL_EXPIRED",
  "CREDENTIAL_REJECTED",
  "CREDENTIAL_VAULT_UNAVAILABLE",
  "CREDENTIAL_VAULT_CORRUPT",
]);
const TRUST_CODES = new Set<SshForwardError["code"]>([
  "HOST_KEY_APPROVAL_REQUIRED",
  "HOST_KEY_CHANGED",
  "HOST_KEY_ALGORITHM_CHANGED",
]);

function forwardingTransientIdentity(snapshot: SshForwardSnapshot | null) {
  if (!snapshot) return "none";
  return [
    snapshot.context.desktopInstanceId,
    snapshot.context.managerSessionId,
    snapshot.context.clientEpoch,
    snapshot.activationToken,
    snapshot.scopeId,
    snapshot.scopeGeneration,
  ].join("|");
}

export function useSshForwardPageController() {
  const { host, environment, readiness } = useSshForwardHost();
  const forwarding = useSshForward();
  const refreshForwarding = forwarding.refresh;
  const connectForwarding = forwarding.connect;
  const disconnectForwarding = forwarding.disconnect;
  const loadKeyForwarding = forwarding.loadKey;
  const approveHostForwarding = forwarding.approveHost;
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [connectionFormExisting, setConnectionFormExisting] =
    useState<SshConnectionProfile | null>(null);
  const [connectionFormSource, setConnectionFormSource] =
    useState<ServerProfile | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleFormExisting, setRuleFormExisting] =
    useState<SshForwardRule | null>(null);
  const [ruleFormConnection, setRuleFormConnection] =
    useState<SshConnectionProfile | null>(null);
  const [trustTarget, setTrustTarget] = useState<TrustTarget | null>(null);
  const [trustApproved, setTrustApproved] = useState(false);
  const [passphraseTarget, setPassphraseTarget] =
    useState<PassphraseTarget | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [passphraseLoading, setPassphraseLoading] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationTarget | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const lifecycleTargets = useRef(new Map<string, SshConnectionProfile>());
  const promptInFlight = useRef(false);
  const promptRequestId = useRef(0);
  const saveInFlight = useRef(false);
  const transientEpoch = useRef(0);
  const previousHost = useRef(host);
  const previousReadiness = useRef(readiness);
  const previousTransientIdentity = useRef(
    forwardingTransientIdentity(forwarding.snapshot),
  );
  const transientIdentityInitialized = useRef(false);

  const resetTransientState = useCallback(() => {
    transientEpoch.current += 1;
    promptRequestId.current += 1;
    lifecycleTargets.current.clear();
    promptInFlight.current = false;
    saveInFlight.current = false;
    setConnectionFormOpen(false);
    setConnectionFormExisting(null);
    setConnectionFormSource(null);
    setRuleFormOpen(false);
    setRuleFormExisting(null);
    setRuleFormConnection(null);
    setTrustTarget(null);
    setTrustApproved(false);
    setPassphraseTarget(null);
    setPassphraseError(null);
    setPassphraseLoading(false);
    setConfirmation(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    const nextIdentity = forwardingTransientIdentity(forwarding.snapshot);
    if (!transientIdentityInitialized.current) {
      transientIdentityInitialized.current = true;
    } else if (
      previousHost.current !== host ||
      previousReadiness.current !== readiness ||
      previousTransientIdentity.current !== nextIdentity
    ) {
      resetTransientState();
    }
    previousHost.current = host;
    previousReadiness.current = readiness;
    previousTransientIdentity.current = nextIdentity;
  }, [forwarding.snapshot, host, readiness, resetTransientState]);

  const connections = forwarding.snapshot?.connections ?? [];
  const connectionRuntimes = useMemo(
    () =>
      new Map(
        (forwarding.snapshot?.connectionRuntimes ?? []).map((runtime) => [
          runtime.connectionProfileId,
          runtime,
        ]),
      ),
    [forwarding.snapshot?.connectionRuntimes],
  );
  const ruleRuntimes = useMemo(
    () =>
      new Map(
        (forwarding.snapshot?.ruleRuntimes ?? []).map((runtime) => [
          runtime.ruleId,
          runtime,
        ]),
      ),
    [forwarding.snapshot?.ruleRuntimes],
  );
  const credentials = useMemo(
    () =>
      new Map(
        (forwarding.snapshot?.credentialStates ?? []).map((credential) => [
          credential.connectionProfileId,
          credential,
        ]),
      ),
    [forwarding.snapshot?.credentialStates],
  );
  const challenges = useMemo(
    () =>
      new Map(
        (forwarding.snapshot?.hostKeyChallenges ?? []).map((challenge) => [
          challenge.connectionProfileId,
          challenge,
        ]),
      ),
    [forwarding.snapshot?.hostKeyChallenges],
  );

  const connectionGeneration = useCallback(
    (connectionProfileId: string): WireCounter =>
      connectionRuntimes.get(connectionProfileId)?.generation ??
      ("0" as WireCounter),
    [connectionRuntimes],
  );
  const ruleGeneration = useCallback(
    (ruleId: string): WireCounter =>
      ruleRuntimes.get(ruleId)?.generation ?? ("0" as WireCounter),
    [ruleRuntimes],
  );
  useEffect(() => {
    if (
      host &&
      environment.kind === "nativeDesktop" &&
      readiness === "unmanaged"
    )
      void refreshForwarding();
  }, [environment.kind, host, readiness, refreshForwarding]);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await operation();
      return true;
    } catch {
      // The mutation hook publishes native errors through forwarding.error;
      // duplicating them here would render the same message twice.
      return false;
    }
  }, []);

  const openNewConnection = useCallback(() => {
    setNotice(null);
    setConnectionFormExisting(null);
    setConnectionFormSource(getActiveProfile());
    setConnectionFormOpen(true);
  }, []);
  const openEditConnection = useCallback((connection: SshConnectionProfile) => {
    setNotice(null);
    setConnectionFormExisting(connection);
    setConnectionFormSource(null);
    setConnectionFormOpen(true);
  }, []);
  const closeConnectionForm = useCallback(
    (force = false) => {
      if (force || !forwarding.pending) {
        setConnectionFormOpen(false);
        setConnectionFormExisting(null);
        setConnectionFormSource(null);
      }
    },
    [forwarding.pending],
  );
  const openNewRule = useCallback((connection: SshConnectionProfile) => {
    setNotice(null);
    setRuleFormConnection(connection);
    setRuleFormExisting(null);
    setRuleFormOpen(true);
  }, []);
  const openEditRule = useCallback(
    (connection: SshConnectionProfile, rule: SshForwardRule) => {
      setNotice(null);
      setRuleFormConnection(connection);
      setRuleFormExisting(rule);
      setRuleFormOpen(true);
    },
    [],
  );
  const closeRuleForm = useCallback(
    (force = false) => {
      if (force || !forwarding.pending) {
        setRuleFormOpen(false);
        setRuleFormConnection(null);
        setRuleFormExisting(null);
      }
    },
    [forwarding.pending],
  );

  const openTrust = useCallback(
    (
      connection: SshConnectionProfile,
      errorCode?: SshForwardError["code"],
      challenge?: HostKeyChallenge,
    ) => {
      setTrustApproved(false);
      setTrustTarget({ connection, errorCode, challenge });
    },
    [],
  );

  const requestCredential = useCallback(
    async (
      connection: SshConnectionProfile,
      errorCode?: SshForwardError["code"],
      replaceCredentialPrompt = false,
    ) => {
      if (
        promptInFlight.current ||
        (!replaceCredentialPrompt && passphraseTarget)
      )
        return;
      const requestEpoch = transientEpoch.current;
      const requestId = ++promptRequestId.current;
      promptInFlight.current = true;
      setPassphraseError(
        errorCode === "KEY_ENCRYPTED_USE_AGENT" ||
          errorCode === "KEY_PASSPHRASE_INVALID"
          ? "Unlock the encrypted local SSH key to connect."
          : errorCode === "AUTH_FAILED"
            ? "SSH authentication failed. Choose a key or use username and password."
            : errorCode === "CREDENTIAL_REJECTED" ||
                errorCode === "CREDENTIAL_EXPIRED"
              ? "The saved credential cannot be reused. Enter a replacement."
              : null,
      );
      setNotice(null);
      try {
        const inventory = await forwarding.listKeys();
        if (requestEpoch !== transientEpoch.current) return;
        const keys = inventory.keys.filter(
          (key) =>
            key.source === "local" &&
            (connection.auth.mode === "agent" ||
              key.keyId === connection.auth.keyId),
        );
        setPassphraseTarget({ connection, keys, errorCode });
      } catch {
        // listKeys is a mutation, so its native error is already published by
        // the forwarding hook. Keep the catch to finish prompt bookkeeping.
      } finally {
        if (promptRequestId.current === requestId)
          promptInFlight.current = false;
      }
    },
    [forwarding, passphraseTarget],
  );

  const inspectLifecycleResult = useCallback(
    (
      connection: SshConnectionProfile,
      result: SshForwardSnapshot,
      replaceCredentialPrompt = false,
    ): "trust" | "credential" | "complete" => {
      const runtime = result.connectionRuntimes.find(
        (candidate) => candidate.connectionProfileId === connection.id,
      );
      const challenge =
        result.hostKeyChallenges.find(
          (candidate) => candidate.connectionProfileId === connection.id,
        ) ?? challenges.get(connection.id);
      if (runtime?.errorCode && TRUST_CODES.has(runtime.errorCode)) {
        lifecycleTargets.current.delete(connection.id);
        setPassphraseTarget(null);
        setPassphraseError(null);
        openTrust(connection, runtime.errorCode, challenge);
        return "trust";
      } else if (
        runtime?.errorCode &&
        CREDENTIAL_PROMPT_CODES.has(runtime.errorCode)
      ) {
        lifecycleTargets.current.delete(connection.id);
        void requestCredential(
          connection,
          runtime.errorCode,
          replaceCredentialPrompt,
        );
        return "credential";
      } else if (
        runtime &&
        runtime.state !== "authenticating" &&
        runtime.state !== "disconnecting"
      ) {
        lifecycleTargets.current.delete(connection.id);
      }
      return "complete";
    },
    [challenges, openTrust, requestCredential],
  );

  const lifecycle = useCallback(
    async (
      connection: SshConnectionProfile,
      operation: () => Promise<SshForwardSnapshot>,
    ) => {
      if (lifecycleTargets.current.has(connection.id)) return;
      if (passphraseTarget) {
        setNotice("Finish the SSH credential prompt before connecting again.");
        return;
      }
      const lifecycleEpoch = transientEpoch.current;
      lifecycleTargets.current.set(connection.id, connection);
      try {
        const result = await operation();
        if (lifecycleEpoch !== transientEpoch.current) return;
        inspectLifecycleResult(connection, result);
      } catch (error) {
        if (lifecycleEpoch !== transientEpoch.current) return;
        lifecycleTargets.current.delete(connection.id);
        const parsed = toSshForwardError(error);
        if (TRUST_CODES.has(parsed.code)) {
          openTrust(connection, parsed.code, challenges.get(connection.id));
        } else if (CREDENTIAL_PROMPT_CODES.has(parsed.code)) {
          void requestCredential(connection, parsed.code);
        } else {
          // The mutation hook already published this error through
          // forwarding.error; do not render a duplicate controller notice.
        }
      }
    },
    [
      challenges,
      inspectLifecycleResult,
      openTrust,
      passphraseTarget,
      requestCredential,
    ],
  );

  useEffect(() => {
    for (const [connectionId, connection] of lifecycleTargets.current) {
      const runtime = connectionRuntimes.get(connectionId);
      if (!runtime) continue;
      if (runtime.errorCode) {
        lifecycleTargets.current.delete(connectionId);
        if (TRUST_CODES.has(runtime.errorCode))
          openTrust(
            connection,
            runtime.errorCode,
            challenges.get(connectionId),
          );
        else if (CREDENTIAL_PROMPT_CODES.has(runtime.errorCode))
          void requestCredential(connection, runtime.errorCode);
      } else if (
        runtime.state === "established" ||
        runtime.state === "disconnected" ||
        runtime.state === "reconnecting"
      ) {
        lifecycleTargets.current.delete(connectionId);
      }
    }
  }, [challenges, connectionRuntimes, openTrust, requestCredential]);

  const connect = useCallback(
    (connection: SshConnectionProfile) =>
      lifecycle(connection, () =>
        connectForwarding(connection.id, connectionGeneration(connection.id)),
      ),
    [connectForwarding, connectionGeneration, lifecycle],
  );

  const disconnectNow = useCallback(
    (connection: SshConnectionProfile) =>
      run(() =>
        disconnectForwarding(
          connection.id,
          connectionGeneration(connection.id),
        ),
      ),
    [connectionGeneration, disconnectForwarding, run],
  );

  const activeRuleCount = useCallback(
    (connectionId: string) =>
      (forwarding.snapshot?.rules ?? []).filter((rule) => {
        if (rule.connectionProfileId !== connectionId) return false;
        const state = ruleRuntimes.get(rule.id)?.state;
        return isSshForwardRuleRuntimeActive(state);
      }).length,
    [forwarding.snapshot?.rules, ruleRuntimes],
  );

  const requestDisconnect = useCallback(
    (connection: SshConnectionProfile) => {
      if (activeRuleCount(connection.id) > 0) {
        setConfirmation({
          kind: "disconnect",
          connection,
          title: `Disconnect ${connection.name}?`,
          message:
            "Enabled child rules will stop accepting clients and all listeners and SSH channels for this connection will close. Saved credentials remain available until they expire.",
        });
        return;
      }
      void disconnectNow(connection);
    },
    [activeRuleCount, disconnectNow],
  );

  const requestDeleteConnection = useCallback(
    (connection: SshConnectionProfile) => {
      const runtime = connectionRuntimes.get(connection.id);
      if (runtime && runtime.state !== "disconnected") {
        setNotice("Disconnect the connection before deleting it.");
        return;
      }
      if (
        (forwarding.snapshot?.rules ?? []).some(
          (rule) => rule.connectionProfileId === connection.id,
        )
      ) {
        setNotice("Delete all child rules before deleting the connection.");
        return;
      }
      setConfirmation({
        kind: "deleteConnection",
        connection,
        title: `Delete ${connection.name}?`,
        message:
          "This removes the credential-free connection profile after its child rules are deleted. Saved credentials are removed too.",
      });
    },
    [connectionRuntimes, forwarding.snapshot?.rules],
  );

  const requestDeleteRule = useCallback(
    (connection: SshConnectionProfile, rule: SshForwardRule) => {
      const state = ruleRuntimes.get(rule.id)?.state;
      if (isSshForwardRuleRuntimeActive(state)) {
        setNotice("Disable the rule before editing or deleting it.");
        return;
      }
      setConfirmation({
        kind: "deleteRule",
        connection,
        rule,
        title: `Delete ${rule.name}?`,
        message: "The forwarding rule will be removed from this connection.",
      });
    },
    [ruleRuntimes],
  );

  const requestForgetCredential = useCallback(
    (connection: SshConnectionProfile) => {
      const credential = credentials.get(connection.id);
      if (!credential || credential.status === "none") {
        setNotice("No saved credential is available for this connection.");
        return;
      }
      setConfirmation({
        kind: "forgetCredential",
        connection,
        title: "Forget saved SSH credential?",
        message:
          "Only the saved Windows user-vault credential will be removed. The connection profile and current established session stay intact.",
      });
    },
    [credentials],
  );

  const confirmAction = useCallback(async () => {
    const target = confirmation;
    if (!target) return;
    setConfirmation(null);
    if (target.kind === "disconnect") return disconnectNow(target.connection);
    if (target.kind === "deleteConnection")
      return run(() =>
        forwarding.deleteConnection(
          target.connection.id,
          connectionGeneration(target.connection.id),
        ),
      );
    if (target.kind === "deleteRule" && target.rule) {
      return run(() =>
        forwarding.deleteRule(
          target.connection.id,
          connectionGeneration(target.connection.id),
          target.rule!.id,
          ruleGeneration(target.rule!.id),
        ),
      );
    }
    return run(() =>
      forwarding.forgetCredential(
        target.connection.id,
        connectionGeneration(target.connection.id),
      ),
    );
  }, [
    confirmation,
    connectionGeneration,
    disconnectNow,
    forwarding,
    ruleGeneration,
    run,
  ]);

  const setRuleEnabled = useCallback(
    (
      connection: SshConnectionProfile,
      rule: SshForwardRule,
      enabled: boolean,
    ) => {
      void run(() =>
        forwarding.setRuleEnabled(
          connection.id,
          connectionGeneration(connection.id),
          rule.id,
          ruleGeneration(rule.id),
          enabled,
        ),
      );
    },
    [connectionGeneration, forwarding, ruleGeneration, run],
  );

  const saveConnection = useCallback(
    async (draft: SshConnectionProfileDraft) => {
      if (saveInFlight.current) return;
      const scopeId = forwarding.snapshot?.scopeId;
      if (!scopeId)
        return setNotice("The active DamHopper scope is unavailable.");
      const connection = buildSshConnectionProfile(
        draft,
        scopeId,
        connectionFormExisting ?? undefined,
      );
      if (!connection)
        return setNotice("Review the connection fields before saving.");
      const saveEpoch = transientEpoch.current;
      saveInFlight.current = true;
      try {
        const saved = await run(() =>
          connectionFormExisting
            ? forwarding.updateConnection(
                connection.id,
                connectionGeneration(connection.id),
                connection,
              )
            : forwarding.createConnection(connection),
        );
        if (saved && saveEpoch === transientEpoch.current)
          closeConnectionForm(true);
      } finally {
        saveInFlight.current = false;
      }
    },
    [
      closeConnectionForm,
      connectionFormExisting,
      connectionGeneration,
      forwarding,
      run,
    ],
  );

  const saveRule = useCallback(
    async (draft: SshForwardRuleDraft) => {
      if (saveInFlight.current || !ruleFormConnection) return;
      const scopeId = forwarding.snapshot?.scopeId;
      if (!scopeId)
        return setNotice("The active DamHopper scope is unavailable.");
      const rule = buildSshForwardRule(
        draft,
        scopeId,
        ruleFormConnection.id,
        ruleFormExisting ?? undefined,
      );
      if (!rule) return setNotice("Review the forwarding rule before saving.");
      const saveEpoch = transientEpoch.current;
      saveInFlight.current = true;
      try {
        const saved = await run(() =>
          ruleFormExisting
            ? forwarding.updateRule(
                ruleFormConnection.id,
                connectionGeneration(ruleFormConnection.id),
                rule.id,
                ruleGeneration(rule.id),
                rule,
              )
            : forwarding.createRule(
                ruleFormConnection.id,
                connectionGeneration(ruleFormConnection.id),
                rule,
              ),
        );
        if (saved && saveEpoch === transientEpoch.current) closeRuleForm(true);
      } finally {
        saveInFlight.current = false;
      }
    },
    [
      closeRuleForm,
      connectionGeneration,
      forwarding,
      ruleFormConnection,
      ruleFormExisting,
      ruleGeneration,
      run,
    ],
  );

  const retryWithCredential = useCallback(
    async (
      target: PassphraseTarget,
      load: (generation: WireCounter) => Promise<SshForwardSnapshot>,
      attemptId?: string,
      initialSnapshot?: SshForwardSnapshot,
    ) => {
      const retryEpoch = transientEpoch.current;
      const initialGeneration =
        initialSnapshot?.connectionRuntimes.find(
          (runtime) => runtime.connectionProfileId === target.connection.id,
        )?.generation ?? connectionGeneration(target.connection.id);
      const loaded = await load(initialGeneration);
      if (retryEpoch !== transientEpoch.current) return;
      const generation =
        loaded.connectionRuntimes.find(
          (runtime) => runtime.connectionProfileId === target.connection.id,
        )?.generation ?? connectionGeneration(target.connection.id);
      lifecycleTargets.current.set(target.connection.id, target.connection);
      try {
        const result = await connectForwarding(
          target.connection.id,
          generation,
          attemptId,
        );
        if (retryEpoch !== transientEpoch.current) return;
        const inspection = inspectLifecycleResult(
          target.connection,
          result,
          true,
        );
        if (inspection !== "credential") {
          setPassphraseTarget(null);
          setPassphraseError(null);
        }
      } catch (error) {
        if (retryEpoch !== transientEpoch.current) return;
        lifecycleTargets.current.delete(target.connection.id);
        throw error;
      }
    },
    [connectForwarding, connectionGeneration, inspectLifecycleResult],
  );

  const submitPassphrase = useCallback(
    async (
      passphrase: string,
      keyId: string | undefined,
      saveForLater: boolean,
    ) => {
      const target = passphraseTarget;
      if (!target || !keyId) return;
      const submitEpoch = transientEpoch.current;
      setPassphraseLoading(true);
      setPassphraseError(null);
      try {
        await retryWithCredential(target, (generation) =>
          loadKeyForwarding(
            target.connection.id,
            keyId,
            passphrase,
            generation,
            saveForLater ? 30 : 0,
          ),
        );
      } catch (error) {
        if (submitEpoch === transientEpoch.current)
          setPassphraseError(getSshForwardErrorPresentation(error).message);
      } finally {
        if (submitEpoch === transientEpoch.current) setPassphraseLoading(false);
      }
    },
    [loadKeyForwarding, passphraseTarget, retryWithCredential],
  );

  const submitPassword = useCallback(
    async (
      username: string,
      password: string,
      rememberForDays: 0 | 30 = 30,
    ) => {
      const target = passphraseTarget;
      if (!target || !username.trim() || !password) return;
      if (target.connection.auth.mode !== "agent") {
        setPassphraseError(
          "Username and password fallback is available only for OS-agent connections.",
        );
        return;
      }
      const submitEpoch = transientEpoch.current;
      const credentialAttemptId = generateUUID();
      setPassphraseLoading(true);
      setPassphraseError(null);
      try {
        const current =
          forwarding.snapshot?.connections.find(
            (candidate) => candidate.id === target.connection.id,
          ) ?? target.connection;
        let connection = current;
        let updatedSnapshot: SshForwardSnapshot | undefined;
        if (username.trim() !== current.sshUser) {
          const updated = {
            ...current,
            sshUser: username.trim(),
            updatedAt:
              new Date().toISOString() as SshConnectionProfile["updatedAt"],
          };
          updatedSnapshot = await forwarding.updateConnection(
            current.id,
            connectionGeneration(current.id),
            updated,
          );
          connection =
            updatedSnapshot.connections.find(
              (candidate) => candidate.id === current.id,
            ) ?? updated;
        }
        await retryWithCredential(
          { ...target, connection },
          (generation) =>
            forwarding.loadPassword(
              connection.id,
              username.trim(),
              password,
              credentialAttemptId,
              generation,
              rememberForDays,
            ),
          credentialAttemptId,
          updatedSnapshot,
        );
      } catch (error) {
        if (submitEpoch === transientEpoch.current)
          setPassphraseError(getSshForwardErrorPresentation(error).message);
      } finally {
        if (submitEpoch === transientEpoch.current) setPassphraseLoading(false);
      }
    },
    [connectionGeneration, forwarding, passphraseTarget, retryWithCredential],
  );

  const cancelPassphrase = useCallback(() => {
    if (passphraseLoading) return;
    if (passphraseTarget)
      lifecycleTargets.current.delete(passphraseTarget.connection.id);
    setPassphraseTarget(null);
    setPassphraseError(null);
  }, [passphraseLoading, passphraseTarget]);

  const approveHost = useCallback(() => {
    if (!trustTarget?.challenge) return;
    const approvalEpoch = transientEpoch.current;
    void run(async () => {
      await approveHostForwarding(
        trustTarget.connection.id,
        connectionGeneration(trustTarget.connection.id),
        trustTarget.challenge!.challengeId,
        trustTarget.challenge!.algorithm,
        trustTarget.challenge!.fingerprint,
      );
      if (approvalEpoch === transientEpoch.current) setTrustApproved(true);
    });
  }, [approveHostForwarding, connectionGeneration, run, trustTarget]);

  return {
    host,
    environment,
    forwarding,
    connections,
    connectionRuntimes,
    ruleRuntimes,
    credentials,
    challenges,
    connectionGeneration,
    ruleGeneration,
    connectionFormOpen,
    connectionFormExisting,
    connectionFormSource,
    ruleFormOpen,
    ruleFormExisting,
    ruleFormConnection,
    trustTarget,
    trustApproved,
    passphraseTarget,
    passphraseError,
    passphraseLoading,
    confirmation,
    notice,
    setNotice,
    openNewConnection,
    openEditConnection,
    closeConnectionForm,
    openNewRule,
    openEditRule,
    closeRuleForm,
    connect,
    requestDisconnect,
    requestDeleteConnection,
    requestDeleteRule,
    requestForgetCredential,
    confirmAction,
    cancelConfirmation: () => setConfirmation(null),
    setRuleEnabled,
    saveConnection,
    saveRule,
    submitPassphrase,
    submitPassword,
    cancelPassphrase,
    approveHost,
    openTrust,
    setTrustTarget,
    run,
    inspectLifecycleResult,
  };
}
