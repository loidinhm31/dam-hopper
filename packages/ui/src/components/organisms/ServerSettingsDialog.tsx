import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useShellInputContext } from "@/os/shell-input-context.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import {
  X,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { revokeCurrentMediaSession } from "@/api/media-session.js";
import {
  getMediaClientIdForProfile,
  getConnectionSnapshot,
} from "@/api/connections.js";
import type { ServerProfile } from "@/api/server-config.js";
import {
  AccountLogoutDialog,
  type AccountLogoutTarget,
} from "@/components/organisms/AccountLogoutDialog.js";
import {
  BrowserHostClientError,
  preflightBrowserCapabilitiesForOrigin,
  resetBrowserProfileForOrigin,
  getBrowserProfileResetStatusForOrigin,
  getPendingBrowserResetContext,
  setPendingBrowserResetContext,
  type BrowserResetPreflightResult,
  type ProfileResetStatusResponse,
} from "@/api/browser-host-client.js";
import {
  fenceBrowserViewsForProfile,
  clearBrowserViewFenceForProfile,
} from "@/os/BrowserStreamKeepAliveHost.js";
import { generateUUID } from "@/lib/utils.js";
import { WorkspaceSwitcher } from "@/components/organisms/WorkspaceSwitcher.js";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary.js";
import {
  login,
  fetchMfaSetup,
  confirmMfaEnrollment,
  verifyMfa,
  requestMfaStepUpChallenge,
  AuthClientError,
  type MfaSetupResponse,
} from "@/api/auth-client.js";
import { MfaChallengeForm } from "@/components/molecules/MfaChallengeForm.js";
import {
  getServerUrl,
  haveServerUrlsChanged,
  normalizeServerUrl,
  shouldClearAuthTokenForUrlChange,
  setServerUrl,
  clearServerUrl,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  isCrossOriginServer,
  getAuthUsername,
  setAuthUsername,
  clearAuthUsername,
  hasServerUrl,
  getActiveProfile,
  getActiveProfileId,
  clearActiveProfile,
  createProfile,
  getProfiles,
  getProfileChangeVersion,
  subscribeToProfileChanges,
  saveProfiles,
  updateProfile,
  setActiveProfile,
} from "@/api/server-config.js";
import { connectProfile, disconnectProfile } from "@/api/connections.js";
import { fenceThenDisconnectProfile } from "@/os/browser/browser-logout-fence.js";

interface Props {
  open: boolean;
  onClose: () => void;
  closable?: boolean;
  profile?: ServerProfile | null; // null = new profile, undefined = legacy mode
  onSaved?: (profile: ServerProfile) => void;
}

type CredentialMode = "saved" | "legacy" | "new";

type CredentialAttempt = {
  mode: CredentialMode;
  profileId: string | null;
  activeProfileId: string | null;
  profileCreatedAt: number | null;
  profileName: string | null;
  profileUsername: string | undefined;
  profileAutoConnect: boolean | undefined;
  legacyServerUrl: string | null;
  legacyServerUrlExplicit: boolean | null;
  persistedUrl: string | null;
  persistedAuthType: "basic" | "none" | null;
  baselineToken: string | null;
  baselineGeneration: number | null;
  baselineRuntimeIntent: boolean;
  dialogSession: number;
  requestId: number;
  endpoint: string;
  authType: "basic" | "none";
};

type VerifiedCredential = {
  attempt: CredentialAttempt;
  candidate: string;
};

type TestState = "idle" | "testing" | "challenge" | "ok" | "fail";



export function ServerSettingsDialog({
  open,
  onClose,
  closable = true,
  profile,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"basic" | "none">("basic");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [initialUrl, setInitialUrl] = useState("");
  const [initialToken, setInitialToken] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const [mfaMode, setMfaMode] = useState<"enrollment" | "verification">(
    "verification",
  );
  const [mfaChallengeToken, setMfaChallengeToken] = useState("");
  const [mfaSetupData, setMfaSetupData] = useState<MfaSetupResponse | null>(
    null,
  );
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaRetryAfter, setMfaRetryAfter] = useState<number | undefined>(
    undefined,
  );
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);
  const latestUrlRef = useRef("");
  const latestProfileIdRef = useRef<string | undefined>(profile?.id);
  const latestProfileRef = useRef(profile);
  const currentAuthAttemptRef = useRef<CredentialAttempt | null>(null);
  const verifiedCredentialRef = useRef<VerifiedCredential | null>(null);
  const invalidatedCredentialAttemptsRef = useRef(
    new WeakSet<CredentialAttempt>(),
  );
  const retiredCredentialAttemptsRef = useRef(
    new WeakSet<CredentialAttempt>(),
  );
  const credentialObservationRef = useRef<{
    attempt: CredentialAttempt;
    stop: () => void;
  } | null>(null);
  const saveCredentialMutationRef = useRef<{
    attempt: CredentialAttempt;
    revision: number;
  } | null>(null);
  const latestAuthTypeRef = useRef(authType);
  latestProfileRef.current = profile;
  latestProfileIdRef.current = profile?.id;
  latestAuthTypeRef.current = authType;
  const captureCredentialAttempt = (
    requestId: number,
    endpoint: string,
  ): CredentialAttempt => {
    const currentProfile = latestProfileRef.current;
    const mode: CredentialMode =
      currentProfile === null
        ? "new"
        : currentProfile === undefined
          ? "legacy"
          : "saved";
    const activeProfileId = getActiveProfileId();
    const profileId =
      mode === "saved"
        ? (currentProfile?.id ?? null)
        : mode === "legacy"
          ? activeProfileId
          : null;
    const baselineSnapshot = profileId
      ? getConnectionSnapshot(profileId)
      : null;
    const persistedProfile = profileId
      ? getProfiles().find((candidate) => candidate.id === profileId)
      : null;
    return {
      mode,
      profileId,
      activeProfileId,
      profileCreatedAt: persistedProfile?.createdAt ?? null,
      profileName: persistedProfile?.name ?? null,
      profileUsername: persistedProfile?.username,
      profileAutoConnect: persistedProfile?.autoConnect,
      legacyServerUrl: mode === "legacy" ? getServerUrl() : null,
      legacyServerUrlExplicit: mode === "legacy" ? hasServerUrl() : null,
      persistedUrl: persistedProfile
        ? normalizeServerUrl(persistedProfile.url)
        : null,
      persistedAuthType: persistedProfile?.authType ?? null,
      baselineToken:
        persistedProfile && profileId ? getAuthToken(profileId) : null,
      baselineGeneration: baselineSnapshot?.owner.generation ?? null,
      baselineRuntimeIntent: baselineSnapshot?.intent ?? false,
      dialogSession: dialogSessionRef.current,
      requestId,
      endpoint,
      authType: latestAuthTypeRef.current,
    };
  };
  const currentAttemptProfile = (attempt: CredentialAttempt) =>
    attempt.profileId
      ? getProfiles().find((candidate) => candidate.id === attempt.profileId) ??
        null
      : null;
  const attemptTargetIsCurrent = (attempt: CredentialAttempt) => {
    if (
      dialogSessionRef.current !== attempt.dialogSession ||
      testRequestIdRef.current !== attempt.requestId ||
      latestUrlRef.current !== attempt.endpoint ||
      latestAuthTypeRef.current !== attempt.authType
    ) {
      return false;
    }
    const currentProfile = latestProfileRef.current;
    if (attempt.mode === "new") return currentProfile === null;
    if (
      attempt.mode === "saved" &&
      currentProfile?.id !== attempt.profileId
    ) {
      return false;
    }
    if (
      attempt.mode === "legacy" &&
      (currentProfile !== undefined ||
        getActiveProfileId() !== attempt.activeProfileId ||
        normalizeServerUrl(getServerUrl()) !==
          normalizeServerUrl(attempt.legacyServerUrl ?? "") ||
        hasServerUrl() !== attempt.legacyServerUrlExplicit)
    ) {
      return false;
    }
    if (!attempt.profileId) return attempt.persistedUrl === null;
    const persisted = currentAttemptProfile(attempt);
    return Boolean(
      persisted &&
        persisted.createdAt === attempt.profileCreatedAt &&
        persisted.name === attempt.profileName &&
        persisted.username === attempt.profileUsername &&
        persisted.autoConnect === attempt.profileAutoConnect &&
        normalizeServerUrl(persisted.url) === attempt.persistedUrl &&
        persisted.authType === attempt.persistedAuthType,
    );
  };
  const attemptIncarnationIsCurrent = (attempt: CredentialAttempt) =>
    dialogSessionRef.current === attempt.dialogSession &&
    testRequestIdRef.current === attempt.requestId &&
    currentAuthAttemptRef.current === attempt;
  const rejectInvalidatedAttempt = (attempt: CredentialAttempt) => {
    if (!attemptIncarnationIsCurrent(attempt)) return;
    stopCredentialObservation();
    currentAuthAttemptRef.current = null;
    verifiedCredentialRef.current = null;
    setTestState("fail");
    setTestError("The target profile changed during authentication. Test again.");
    setMfaLoading(false);
    setMfaSubmitting(false);
  };
  const stopCredentialObservation = () => {
    credentialObservationRef.current?.stop();
    credentialObservationRef.current = null;
  };
  const observeCredentialLineage = (attempt: CredentialAttempt) => {
    stopCredentialObservation();
    if (!attempt.profileId) return;
    const stop = subscribeToProfileChanges((event) => {
      const ownedMutation = saveCredentialMutationRef.current;
      const isExactOwnedMutation =
        event.type === "dataChanged" &&
        ownedMutation?.attempt === attempt &&
        ownedMutation.revision === event.revision;
      if (
        event.type === "dataChanged" &&
        currentAuthAttemptRef.current === attempt &&
        !isExactOwnedMutation
      ) {
        const isObservedReplacement =
          event.credentialProfileId === attempt.profileId &&
          event.credentialPresent === true;
        const isSaveTimeCredentialChange =
          saveOperationRef.current &&
          event.credentialProfileId === attempt.profileId;
        const currentToken = getAuthToken(attempt.profileId!);
        if (
          isObservedReplacement ||
          isSaveTimeCredentialChange ||
          (event.credentialProfileId === undefined &&
            currentToken !== null &&
            currentToken !== attempt.baselineToken)
        ) {
          invalidatedCredentialAttemptsRef.current.add(attempt);
        } else if (
          event.credentialProfileId === attempt.profileId &&
          event.credentialPresent === false &&
          attempt.baselineToken !== null &&
          currentToken === null
        ) {
          retiredCredentialAttemptsRef.current.add(attempt);
        }
      }
    });
    credentialObservationRef.current = { attempt, stop };
  };
  const currentAttemptToken = (attempt: CredentialAttempt) =>
    attempt.profileId ? getAuthToken(attempt.profileId) : null;
  const currentAttemptGeneration = (attempt: CredentialAttempt) =>
    attempt.profileId
      ? (getConnectionSnapshot(attempt.profileId)?.owner.generation ?? null)
      : null;
  const attemptHasBaseline = (attempt: CredentialAttempt) =>
    attemptTargetIsCurrent(attempt) &&
    currentAttemptToken(attempt) === attempt.baselineToken &&
    currentAttemptGeneration(attempt) === attempt.baselineGeneration;
  const attemptHasQualifiedRetirement = (attempt: CredentialAttempt) => {
    if (!attempt.profileId || !attempt.baselineToken) return false;
    const snapshot = getConnectionSnapshot(attempt.profileId);
    const currentGeneration = snapshot?.owner.generation ?? null;
    const generationMatchesObservedRetirement =
      currentGeneration === attempt.baselineGeneration ||
      (attempt.baselineGeneration !== null &&
        currentGeneration === attempt.baselineGeneration + 1);
    const hasObservedRetirement =
      retiredCredentialAttemptsRef.current.has(attempt);
    return Boolean(
      attemptTargetIsCurrent(attempt) &&
        currentAttemptToken(attempt) === null &&
        !invalidatedCredentialAttemptsRef.current.has(attempt) &&
        (hasObservedRetirement
          ? generationMatchesObservedRetirement
          : snapshot?.status === "login-required" &&
            attempt.baselineGeneration !== null &&
            currentGeneration === attempt.baselineGeneration + 1),
    );
  };
  const canAcceptCredential = (
    attempt: CredentialAttempt,
    candidate: string,
  ) =>
    attemptTargetIsCurrent(attempt) &&
    !invalidatedCredentialAttemptsRef.current.has(attempt) &&
    (attemptHasBaseline(attempt) ||
      (candidate !== attempt.baselineToken &&
        attemptHasQualifiedRetirement(attempt)));
  const mfaSectionRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const hasMfaSetupData = Boolean(mfaSetupData);
  const { registerModalMount } = useShellInputContext();
  const [dirtyConfirmOpen, setDirtyConfirmOpen] = useState(false);
  const [logoutTarget, setLogoutTarget] = useState<AccountLogoutTarget | null>(
    null,
  );
  const [browserResetConfirmOpen, setBrowserResetConfirmOpen] = useState(false);
  const [browserResetPreflight, setBrowserResetPreflight] =
    useState<BrowserResetPreflightResult | null>(null);
  const [browserResetPreflightLoading, setBrowserResetPreflightLoading] =
    useState(false);
  const [browserResetSubmitting, setBrowserResetSubmitting] = useState(false);
  const [browserResetStatusChecking, setBrowserResetStatusChecking] =
    useState(false);
  const [browserResetOutcome, setBrowserResetOutcome] =
    useState<ProfileResetStatusResponse | null>(null);
  const [browserResetPendingOpId, setBrowserResetPendingOpId] = useState<
    string | null
  >(null);
  const [browserResetError, setBrowserResetError] = useState<string | null>(
    null,
  );
  const browserResetCancelRef = useRef<HTMLButtonElement | null>(null);
  const browserResetAbortRef = useRef<AbortController | null>(null);
  const dialogSessionRef = useRef(0);
  const testRequestIdRef = useRef(0);
  const saveOperationRef = useRef(false);
  const browserResetOpRef = useRef(0);
  const logoutWasStaleRef = useRef(false);

  useEffect(() => {
    if (open) {
      return registerModalMount("server-settings-dialog");
    }
    dialogSessionRef.current += 1;
    browserResetOpRef.current += 1;
    setLogoutTarget(null);
    setBrowserResetConfirmOpen(false);
    setBrowserResetPreflightLoading(false);
    setBrowserResetSubmitting(false);
    setBrowserResetStatusChecking(false);
    browserResetAbortRef.current?.abort();
  }, [open, registerModalMount]);
  useEffect(() => {
    if (dirtyConfirmOpen || logoutTarget !== null || browserResetConfirmOpen) {
      return registerModalMount("confirm-dialog");
    }
  }, [
    dirtyConfirmOpen,
    logoutTarget,
    browserResetConfirmOpen,
    registerModalMount,
  ]);

  const isEditMode = profile !== undefined;
  const isDirty = useMemo(() => {
    if (isEditMode) {
      if (profile) {
        return (
          name !== profile.name ||
          url !== profile.url ||
          authType !== profile.authType ||
          username !== (profile.username || "") ||
          password !== "" ||
          token !== initialToken ||
          autoConnect !== (profile.autoConnect ?? true)
        );
      }
      return (
        name !== "" ||
        url !== "" ||
        username !== "" ||
        password !== "" ||
        token !== ""
      );
    }
    return (
      url !== initialUrl ||
      username !== getAuthUsername() ||
      password !== "" ||
      token !== initialToken
    );
  }, [
    isEditMode,
    profile,
    name,
    url,
    authType,
    username,
    password,
    token,
    initialToken,
    initialUrl,
    autoConnect,
  ]);

  const isMutationAwaiting =
    testState === "testing" || mfaSubmitting || mfaLoading;

  const handleRequestClose = useCallback(() => {
    if (!closable) return;
    if (isMutationAwaiting) return;
    if (isDirty && !saved) {
      setDirtyConfirmOpen(true);
    } else {
      onClose();
    }
  }, [closable, isMutationAwaiting, isDirty, saved, onClose]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (dirtyConfirmOpen || logoutTarget !== null || browserResetConfirmOpen)
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleRequestClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    open,
    dirtyConfirmOpen,
    logoutTarget,
    browserResetConfirmOpen,
    handleRequestClose,
  ]);


  const clearAuthDraft = useCallback(() => {
    setMfaChallengeToken("");
    setMfaSetupData(null);
    setMfaError(null);
    setMfaRetryAfter(undefined);
    setMfaSubmitting(false);
    setMfaLoading(false);
  }, []);

  const initiateStepUp = useCallback(
    async (serverUrl: string, existingToken: string, profileId?: string) => {
      const requestId = ++testRequestIdRef.current;
      const endpoint = normalizeServerUrl(serverUrl);
      latestUrlRef.current = endpoint;
      const attempt = captureCredentialAttempt(requestId, endpoint);
      if (attempt.profileId !== profileId) return;
      currentAuthAttemptRef.current = attempt;
      observeCredentialLineage(attempt);
      verifiedCredentialRef.current = null;
      const isCurrent = () => attemptTargetIsCurrent(attempt);
      setMfaMode("verification");
      setMfaLoading(true);
      setTestState("challenge");
      try {
        const challenge = await requestMfaStepUpChallenge(
          serverUrl,
          existingToken,
        );
        if (!isCurrent()) return;
        setMfaChallengeToken(challenge.challengeToken);
        setMfaSetupData(null);
      } catch (err) {
        if (!isCurrent()) return;
        setTestState("idle");
        setTestError(
          err instanceof Error
            ? err.message
            : "Step-up challenge request failed",
        );
      } finally {
        if (attemptIncarnationIsCurrent(attempt)) {
          if (isCurrent()) setMfaLoading(false);
          else rejectInvalidatedAttempt(attempt);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (open) {
      dialogSessionRef.current += 1;
      browserResetOpRef.current += 1;
      const storedUrl =
        profile?.url ?? (profile === undefined ? getServerUrl() : "");
      latestUrlRef.current = normalizeServerUrl(storedUrl);
      testRequestIdRef.current += 1;
      if (profile) {
        // Edit existing profile
        setName(profile.name);
        setUrl(profile.url);
        setAuthType(profile.authType);
        setUsername(profile.username || "");
        setPassword("");
        setAutoConnect(profile.autoConnect ?? true);
      } else if (isEditMode) {
        // New profile (profile = null)
        setName("");
        setUrl("");
        setAuthType("basic");
        setUsername("");
        setPassword("");
        setAutoConnect(true);
      } else {
        // Legacy mode (profile = undefined)
        setName("");
        setUrl(getServerUrl());
        setAuthType("basic");
        setUsername(getAuthUsername());
        setPassword("");
        setAutoConnect(true);
      }
      const tokenProfileId =
        profile?.id ??
        (profile === undefined
          ? (getActiveProfileId() ?? undefined)
          : undefined);
      const storedToken =
        profile === null ? "" : (getAuthToken(tokenProfileId) ?? "");
      stopCredentialObservation();
      currentAuthAttemptRef.current = null;
      verifiedCredentialRef.current = null;
      setInitialUrl(storedUrl);
      setInitialToken(storedToken);
      setToken(storedToken);
      setTestState("idle");
      setTestError(null);
      clearAuthDraft();
      setSaved(false);
      setBrowserResetConfirmOpen(false);
      setBrowserResetPreflight(null);
      setBrowserResetPreflightLoading(false);
      setBrowserResetSubmitting(false);
      setBrowserResetStatusChecking(false);
      setBrowserResetError(null);
      const pendingCtx = getPendingBrowserResetContext(tokenProfileId);
      if (pendingCtx?.operationId && pendingCtx.browserResetState === "cleanupPending") {
        setBrowserResetPendingOpId(pendingCtx.operationId);
        // No canonical epoch retained: the status check supplies the outcome, never a guess.
        setBrowserResetOutcome(
          pendingCtx.profileEpoch === undefined
            ? null
            : {
                status: "cleanupPending",
                profileEpoch: pendingCtx.profileEpoch,
                operationId: pendingCtx.operationId,
                reason: pendingCtx.reason,
              },
        );
      } else {
        setBrowserResetPendingOpId(null);
        setBrowserResetOutcome(null);
      }
      if (profile && storedToken) {
        const snap = getConnectionSnapshot(profile.id);
        if (snap?.status === "mfa-required") {
          void initiateStepUp(
            normalizeServerUrl(storedUrl),
            storedToken,
            profile.id,
          );
        }
      }
    }
    return () => {
      dialogSessionRef.current += 1;
      browserResetOpRef.current += 1;
      browserResetAbortRef.current?.abort();
      stopCredentialObservation();
      clearAuthDraft();
    };
  }, [open, profile, isEditMode, clearAuthDraft, initiateStepUp]);

  useEffect(() => {
    if (!open || testState !== "challenge" || mfaLoading) return;
    const scrollBody = bodyScrollRef.current;
    const mfaSection = mfaSectionRef.current;
    if (!scrollBody || !mfaSection) return;

    const bodyRect = scrollBody.getBoundingClientRect();
    const sectionRect = mfaSection.getBoundingClientRect();
    const bodyHeight = bodyRect.height || bodyRect.bottom - bodyRect.top;
    const sectionHeight =
      sectionRect.height || sectionRect.bottom - sectionRect.top;
    if (bodyHeight <= 0 || sectionHeight <= 0) return;

    if (sectionHeight <= bodyHeight) {
      if (sectionRect.bottom > bodyRect.bottom) {
        scrollBody.scrollTop += sectionRect.bottom - bodyRect.bottom;
      } else if (sectionRect.top < bodyRect.top) {
        scrollBody.scrollTop -= bodyRect.top - sectionRect.top;
      }
    } else if (sectionRect.top !== bodyRect.top) {
      scrollBody.scrollTop += sectionRect.top - bodyRect.top;
    }
  }, [open, testState, mfaMode, mfaLoading, hasMfaSetupData]);

  const rawUrl = url.trim();
  // Auto-prepend protocol for display normalization (matches setServerUrl behavior)
  const normalized = normalizeServerUrl(rawUrl);

  /** Reject non-http(s) schemes to prevent javascript:, data:, etc. */
  const hasUnsupportedScheme =
    /^[a-z][a-z\d+.-]*:/i.test(rawUrl) &&
    !/^https?:\/\//i.test(rawUrl) &&
    !/^(?:[a-z\d.-]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(rawUrl);
  const urlSchemeValid =
    !rawUrl ||
    (!hasUnsupportedScheme &&
      Boolean(normalized) &&
      /^https?:\/\/.+/i.test(normalized));
  const crossOrigin =
    urlSchemeValid && normalized ? isCrossOriginServer(normalized) : false;

  const invalidateConnectionTest = () => {
    stopCredentialObservation();
    testRequestIdRef.current += 1;
    currentAuthAttemptRef.current = null;
    verifiedCredentialRef.current = null;
    setTestState("idle");
    setTestError(null);
    setMfaChallengeToken("");
    setMfaSetupData(null);
    setMfaError(null);
    setMfaRetryAfter(undefined);
    setMfaSubmitting(false);
    setMfaLoading(false);
  };

  async function testConnection() {
    if (!normalized || !urlSchemeValid) return;
    const requestId = ++testRequestIdRef.current;
    const requestUrl = normalized;
    latestUrlRef.current = requestUrl;
    const attempt = captureCredentialAttempt(requestId, requestUrl);
    currentAuthAttemptRef.current = attempt;
    observeCredentialLineage(attempt);
    verifiedCredentialRef.current = null;
    const isCurrentRequest = () => attemptTargetIsCurrent(attempt);

    setTestState("testing");
    setTestError(null);
    setMfaError(null);
    setMfaRetryAfter(undefined);
    try {
      const u = username.trim();
      const p = password.trim();
      if (authType === "basic" && (!u || !p)) {
        setTestState("fail");
        setTestError("Username and password are required");
        return;
      }
      const credentials =
        authType === "none" ? {} : { username: u, password: p };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const result = await login(normalized, credentials, controller.signal);
        if (!isCurrentRequest()) {
          rejectInvalidatedAttempt(attempt);
          return;
        }
        if (result.kind === "session") {
          if (!canAcceptCredential(attempt, result.data.token)) {
            setTestState("fail");
            setTestError(
              "The login changed during verification. Retest before saving.",
            );
            return;
          }
          verifiedCredentialRef.current = {
            attempt,
            candidate: result.data.token,
          };
          setToken(result.data.token);
          setTestState("ok");
          clearAuthDraft();
          clearBrowserViewFenceForProfile(attempt.profileId ?? undefined);
          if (result.data.dev_mode || result.data.devMode) {
            setTestError("✓ Dev mode active");
          }
        } else if (result.kind === "challenge") {
          const { state, challengeToken } = result.data;
          setMfaChallengeToken(challengeToken);
          if (state === "enrollmentRequired") {
            setMfaMode("enrollment");
            setMfaLoading(true);
            setTestState("challenge");
            try {
              const setup = await fetchMfaSetup(
                normalized,
                challengeToken,
                controller.signal,
              );
              if (!isCurrentRequest()) {
                rejectInvalidatedAttempt(attempt);
                return;
              }
              setMfaSetupData(setup);
            } finally {
              if (isCurrentRequest()) setMfaLoading(false);
              else rejectInvalidatedAttempt(attempt);
            }
          } else {
            setMfaMode("verification");
            setMfaSetupData(null);
            setTestState("challenge");
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      if (isCurrentRequest()) {
        setTestState("fail");
        if (e instanceof AuthClientError) {
          setTestError(e.message);
          setMfaRetryAfter(e.retryAfter);
        } else {
          setTestError(e instanceof Error ? e.message : String(e));
        }
      } else {
        rejectInvalidatedAttempt(attempt);
      }
    } finally {
      if (
        attemptIncarnationIsCurrent(attempt) &&
        !attemptTargetIsCurrent(attempt)
      ) {
        rejectInvalidatedAttempt(attempt);
      }
  }
  }
  async function handleMfaCodeSubmit(code: string) {
    const attempt = currentAuthAttemptRef.current;
    if (
      !attempt ||
      !normalized ||
      !mfaChallengeToken ||
      attempt.endpoint !== normalized
    ) {
      return;
    }
    const isCurrentRequest = () =>
      currentAuthAttemptRef.current === attempt &&
      attemptTargetIsCurrent(attempt);

    setMfaSubmitting(true);
    setMfaError(null);
    setMfaRetryAfter(undefined);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const session =
          mfaMode === "enrollment"
            ? await confirmMfaEnrollment(
                normalized,
                mfaChallengeToken,
                code,
                controller.signal,
              )
            : await verifyMfa(
                normalized,
                mfaChallengeToken,
                code,
                controller.signal,
              );
        if (!isCurrentRequest()) return;
        if (!canAcceptCredential(attempt, session.token)) {
          verifiedCredentialRef.current = null;
          setTestState("fail");
          setTestError(
            "The login changed during verification. Retest before saving.",
          );
          return;
        }
        verifiedCredentialRef.current = { attempt, candidate: session.token };
        setToken(session.token);
        setTestState("ok");
        clearAuthDraft();
        clearBrowserViewFenceForProfile(attempt.profileId ?? undefined);
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      if (isCurrentRequest()) {
        if (e instanceof AuthClientError) {
          setMfaError(e.message);
          setMfaRetryAfter(e.retryAfter);
        } else {
          setMfaError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      if (attemptIncarnationIsCurrent(attempt)) {
        if (isCurrentRequest()) setMfaSubmitting(false);
        else rejectInvalidatedAttempt(attempt);
      }
    }
  }

  function handleMfaCancel() {
    clearAuthDraft();
    stopCredentialObservation();
    testRequestIdRef.current += 1;
    currentAuthAttemptRef.current = null;
    verifiedCredentialRef.current = null;
    setTestState("idle");
  }

  async function handleSave(): Promise<boolean> {
    if (saveOperationRef.current) return false;
    saveOperationRef.current = true;
    try {
      return await persistSettings();
    } finally {
      saveOperationRef.current = false;
    }
  }

  async function persistSettings(): Promise<boolean> {
    if (!urlSchemeValid) return false;
    const t = token.trim();
    const urlChanged = haveServerUrlsChanged(initialUrl, normalized);
    const tokenMustBeCleared = shouldClearAuthTokenForUrlChange(
      initialUrl,
      normalized,
      initialToken,
      t,
    );

    const verified = verifiedCredentialRef.current;
    const attempt = verified?.attempt;
    if (
      !verified ||
      !attempt ||
      verified !== verifiedCredentialRef.current ||
      attempt !== currentAuthAttemptRef.current ||
      verified.candidate !== t ||
      attempt.endpoint !== normalized ||
      attempt.authType !== authType ||
      !canAcceptCredential(attempt, verified.candidate)
    ) {
      setTestState("fail");
      setTestError(
        "The login changed while this dialog was open. Test the connection again before saving.",
      );
      return false;
    }
    let ownerProfileId = attempt.profileId;
    let expectedProfileUrl = attempt.persistedUrl;
    let expectedProfileAuthType = attempt.persistedAuthType;
    let expectedProfileCreatedAt = attempt.profileCreatedAt;
    let expectedProfileName = attempt.profileName;
    let expectedProfileUsername = attempt.profileUsername;
    let expectedProfileAutoConnect = attempt.profileAutoConnect;
    let expectedLegacyServerUrl = attempt.legacyServerUrl;
    let expectedLegacyServerUrlExplicit = attempt.legacyServerUrlExplicit;
    let expectedToken = currentAttemptToken(attempt);
    let expectedGeneration = currentAttemptGeneration(attempt);
    const saveSession = attempt.dialogSession;
    const targetStillCurrent = () => {
      if (
        !open ||
        dialogSessionRef.current !== saveSession ||
        currentAuthAttemptRef.current !== attempt ||
        testRequestIdRef.current !== attempt.requestId ||
        latestAuthTypeRef.current !== attempt.authType ||
        latestUrlRef.current !== attempt.endpoint
      ) {
        return false;
      }
      const currentProfile = latestProfileRef.current;
      if (
        (attempt.mode === "saved" &&
          currentProfile?.id !== attempt.profileId) ||
        (attempt.mode === "legacy" &&
          (currentProfile !== undefined ||
            getActiveProfileId() !== attempt.activeProfileId ||
            normalizeServerUrl(getServerUrl()) !==
              normalizeServerUrl(expectedLegacyServerUrl ?? "") ||
            hasServerUrl() !== expectedLegacyServerUrlExplicit)) ||
        (attempt.mode === "new" && currentProfile !== null)
      ) {
        return false;
      }
      if (!ownerProfileId) {
        return attempt.mode === "new" || attempt.activeProfileId === null;
      }
      const persisted = getProfiles().find(
        (candidate) => candidate.id === ownerProfileId,
      );
      return Boolean(
        persisted &&
          persisted.createdAt === expectedProfileCreatedAt &&
          persisted.name === expectedProfileName &&
          persisted.username === expectedProfileUsername &&
          persisted.autoConnect === expectedProfileAutoConnect &&
          normalizeServerUrl(persisted.url) === expectedProfileUrl &&
          persisted.authType === expectedProfileAuthType,
      );
    };
    const currentOperationToken = () =>
      ownerProfileId ? getAuthToken(ownerProfileId) : null;
    const currentOperationGeneration = () =>
      ownerProfileId
        ? (getConnectionSnapshot(ownerProfileId)?.owner.generation ?? null)
        : null;
    const ownsSaveCredential = () =>
      targetStillCurrent() &&
      !invalidatedCredentialAttemptsRef.current.has(attempt) &&
      currentOperationToken() === expectedToken &&
      currentOperationGeneration() === expectedGeneration;
    const mutateOwnedCredential = <T,>(mutation: () => T): T => {
      const previousMutation = saveCredentialMutationRef.current;
      saveCredentialMutationRef.current = {
        attempt,
        revision: getProfileChangeVersion() + 1,
      };
      try {
        return mutation();
      } finally {
        saveCredentialMutationRef.current = previousMutation;
      }
    };
    const acceptOwnedTransition = (
      expectedTokenAfter: string | null,
      generationBefore: number | null,
      allowedGenerationDelta = 1,
      allowInitialGeneration = false,
    ) => {
      const actualGeneration = currentOperationGeneration();
      const acceptedInitialGeneration =
        allowInitialGeneration &&
        generationBefore === null &&
        (actualGeneration === 1 || actualGeneration === 2);
      const generationDelta =
        actualGeneration === null || generationBefore === null
          ? actualGeneration === generationBefore
            ? 0
            : null
          : actualGeneration - generationBefore;
      if (
        !targetStillCurrent() ||
        invalidatedCredentialAttemptsRef.current.has(attempt) ||
        currentOperationToken() !== expectedTokenAfter ||
        (!acceptedInitialGeneration &&
          (generationDelta === null ||
            generationDelta < 0 ||
            generationDelta > allowedGenerationDelta))
      ) {
        return false;
      }
      expectedToken = expectedTokenAfter;
      expectedGeneration = actualGeneration;
      return true;
    };
    const abortLostCredential = () => {
      if (
        dialogSessionRef.current === saveSession &&
        currentAuthAttemptRef.current === attempt &&
        testRequestIdRef.current === attempt.requestId
      ) {
        setTestState("fail");
        setTestError(
          "The login changed while saving. Reauthenticate and try again.",
        );
      }
      return false;
    };
    if (!ownsSaveCredential()) return abortLostCredential();


    if (isEditMode) {
      const previousProfiles = getProfiles().map((item) => ({ ...item }));
      const previousActiveProfileId = getActiveProfileId();
      const previousProfile = attempt.profileId
        ? previousProfiles.find((item) => item.id === attempt.profileId) ?? null
        : null;
      const previousProfileMediaClientId = previousProfile
        ? getMediaClientIdForProfile(previousProfile.id)
        : null;
      const previousProfileToken = expectedToken;
      const authTypeChanged =
        attempt.persistedAuthType !== null &&
        attempt.persistedAuthType !== authType;
      const shouldRevokePreviousProfileSession = Boolean(
        previousProfileToken &&
          (urlChanged || authTypeChanged || previousProfileToken !== t),
      );
      const profileData = {
        name: name.trim() || "Unnamed Server",
        url: normalized,
        authType,
        username:
          authType === "basic" ? username.trim() || undefined : undefined,
        autoConnect,
      };
      
      const profileMatchesDraft = (candidate: ServerProfile) =>
        candidate.name === profileData.name &&
        normalizeServerUrl(candidate.url) === normalized &&
        candidate.authType === authType &&
        candidate.username === profileData.username &&
        candidate.autoConnect === profileData.autoConnect;
      const restoreProfileState = (): boolean => {
        const profileId = ownerProfileId;
        if (!profileId || !ownsSaveCredential()) return false;
        const currentProfiles = getProfiles();
        const currentTarget = currentProfiles.find(
          (item) => item.id === profileId,
        );
        if (
          !currentTarget ||
          currentTarget.createdAt !== expectedProfileCreatedAt ||
          currentTarget.name !== expectedProfileName ||
          currentTarget.username !== expectedProfileUsername ||
          currentTarget.autoConnect !== expectedProfileAutoConnect ||
          normalizeServerUrl(currentTarget.url) !== expectedProfileUrl ||
          currentTarget.authType !== expectedProfileAuthType
        ) {
          return false;
        }
        const generationBefore = expectedGeneration;
        const nextProfiles = previousProfile
          ? currentProfiles.map((item) =>
              item.id === profileId ? { ...previousProfile } : { ...item },
            )
          : currentProfiles
              .filter((item) => item.id !== profileId)
              .map((item) => ({ ...item }));
        if (!saveProfiles(nextProfiles)) return false;
        if (invalidatedCredentialAttemptsRef.current.has(attempt)) return false;

        const persistedAfterRestore = getProfiles();
        const restoredTarget = persistedAfterRestore.find(
          (item) => item.id === profileId,
        );
        const targetWasRestored = previousProfile
          ? Boolean(
              restoredTarget &&
                restoredTarget.createdAt === previousProfile.createdAt &&
                restoredTarget.name === previousProfile.name &&
                restoredTarget.username === previousProfile.username &&
                restoredTarget.autoConnect === previousProfile.autoConnect &&
                normalizeServerUrl(restoredTarget.url) ===
                  normalizeServerUrl(previousProfile.url) &&
                restoredTarget.authType === previousProfile.authType,
            )
          : !restoredTarget;
        const generationAfter = currentOperationGeneration();
        const generationDelta =
          generationAfter === null || generationBefore === null
            ? generationAfter === generationBefore
              ? 0
              : null
            : generationAfter - generationBefore;
        if (!targetWasRestored || generationDelta === null ||
          generationDelta < 0 || generationDelta > 1) {
          return false;
        }
        const activeProfileAfterRestore = getActiveProfileId();
        if (
          previousProfile &&
          activeProfileAfterRestore !== previousActiveProfileId
        ) {
          return false;
        }
        if (!previousProfile && activeProfileAfterRestore === profileId) {
          const activeRestored = previousActiveProfileId
            ? setActiveProfile(previousActiveProfileId)
            : clearActiveProfile();
          if (!activeRestored) return false;
        }
        if (getActiveProfileId() !== previousActiveProfileId) return false;
        if (previousProfile) {
          expectedProfileUrl = normalizeServerUrl(previousProfile.url);
          expectedProfileAuthType = previousProfile.authType;
          expectedProfileCreatedAt = previousProfile.createdAt;
          expectedProfileName = previousProfile.name;
          expectedProfileUsername = previousProfile.username;
          expectedProfileAutoConnect = previousProfile.autoConnect;
          expectedGeneration = generationAfter;
          if (invalidatedCredentialAttemptsRef.current.has(attempt)) {
            return false;
          }
          const restoredToken = currentOperationToken();
          if (
            restoredToken !== previousProfileToken &&
            restoredToken !== null
          ) {
            return false;
          }
          expectedToken = restoredToken;
          if (!ownsSaveCredential()) return false;
          if (restoredToken === previousProfileToken) return true;
          if (previousProfileToken === null) return false;
          const tokenGenerationBefore = expectedGeneration;
          if (!mutateOwnedCredential(() =>
            setAuthToken(previousProfileToken, profileId)
          )) return false;
          return acceptOwnedTransition(
            previousProfileToken,
            tokenGenerationBefore,
          );
        }

        expectedGeneration = generationAfter;
        return Boolean(
          attempt.mode === "new" &&
            dialogSessionRef.current === saveSession &&
            currentAuthAttemptRef.current === attempt &&
            testRequestIdRef.current === attempt.requestId &&
            latestProfileRef.current === null &&
            !invalidatedCredentialAttemptsRef.current.has(attempt) &&
            !getProfiles().some((item) => item.id === profileId) &&
            currentOperationToken() === null &&
            currentOperationGeneration() === expectedGeneration &&
            getActiveProfileId() === previousActiveProfileId,
        );
      };
      
      
      let savedProfile: ServerProfile;
      if (profile) {
        const generationBefore = expectedGeneration;
        const transitionBefore = getConnectionSnapshot(profile.id);
        const updateSucceeded = updateProfile(profile.id, profileData);
        const persistedProfile = getProfiles().find(
          (candidate) => candidate.id === profile.id,
        );

        if (persistedProfile && profileMatchesDraft(persistedProfile)) {
          expectedProfileUrl = normalized;
          expectedProfileAuthType = authType;
          expectedProfileName = profileData.name;
          expectedProfileUsername = profileData.username;
          expectedProfileAutoConnect = profileData.autoConnect;
          const tokenAfterMetadata =
            urlChanged || authTypeChanged ? null : previousProfileToken;
          const ownedGenerationDelta =
            !urlChanged &&
            profile.authType === "basic" &&
            authType === "none" &&
            transitionBefore?.intent
              ? 2
              : 1;
          if (
            !acceptOwnedTransition(
              tokenAfterMetadata,
              generationBefore,
              ownedGenerationDelta,
            )
          ) {
            return abortLostCredential();
          }
          savedProfile = { ...profile, ...profileData };
        } else if (updateSucceeded) {
          return abortLostCredential();
        } else {
          setTestState("fail");
          setTestError("Unable to persist the server profile in this browser");
          return false;
        }
        if (!updateSucceeded) {
          const restored = restoreProfileState();
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to persist the server profile in this browser"
              : "Unable to persist the server profile; its previous login was not restored",
          );
          return false;
        }

      } else {
        const generationBefore = expectedGeneration;
        savedProfile = createProfile(profileData);
        ownerProfileId = savedProfile.id;
        expectedProfileUrl = normalized;
        expectedProfileAuthType = authType;
        expectedProfileCreatedAt = savedProfile.createdAt;
        expectedProfileName = savedProfile.name;
        expectedProfileUsername = savedProfile.username;
        expectedProfileAutoConnect = savedProfile.autoConnect;
        if (
          !getProfiles().some(
            (candidate) =>
              candidate.id === savedProfile.id &&
              profileMatchesDraft(candidate),
          ) ||
          !acceptOwnedTransition(null, generationBefore, 1, true)
        ) {
          return abortLostCredential();
        }
        const generationBeforeActivation = expectedGeneration;
        const activationSucceeded = setActiveProfile(savedProfile.id);
        if (
          !activationSucceeded ||
          !acceptOwnedTransition(
            null,
            generationBeforeActivation,
            1,
            true,
          )
        ) {
          const restored = restoreProfileState();
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to activate the new server profile"
              : "Unable to activate the new profile without overwriting another profile",
          );
          return false;
        }
      }

      if (shouldRevokePreviousProfileSession) {
        if (!ownsSaveCredential()) return abortLostCredential();
        await revokeCurrentMediaSession(
          previousProfile!.url,
          previousProfileToken!,
          previousProfileMediaClientId,
        );
        if (!ownsSaveCredential()) return abortLostCredential();
      }

      const needsTokenClear =
        previousProfileToken !== null &&
        (shouldRevokePreviousProfileSession ||
          urlChanged ||
          authTypeChanged ||
          tokenMustBeCleared ||
          !t);
      if (needsTokenClear) {
        if (!ownsSaveCredential()) return abortLostCredential();
        const generationBefore = expectedGeneration;
        const clearSucceeded = mutateOwnedCredential(() =>
          clearAuthToken(savedProfile.id),
        );
        if (!clearSucceeded) {
          const partialClearOwned = acceptOwnedTransition(
            null,
            generationBefore,
          );
          const restored = partialClearOwned && restoreProfileState();
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to clear the previous login token in this browser"
              : "Unable to clear the previous login token; its prior login was not restored",
          );
          return false;
        }
        if (!acceptOwnedTransition(null, generationBefore)) {
          return abortLostCredential();
        }
      }

      if (
        t &&
        !tokenMustBeCleared &&
        currentOperationToken() !== t
      ) {
        if (!ownsSaveCredential()) return abortLostCredential();
        const generationBefore = expectedGeneration;
        const reconnectIntent =
          getConnectionSnapshot(savedProfile.id)?.intent ?? false;
        if (!mutateOwnedCredential(() => setAuthToken(t, savedProfile.id))) {
          restoreProfileState();
          setTestState("fail");
          setTestError("Unable to persist the login token in this browser");
          return false;
        }
        if (!acceptOwnedTransition(
          t,
          generationBefore,
          reconnectIntent ? 2 : 1,
          attempt.mode === "new",
        )) {
          return abortLostCredential();
        }
      }

      if (!ownsSaveCredential()) return abortLostCredential();
      if (urlChanged || tokenMustBeCleared || t) {
        const generationBefore = expectedGeneration;
        disconnectProfile(savedProfile.id);
        if (!acceptOwnedTransition(
          expectedToken,
          generationBefore,
          1,
          attempt.mode === "new",
        )) {
          return abortLostCredential();
        }
        if (
          savedProfile.autoConnect &&
          (savedProfile.authType === "none" || currentOperationToken())
        ) {
          const generationBeforeConnect = expectedGeneration;
          void connectProfile(savedProfile.id);
          if (
            !acceptOwnedTransition(
              expectedToken,
              generationBeforeConnect,
              1,
              attempt.mode === "new" ||
                (attempt.mode === "saved" &&
                  generationBeforeConnect === null &&
                  savedProfile.autoConnect),
            )
          ) {
            return abortLostCredential();
          }
        }
      }
      stopCredentialObservation();
      setSaved(true);
      onSaved?.(savedProfile);
      return true;
    } else {
      // Legacy mode: direct URL/token storage, bound to the profile selected
      // when authentication began.
      const activeProfileId = attempt.profileId ?? undefined;
      const previousLegacyToken = expectedToken;
      const previousLegacyUrl = attempt.legacyServerUrl ?? initialUrl;
      const previousUrlWasExplicit = attempt.legacyServerUrlExplicit ?? false;
      const previousLegacyMediaClientId = activeProfileId
        ? getMediaClientIdForProfile(activeProfileId)
        : null;
      const shouldRevokePreviousLegacySession = Boolean(
        previousLegacyToken &&
          (urlChanged || previousLegacyToken !== t),
      );
      const restoreLegacyState = (): boolean => {
        if (!ownsSaveCredential()) return false;
        const urlRestored = previousUrlWasExplicit
          ? setServerUrl(previousLegacyUrl)
          : clearServerUrl();
        if (!urlRestored) return false;
        const restoredUrl = getServerUrl();
        const restoredUrlExplicit = hasServerUrl();
        if (
          normalizeServerUrl(restoredUrl) !==
            normalizeServerUrl(previousLegacyUrl) ||
          restoredUrlExplicit !== previousUrlWasExplicit ||
          getActiveProfileId() !== attempt.activeProfileId
        ) {
          return false;
        }
        expectedLegacyServerUrl = restoredUrl;
        expectedLegacyServerUrlExplicit = restoredUrlExplicit;
        if (currentOperationToken() === previousLegacyToken) {
          expectedToken = previousLegacyToken;
          return true;
        }
        if (
          currentOperationToken() !== null ||
          previousLegacyToken === null
        ) {
          return false;
        }
        const generationBefore = expectedGeneration;
        if (!mutateOwnedCredential(() =>
          setAuthToken(previousLegacyToken, activeProfileId)
        )) return false;
        return acceptOwnedTransition(previousLegacyToken, generationBefore);
      };

      const isSameOrigin =
        !normalized || normalized === `${location.protocol}//${location.host}`;
      const urlPersisted = isSameOrigin
        ? clearServerUrl()
        : setServerUrl(normalized);
      if (!urlPersisted) {
        const restored = restoreLegacyState();
        setTestState("fail");
        setTestError(
          restored
            ? "Unable to persist the server URL in this browser"
            : "Unable to persist the server URL; the previous login was not restored",
        );
        return false;
      }
      expectedLegacyServerUrl = getServerUrl();
      expectedLegacyServerUrlExplicit = hasServerUrl();
      if (!ownsSaveCredential()) return abortLostCredential();

      if (shouldRevokePreviousLegacySession) {
        if (!ownsSaveCredential()) return abortLostCredential();
        await revokeCurrentMediaSession(
          previousLegacyUrl,
          previousLegacyToken!,
          previousLegacyMediaClientId,
        );
        if (!ownsSaveCredential()) return abortLostCredential();
      }

      const needsTokenClear =
        previousLegacyToken !== null &&
        (shouldRevokePreviousLegacySession ||
          urlChanged ||
          tokenMustBeCleared ||
          !t);
      if (needsTokenClear) {
        if (!ownsSaveCredential()) return abortLostCredential();
        const generationBefore = expectedGeneration;
        const clearSucceeded = mutateOwnedCredential(() =>
          clearAuthToken(activeProfileId),
        );
        if (!clearSucceeded) {
          const partialClearOwned = acceptOwnedTransition(
            null,
            generationBefore,
          );
          const restored = partialClearOwned && restoreLegacyState();
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to clear the previous login token in this browser"
              : "Unable to clear the previous login token; its prior login was not restored",
          );
          return false;
        }
        if (!acceptOwnedTransition(null, generationBefore)) {
          return abortLostCredential();
        }
      }

      if (t && !tokenMustBeCleared && currentOperationToken() !== t) {
        if (!ownsSaveCredential()) return abortLostCredential();
        const generationBefore = expectedGeneration;
        if (!mutateOwnedCredential(() => setAuthToken(t, activeProfileId))) {
          restoreLegacyState();
          setTestState("fail");
          setTestError("Unable to persist the login token in this browser");
          return false;
        }
        if (!acceptOwnedTransition(t, generationBefore)) {
          return abortLostCredential();
        }
      }

      if (!ownsSaveCredential()) return abortLostCredential();
      if (username) {
        setAuthUsername(username.trim());
      } else {
        clearAuthUsername();
      }
      stopCredentialObservation();
      setSaved(true);
      setTimeout(() => {
        if (ownsSaveCredential()) window.location.reload();
      }, 800);
      return true;
    }
  }

  function handleReset() {
    const defaultUrl = `${location.protocol}//${location.host}`;
    invalidateConnectionTest();
    latestUrlRef.current = normalizeServerUrl(defaultUrl);
    setUrl(defaultUrl);
    setToken("");
    setUsername("");
    setPassword("");
  }

  function handleLogout() {
    const storedProfile = profile?.id
      ? getProfiles().find((candidate) => candidate.id === profile.id)
      : getActiveProfile();
    const targetProfileId =
      storedProfile?.id ??
      profile?.id ??
      (profile === undefined ? (getActiveProfileId() ?? undefined) : undefined);
    // The dialog may outlive a concurrently deleted profile. Its immutable
    // prop still identifies the origin whose session must be revoked before
    // removing the remaining profile-scoped token.
    const targetServerUrl =
      storedProfile?.url ?? profile?.url ?? getServerUrl();
    const targetToken = getAuthToken(targetProfileId);
    const targetName =
      storedProfile?.name ?? profile?.name ?? targetServerUrl;
    const targetGeneration = targetProfileId
      ? (getConnectionSnapshot(targetProfileId)?.owner.generation ?? 0)
      : undefined;
    logoutWasStaleRef.current = false;
    setLogoutTarget({
      profileId: targetProfileId,
      generation: targetGeneration,
      profileName: targetName,
      serverUrl: targetServerUrl,
      token: targetToken,
      mediaClientId: targetProfileId
        ? getMediaClientIdForProfile(targetProfileId)
        : null,
      sourceProfile: storedProfile ?? profile ?? undefined,
    });
  }

  const targetProfileId =
    profile?.id ??
    (profile === undefined ? (getActiveProfileId() ?? undefined) : undefined);
  const storedProfileToken =
    profile !== null ? getAuthToken(targetProfileId) : null;
  const effectiveBrowserToken =
    (token.trim() || storedProfileToken) ?? null;
  const hasToken = profile !== null && Boolean(storedProfileToken);

  const canManageBrowserReset =
    profile !== null &&
    Boolean(normalized) &&
    urlSchemeValid &&
    (hasToken ||
      testState === "ok" ||
      Boolean(browserResetOutcome) ||
      Boolean(browserResetPendingOpId));

  const canConfirmBrowserReset =
    !browserResetSubmitting &&
    !browserResetPreflightLoading &&
    browserResetPreflight?.kind === "admitted" &&
    (browserResetPreflight.available ||
      browserResetPreflight.managedProfilePresent ||
      /cleanup pending/i.test(browserResetPreflight.unavailableReason ?? ""));

  function isCurrentBrowserResetAttempt(
    capturedDialogSession: number,
    capturedResetOp: number,
    capturedUrl: string,
    capturedPropProfileId: string | undefined,
  ): boolean {
    return (
      dialogSessionRef.current === capturedDialogSession &&
      browserResetOpRef.current === capturedResetOp &&
      latestUrlRef.current === capturedUrl &&
      latestProfileIdRef.current === capturedPropProfileId
    );
  }

  async function openBrowserResetConfirm() {
    if (!normalized || !urlSchemeValid) return;
    browserResetAbortRef.current?.abort();
    const controller = new AbortController();
    browserResetAbortRef.current = controller;
    const capturedDialogSession = dialogSessionRef.current;
    const capturedResetOp = ++browserResetOpRef.current;
    const capturedUrl = normalized;
    const capturedProfileId = profile?.id;
    const timer = setTimeout(() => controller.abort(), 10000);

    setBrowserResetError(null);
    setBrowserResetPreflight(null);
    setBrowserResetPreflightLoading(true);
    setBrowserResetConfirmOpen(true);

    try {
      const res = await preflightBrowserCapabilitiesForOrigin(
        capturedUrl,
        effectiveBrowserToken,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        isCurrentBrowserResetAttempt(
          capturedDialogSession,
          capturedResetOp,
          capturedUrl,
          capturedProfileId,
        )
      ) {
        setBrowserResetPreflight(res);
      }
    } catch (err) {
      if (
        !controller.signal.aborted &&
        isCurrentBrowserResetAttempt(
          capturedDialogSession,
          capturedResetOp,
          capturedUrl,
          capturedProfileId,
        )
      ) {
        setBrowserResetPreflight({
          kind: "unreachable",
          status: null,
          reason:
            err instanceof Error
              ? err.message
              : "Unable to verify Browser admission",
        });
      }
    } finally {
      clearTimeout(timer);
      if (
        dialogSessionRef.current === capturedDialogSession &&
        browserResetOpRef.current === capturedResetOp
      ) {
        setBrowserResetPreflightLoading(false);
      }
    }
  }

  async function handleConfirmBrowserReset() {
    if (
      !normalized ||
      !urlSchemeValid ||
      !canConfirmBrowserReset ||
      browserResetPreflight?.kind !== "admitted"
    ) {
      return;
    }
    const capturedDialogSession = dialogSessionRef.current;
    const capturedResetOp = ++browserResetOpRef.current;
    const capturedUrl = normalized;
    const capturedProfileId = targetProfileId;
    const capturedPropProfileId = profile?.id;
    const capturedToken = effectiveBrowserToken;
    const capturedGeneration = capturedProfileId
      ? (getConnectionSnapshot(capturedProfileId)?.owner.generation ?? 0)
      : undefined;
    const opId = browserResetPendingOpId ?? generateUUID();
    const controller = new AbortController();
    browserResetAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 10000);

    setBrowserResetSubmitting(true);
    setBrowserResetError(null);
    setBrowserResetPendingOpId(opId);
    setPendingBrowserResetContext(capturedProfileId, {
      operationId: opId,
      profileEpoch: browserResetPreflight.profileEpoch,
      browserResetState: "cleanupPending",
      reason: "Shared Browser reset requested",
    });

    try {
      const outcome = await resetBrowserProfileForOrigin(
        capturedUrl,
        capturedToken,
        {
          operationId: opId,
          expectedProfileEpoch: browserResetPreflight.profileEpoch,
          confirmed: true,
        },
        controller.signal,
      );
      fenceBrowserViewsForProfile(
        capturedProfileId,
        "Shared Browser profile reset or logged out",
        capturedGeneration,
      );
      if (
        !isCurrentBrowserResetAttempt(
          capturedDialogSession,
          capturedResetOp,
          capturedUrl,
          capturedPropProfileId,
        )
      ) {
        return;
      }
      setBrowserResetOutcome(outcome);
      setBrowserResetConfirmOpen(false);
      if (outcome.status === "cleanupPending") {
        const trackedOp = outcome.operationId ?? opId;
        setBrowserResetPendingOpId(trackedOp);
        setPendingBrowserResetContext(capturedProfileId, {
          operationId: trackedOp,
          profileEpoch: outcome.profileEpoch,
          browserResetState: "cleanupPending",
          reason: outcome.reason,
        });
      } else {
        setBrowserResetPendingOpId(null);
        setPendingBrowserResetContext(capturedProfileId, null);
      }
    } catch (err) {
      const adoptedOpId =
        err instanceof BrowserHostClientError && err.operationId
          ? err.operationId
          : opId;
      const isCleanupPendingConflict =
        err instanceof BrowserHostClientError &&
        (err.kind === "cleanupPending" || err.status === 409) &&
        Boolean(
          err.operationId || /cleanupPending|cleanup already/i.test(err.message),
        );
      const isExplicitPreCommitReject =
        err instanceof BrowserHostClientError &&
        err.status !== undefined &&
        err.status >= 400 &&
        err.status < 500 &&
        !isCleanupPendingConflict;

      if (isExplicitPreCommitReject) {
        setPendingBrowserResetContext(capturedProfileId, null);
        if (
          isCurrentBrowserResetAttempt(
            capturedDialogSession,
            capturedResetOp,
            capturedUrl,
            capturedPropProfileId,
          )
        ) {
          setBrowserResetPendingOpId(null);
          setBrowserResetError(err.message);
        }
      } else {
        fenceBrowserViewsForProfile(
          capturedProfileId,
          "Shared Browser profile reset or logged out",
          capturedGeneration,
        );
        const pendingReason =
          err instanceof Error
            ? err.message
            : "Shared Browser reset outcome uncertain; check status or resume cleanup.";
        setPendingBrowserResetContext(capturedProfileId, {
          operationId: adoptedOpId,
          profileEpoch: browserResetPreflight.profileEpoch,
          browserResetState: "cleanupPending",
          reason: pendingReason,
        });
        if (
          isCurrentBrowserResetAttempt(
            capturedDialogSession,
            capturedResetOp,
            capturedUrl,
            capturedPropProfileId,
          )
        ) {
          setBrowserResetPendingOpId(adoptedOpId);
          setBrowserResetOutcome({
            status: "cleanupPending",
            profileEpoch: browserResetPreflight.profileEpoch,
            operationId: adoptedOpId,
            reason: pendingReason,
          });
          setBrowserResetConfirmOpen(false);
        }
      }
    } finally {
      clearTimeout(timer);
      if (
        dialogSessionRef.current === capturedDialogSession &&
        browserResetOpRef.current === capturedResetOp
      ) {
        setBrowserResetSubmitting(false);
      }
    }
  }

  async function handleCheckBrowserResetStatus() {
    const opId = browserResetPendingOpId ?? browserResetOutcome?.operationId;
    if (!normalized || !urlSchemeValid || !opId) return;
    const capturedDialogSession = dialogSessionRef.current;
    const capturedResetOp = ++browserResetOpRef.current;
    const capturedUrl = normalized;
    const capturedProfileId = targetProfileId;
    const capturedPropProfileId = profile?.id;
    const capturedToken = effectiveBrowserToken;
    const capturedGeneration = capturedProfileId
      ? (getConnectionSnapshot(capturedProfileId)?.owner.generation ?? 0)
      : undefined;
    const controller = new AbortController();
    browserResetAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 10000);

    setBrowserResetStatusChecking(true);
    setBrowserResetError(null);
    try {
      const status = await getBrowserProfileResetStatusForOrigin(
        capturedUrl,
        capturedToken,
        opId,
        controller.signal,
      );
      fenceBrowserViewsForProfile(
        capturedProfileId,
        "Shared Browser profile reset or logged out",
        capturedGeneration,
      );
      if (status.status === "completed") {
        setPendingBrowserResetContext(capturedProfileId, null);
      }
      if (
        !isCurrentBrowserResetAttempt(
          capturedDialogSession,
          capturedResetOp,
          capturedUrl,
          capturedPropProfileId,
        )
      ) {
        return;
      }
      setBrowserResetOutcome(status);
      if (status.status === "completed") {
        setBrowserResetPendingOpId(null);
      }
    } catch (err) {
      if (
        isCurrentBrowserResetAttempt(
          capturedDialogSession,
          capturedResetOp,
          capturedUrl,
          capturedPropProfileId,
        )
      ) {
        setBrowserResetError(
          err instanceof Error
            ? err.message
            : "Unable to query Browser reset status",
        );
      }
    } finally {
      clearTimeout(timer);
      if (
        dialogSessionRef.current === capturedDialogSession &&
        browserResetOpRef.current === capturedResetOp
      ) {
        setBrowserResetStatusChecking(false);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="safe-area-inline safe-area-bottom fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (
          closable &&
          e.target === e.currentTarget &&
          logoutTarget === null &&
          !browserResetConfirmOpen
        ) {
          handleRequestClose();
        }
      }}
    >
      <div
        className="dialog-viewport-fit flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-2xl"
        style={{ background: "var(--color-surface)" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--color-primary)]" />
            <span className="text-sm font-semibold text-[var(--color-text)] tracking-wide">
              Server Connection
            </span>
          </div>
          {closable && (
            <button
              onClick={handleRequestClose}
              className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div
          ref={bodyScrollRef}
          data-testid="server-settings-dialog-body"
          data-dialog-scroll-body="true"
          className="compact-scroll-region min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
          {isEditMode && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                Profile Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Server"
                className="w-full rounded-lg border px-3.5 py-2 text-sm transition-colors focus:outline-none focus:ring-2"
                style={{
                  background: "var(--color-background)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                  caretColor: "var(--color-primary)",
                }}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
              Server URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                invalidateConnectionTest();
                latestUrlRef.current = normalizeServerUrl(e.target.value);
                setUrl(e.target.value);
              }}
              placeholder="http://127.0.0.1:4801"
              data-auth-input="true"
              className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
              style={{
                background: "var(--color-background)",
                borderColor: !urlSchemeValid
                  ? "var(--color-error, #ef4444)"
                  : "var(--color-border)",
                color: "var(--color-text)",
                caretColor: "var(--color-primary)",
              }}
            />
            {!urlSchemeValid && (
              <p className="mt-1.5 text-xs text-red-400">
                URL must start with http:// or https://
              </p>
            )}
            {urlSchemeValid && crossOrigin && (
              <p className="mt-1.5 text-xs text-yellow-400/80">
                Separate-origin access requires this exact frontend origin in
                the server&apos;s DAM_HOPPER_CORS_ORIGINS setting. Media still
                requires authenticated tickets.
              </p>
            )}
          </div>

          {isEditMode && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                Authentication Type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                  <input
                    type="radio"
                    name="authType"
                    value="basic"
                    checked={authType === "basic"}
                    onChange={() => {
                      invalidateConnectionTest();
                      setAuthType("basic");
                    }}
                    className="cursor-pointer"
                  />
                  Basic Auth
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                  <input
                    type="radio"
                    name="authType"
                    value="none"
                    checked={authType === "none"}
                    onChange={() => {
                      invalidateConnectionTest();
                      setAuthType("none");
                    }}
                    className="cursor-pointer"
                  />
                  No Auth (Dev Mode)
                </label>
              </div>
            </div>
          )}
          {isEditMode && (
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoConnect}
                onChange={(e) => setAutoConnect(e.target.checked)}
                className="cursor-pointer rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-0"
              />
              Auto-connect on startup
            </label>
          )}

          {authType === "basic" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    invalidateConnectionTest();
                    setUsername(e.target.value);
                  }}
                  placeholder="Username"
                  data-auth-input="true"
                  className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    background: "var(--color-background)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                    caretColor: "var(--color-primary)",
                  }}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                  Password {crossOrigin ? "(required)" : ""}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    invalidateConnectionTest();
                    setPassword(e.target.value);
                  }}
                  placeholder="Password"
                  data-auth-input="true"
                  className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2 mb-2"
                  style={{
                    background: "var(--color-background)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                    caretColor: "var(--color-primary)",
                  }}
                />
              </div>
            </>
          )}

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={testConnection}
              disabled={
                !normalized ||
                !urlSchemeValid ||
                testState === "testing" ||
                testState === "challenge"
              }
              className="rounded-lg px-3.5 py-2 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{
                background: "var(--color-surface-2)",
                color: "var(--color-text)",
              }}
            >
              {testState === "testing" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Testing…
                </span>
              ) : (
                "Test connection"
              )}
            </button>

            {testState === "ok" && (
              <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
                <CheckCircle2 size={13} /> Reachable
              </span>
            )}
            {testState === "fail" && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <XCircle size={13} /> {testError ?? "Unreachable"}
              </span>
            )}
          </div>

          {testState === "challenge" && (
            <div
              ref={mfaSectionRef}
              data-testid="server-settings-mfa-section"
              className="pt-2 border-t border-[var(--color-border)]/60"
            >
              <MfaChallengeForm
                mode={mfaMode}
                setupData={mfaSetupData}
                loading={mfaLoading}
                submitting={mfaSubmitting}
                error={mfaError}
                retryAfter={mfaRetryAfter}
                onCodeSubmit={handleMfaCodeSubmit}
                onCancel={handleMfaCancel}
              />
            </div>
          )}


          {canManageBrowserReset && (
            <div
              data-testid="browser-reset-section"
              className="pt-3 border-t border-[var(--color-border)] space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Shared Browser Data
                  </label>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    Clears shared server Browser cookies and active targets while keeping your login session.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="browser-reset-open-btn"
                  disabled={!effectiveBrowserToken && authType !== "none"}
                  onClick={() => void openBrowserResetConfirm()}
                >
                  {browserResetPendingOpId
                    ? "Resume cleanup…"
                    : "Reset Browser data now…"}
                </Button>
              </div>

              {(browserResetOutcome || browserResetPendingOpId) && (
                <div
                  data-testid="browser-reset-status-panel"
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--color-text)]">
                      {browserResetOutcome?.status === "completed"
                        ? `Shared Browser data cleared (profile epoch ${browserResetOutcome.profileEpoch})`
                        : `Shared Browser cleanup pending (${browserResetPendingOpId ?? browserResetOutcome?.operationId ?? "pending"}, epoch ${browserResetOutcome?.profileEpoch ?? "—"})`}
                    </span>
                    {(browserResetOutcome?.status === "cleanupPending" ||
                      browserResetPendingOpId) &&
                      effectiveBrowserToken && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={browserResetStatusChecking}
                          data-testid="browser-reset-status-btn"
                          onClick={() => void handleCheckBrowserResetStatus()}
                        >
                          Check status
                        </Button>
                      )}
                  </div>
                  {browserResetOutcome?.reason && (
                    <p className="text-[var(--color-text-muted)]">
                      {browserResetOutcome.reason}
                    </p>
                  )}
                </div>
              )}

              {browserResetError && (
                <p
                  data-testid="browser-reset-error"
                  className="text-xs text-red-400"
                >
                  {browserResetError}
                </p>
              )}
            </div>
          )}

          {profile && (
            <div className="pt-3 border-t border-[var(--color-border)]">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Server configuration
              </label>
              <ErrorBoundary fallback={null}>
                <WorkspaceSwitcher variant="compact" />
              </ErrorBoundary>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-4">
          <div className="flex gap-4 items-center">
            <button
              onClick={handleReset}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Reset to default
            </button>
            {hasToken && (
              <button
                onClick={handleLogout}
                className="text-xs font-semibold text-red-500 hover:text-red-400 transition-colors"
              >
                Logout
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {closable && (
              <button
                onClick={handleRequestClose}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={
                saved ||
                !urlSchemeValid ||
                testState !== "ok" ||
                (authType === "basic" && (!username || !token))
              }
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
              style={{
                background: saved
                  ? "var(--color-success)"
                  : "var(--color-primary)",
              }}
            >
              {saved
                ? "Saved!"
                : isEditMode
                  ? "Save profile"
                  : "Save & reconnect"}
            </button>
          </div>
        </div>
      </div>
      <Dialog
        open={dirtyConfirmOpen}
        onOpenChange={(next) => {
          if (!next) setDirtyConfirmOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription className="text-xs text-[var(--color-text-muted)]">
              You have unsaved changes to this server profile. What would you like to do?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              autoFocus
              onClick={() => setDirtyConfirmOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setDirtyConfirmOpen(false);
                onClose();
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={
                !urlSchemeValid ||
                testState !== "ok" ||
                (authType === "basic" && (!username || !token))
              }
              onClick={async () => {
                const ok = await handleSave();
                if (ok) {
                  setDirtyConfirmOpen(false);
                  onClose();
                }
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-50"
            >
              Save & Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={browserResetConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !browserResetSubmitting) {
            setBrowserResetConfirmOpen(false);
          }
        }}
      >
        <DialogContent
          data-testid="browser-reset-confirm-dialog"
          className="sm:max-w-lg"
          closeDisabled={browserResetSubmitting}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            browserResetCancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset shared Browser data?</DialogTitle>
            <DialogDescription className="text-xs text-[var(--color-text-muted)] space-y-2">
              <span className="block">
                This clears shared server Browser cookies and closes all active
                Browser targets across sibling login sessions on{" "}
                <span className="font-mono">{normalized}</span>, while keeping
                your current login active.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div
            data-testid="browser-reset-preflight-status"
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs space-y-1.5"
          >
            {browserResetPreflightLoading ? (
              <p className="text-[var(--color-text-muted)]">
                Checking server Browser profile status…
              </p>
            ) : browserResetPreflight?.kind === "admitted" ? (
              <>
                <div className="flex items-start gap-2 text-amber-300">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Confirmed reset bumps profile epoch from{" "}
                    {browserResetPreflight.profileEpoch} and fences all active
                    Browser viewers immediately.
                  </span>
                </div>
                <p className="text-[var(--color-text-muted)]">
                  {browserResetPreflight.managedProfilePresent
                    ? "Saved shared Browser profile detected on server."
                    : browserResetPreflight.unavailableReason
                      ? `Browser status: ${browserResetPreflight.unavailableReason}`
                      : "No saved shared Browser profile directory detected on server."}
                </p>
              </>
            ) : (
              <p className="text-[var(--color-text-muted)]">
                Shared Browser reset is unavailable (
                {browserResetPreflight?.reason ??
                  "requires live admitted Admin connection"}
                ).
              </p>
            )}
          </div>
          {browserResetError && (
            <p className="text-xs text-red-400">{browserResetError}</p>
          )}
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              ref={browserResetCancelRef}
              type="button"
              variant="ghost"
              size="sm"
              data-testid="browser-reset-cancel-btn"
              disabled={browserResetSubmitting}
              onClick={() => setBrowserResetConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-testid="browser-reset-confirm-btn"
              loading={browserResetSubmitting}
              disabled={!canConfirmBrowserReset}
              onClick={() => void handleConfirmBrowserReset()}
            >
              Reset Browser data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AccountLogoutDialog
        target={logoutTarget}
        onCancel={() => setLogoutTarget(null)}
        onCompleteLogout={(captured, outcome) => {
          const tokenMatches =
            !captured.token ||
            getAuthToken(captured.profileId) === captured.token;
          const currentGen = captured.profileId
            ? (getConnectionSnapshot(captured.profileId)?.owner.generation ?? 0)
            : undefined;
          const generationMatches =
            captured.generation === undefined ||
            currentGen === captured.generation;

          if (!tokenMatches || !generationMatches) {
            logoutWasStaleRef.current = true;
            return true;
          }

          if (captured.token) {
            if (!clearAuthToken(captured.profileId)) {
              setTestState("fail");
              setTestError("Unable to clear the login token in this browser");
              return false;
            }
          }
          if (captured.profileId) {
            fenceThenDisconnectProfile(captured.profileId, captured.generation, outcome);
          }
          if (
            latestUrlRef.current === normalizeServerUrl(captured.serverUrl) &&
            latestProfileIdRef.current === captured.profileId
          ) {
            clearAuthUsername();
            setToken("");
            setUsername("");
            setPassword("");
            setTestState("idle");
            setSaved(false);
          }
          return true;
        }}
        onDone={() => {
          setLogoutTarget(null);
          if (logoutWasStaleRef.current) {
            logoutWasStaleRef.current = false;
            return;
          }
          // Only the active profile needs a full app reload.
          if (profile === undefined || profile?.id === getActiveProfileId()) {
            window.location.reload();
          } else {
            onClose();
          }
        }}
        onReauthenticate={(captured, outcome) => {
          if (outcome.operationId || outcome.browserResetState === "cleanupPending") {
            setPendingBrowserResetContext(captured.profileId, {
              operationId: outcome.operationId,
              profileEpoch: outcome.profileEpoch,
              browserResetState: outcome.browserResetState,
              reason: outcome.reason,
            });
          }
          if (outcome.browserResetState === "cleanupPending") {
            setBrowserResetPendingOpId(outcome.operationId ?? null);
            setBrowserResetOutcome(
              outcome.profileEpoch === undefined
                ? null
                : {
                    status: "cleanupPending",
                    profileEpoch: outcome.profileEpoch,
                    operationId: outcome.operationId,
                    reason: outcome.reason,
                  },
            );
          }
          setLogoutTarget(null);
        }}
      />
    </div>
  );
}
