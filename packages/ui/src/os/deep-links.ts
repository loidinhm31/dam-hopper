import type { ServerProfile } from "@/api/server-config.js";
import type { ConnectionRef, FsTargetRef } from "@/api/ownership.js";
import { isAppId, getAppManifest } from "./app-registry.js";
import type { OsAppId, WindowContext } from "./types.js";
import type { OsIntent } from "./intents.js";
import { createIntent } from "./intents.js";

export interface ParsedOsDeepLink {
  status: "valid" | "empty" | "invalid";
  appId?: OsAppId;
  intent?: OsIntent;
  ctx?: WindowContext;
  action?: string;
  reason?: string;
  searchParams?: URLSearchParams;
}
export interface LegacyRouteTranslation {
  status: "redirect" | "unqualified" | "removed" | "none";
  targetUrl?: string;
  guidance?: string;
}

/**
 * Translates legacy workbench paths (/workspace, /terminals, /ide, /git, /settings,
 * /devices, /agent-store) into qualified OS deep links.
 *
 * Preserves profile, project, worktree, file, line, hash, and terminal session parameters.
 * If profileId is missing, returns "unqualified" with upgrade guidance instead of ambient fallback.
 * For removed routes (/usage, /ssh-forwarding), returns "removed".
 */
export function translateLegacyRoute(
  pathname: string,
  search: string,
): LegacyRouteTranslation {
  const normPath = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);

  if (normPath === "/usage" || normPath === "/ssh-forwarding") {
    return { status: "removed" };
  }

  const legacyAppMap: Record<string, string> = {
    "/workspace": "terminals",
    "/terminals": "terminals",
    "/ide": "terminals",
    "/git": "git",
    "/settings": "settings",
    "/devices": "devices",
    "/agent-store": "agent-store",
  };

  const mappedApp = legacyAppMap[normPath];
  if (!mappedApp) {
    return { status: "none" };
  }

  const profileId = params.get("profileId") || params.get("profile");
  if (!profileId) {
    return {
      status: "unqualified",
      guidance:
        "Legacy unqualified link detected without profileId. Please use the unified workbench navigation to select your project or terminal session.",
    };
  }

  const newParams = new URLSearchParams();
  newParams.set("profile", profileId);

  if (mappedApp === "devices") {
    newParams.set("open", "settings");
    newParams.set("tab", "devices");
  } else if (mappedApp === "terminals" && params.has("file")) {
    newParams.set("open", "editor");
  } else {
    newParams.set("open", mappedApp);
  }

  for (const [key, val] of params.entries()) {
    if (key === "profile" || key === "profileId" || (mappedApp === "devices" && key === "open")) {
      continue;
    }
    if (key === "session") {
      newParams.set("terminal", val);
    } else {
      newParams.set(key, val);
    }
  }

  return {
    status: "redirect",
    targetUrl: `/?${newParams.toString()}`,
  };
}

/**
 * Parses and validates an OS deep link URL query.
 *
 * Supported parameters:
 * - open: OsAppId (e.g. "git", "terminals", "editor", "browser", etc.)
 * - profile / profileId: Server profile identifier (required; verified against known profiles)
 * - project: Project name (required for project-scoped apps)
 * - worktree: Worktree identifier or path
 * - file: File path
 * - line: Line number
 * - hash / commit: Git commit OID / hash
 * - root: Git root ID
 * - operation: Merge/rebase conflict operation
 * - terminal: Terminal session ID
 * - incarnation: Terminal session incarnation
 * - ompSession: OMP session ID
 * - url: Browser preview URL
 * - action: Explicit action trigger (e.g. "new-terminal")
 */
export function parseOsDeepLink(
  search: string | URLSearchParams,
  knownProfiles: ServerProfile[],
): ParsedOsDeepLink {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;

  const openParam = params.get("open");
  const actionParam = params.get("action");

  if (!openParam && !actionParam) {
    return { status: "empty" };
  }

  // 1. Validate profile ownership
  const profileId = params.get("profile") || params.get("profileId");
  if (!profileId) {
    return {
      status: "invalid",
      reason: "Missing required profile parameter in deep link URL",
    };
  }

  const profileExists = knownProfiles.some((p) => p.id === profileId);
  if (!profileExists) {
    return {
      status: "invalid",
      reason: `Unknown server profile "${profileId}"`,
    };
  }

  // 2. Action without app open (e.g. action=new-terminal)
  if (!openParam && actionParam) {
    const project = params.get("project") ?? undefined;
    const worktree = params.get("worktree") ?? undefined;
    return {
      status: "valid",
      appId: "terminals",
      action: actionParam,
      ctx: {
        profileId,
        projectId: project,
        worktreeId: worktree,
      },
    };
  }

  // 3. Validate appId (support "devices" alias as settings with tab=devices)
  const rawOpen = openParam;
  const isDevices = rawOpen === "devices";
  const effectiveAppId = isDevices ? "settings" : rawOpen;

  if (!effectiveAppId || !isAppId(effectiveAppId)) {
    return {
      status: "invalid",
      reason: `Unknown or unsupported application "${rawOpen}"`,
    };
  }

  const manifest = getAppManifest(effectiveAppId);
  if (!manifest) {
    return {
      status: "invalid",
      reason: `Missing manifest for application "${effectiveAppId}"`,
    };
  }

  const project = params.get("project") ?? undefined;
  const worktree = params.get("worktree") ?? undefined;
  const file = params.get("file") ?? undefined;
  const lineRaw = params.get("line");
  let line: number | undefined;
  if (lineRaw !== null) {
    const parsed = Number.parseInt(lineRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== lineRaw.trim()) {
      return {
        status: "invalid",
        reason: `Malformed line parameter "${lineRaw}"`,
      };
    }
    line = parsed;
  }
  const hash = params.get("hash") || params.get("commit") || undefined;
  const root = params.get("root") ?? undefined;
  const operation = params.get("operation") ?? undefined;
  const terminal = params.get("terminal") || params.get("session") || undefined;
  const incarnation = params.get("incarnation") ?? undefined;
  const ompSession = params.get("ompSession") ?? undefined;
  const url = params.get("url") ?? undefined;

  // 4. Validate minimum context requirements
  if (manifest.minimumCtx === "project" && !project) {
    return {
      status: "invalid",
      reason: `Application "${openParam}" requires a project parameter`,
    };
  }

  // 5. App-specific validations and typed intent generation
  const ctx: WindowContext = {
    profileId,
    projectId: project,
    worktreeId: worktree,
    gitRootId: root,
    operation,
  };

  let intent: OsIntent | undefined;

  switch (effectiveAppId) {
    case "terminals":
      if (terminal) {
        intent = createIntent("terminal:focus", {
          profileId,
          terminalId: terminal,
        });
      } else {
        intent = createIntent("terminal:open", {
          profileId,
          projectId: project,
          worktreeId: worktree,
        });
      }
      break;

    case "editor":
      if (file) {
        intent = createIntent("file:open", {
          profileId,
          projectId: project ?? "default",
          worktreeId: worktree,
          filePath: file,
          line,
        });
      }
      break;

    case "browser":
      if (url) {
        intent = createIntent("browser:open", {
          profileId,
          url,
        });
      }
      break;

    case "files":
      if (file) {
        intent = createIntent("file:reveal", {
          profileId,
          generation: 1,
          target: project
            ? { kind: "project", profileId, project, worktreePath: worktree }
            : { kind: "workspace", profileId },
          projectId: project ?? "",
          worktreeId: worktree,
          filePath: file,
        });
      }
      break;

    case "search":
      // In C11: parseOsDeepLink parses URL syntax, qualification builds required intent
      break;

    case "changes":
      if (file) {
        intent = createIntent("changes:diff", {
          profileId,
          projectId: project ?? "",
          worktreeId: worktree,
          filePath: file,
        });
      }
      break;

    case "git":
      if (hash) {
        intent = createIntent("git:reveal-commit", {
          profileId,
          projectId: project ?? "",
          worktreeId: worktree,
          commitHash: hash,
          rootId: root,
        });
      } else {
        intent = createIntent("git:status", {
          profileId,
          projectId: project ?? "",
          worktreeId: worktree,
        });
      }
      break;

    case "conflict-resolver":
      intent = createIntent("conflict:resolve", {
        profileId,
        projectId: project ?? "",
        worktreeId: worktree,
        root,
        filePath: file,
        operation,
      });
      break;

    case "session-changes": {
      const serverEpoch = params.get("serverEpoch") || params.get("epoch");
      const baseline = params.get("baselineId") || params.get("baseline");
      const genRaw = params.get("generation");

      if (!terminal || !incarnation || !ompSession || !serverEpoch || !root || !baseline || genRaw === null) {
        return {
          status: "invalid",
          reason:
            "Session Changes deep link requires full ReviewTarget tuple: profileId, generation, terminal, incarnation, ompSession, serverEpoch, root, and baselineId. Incomplete links are not supported; please open from Agent Hub.",
        };
      }

      const parsedGen = Number.parseInt(genRaw, 10);
      if (!Number.isInteger(parsedGen) || parsedGen < 0 || String(parsedGen) !== genRaw.trim()) {
        return {
          status: "invalid",
          reason: `Malformed generation parameter "${genRaw}"`,
        };
      }

      intent = createIntent("session-changes:open", {
        profileId,
        generation: parsedGen,
        terminalId: terminal,
        terminalIncarnation: incarnation,
        ompSessionId: ompSession,
        serverEpoch,
        rootId: root,
        baselineId: baseline,
      });
      break;
    }

    case "workflow-plans":
      if (params.get("itemId")) {
        intent = createIntent("workflow:open-item", {
          profileId,
          projectId: project,
          itemId: params.get("itemId")!,
        });
      } else if (params.get("planId")) {
        intent = createIntent("workflow:open-plan", {
          profileId,
          projectId: project,
          planId: params.get("planId")!,
        });
      }
      break;

    case "ports-tunnels":
      intent = createIntent("ports:open", { profileId });
      break;

    case "project-info":
      intent = createIntent("project:info", {
        profileId,
        projectId: project ?? "",
      });
      break;

    case "agent-store":
      intent = createIntent("agent-store:open", {
        profileId,
        tab: params.get("tab") ?? undefined,
      });
      break;

    case "settings": {
      const tab = isDevices ? "devices" : (params.get("tab") ?? undefined);
      if (tab === "devices") {
        intent = createIntent("settings:devices", {
          profileId,
        });
      } else {
        intent = createIntent("settings:open", {
          profileId,
          tab,
        });
      }
      break;
    }
  }

  return {
    status: "valid",
    appId: effectiveAppId,
    intent,
    ctx,
    action: actionParam ?? undefined,
    searchParams: params,
  };
}

// ============================================================================
// Deep-Link Source Qualification (Architecture Contract C11)
// ============================================================================

export interface DeepLinkCaptureContext {
  owner: ConnectionRef;
  target?: FsTargetRef;
  projectId?: string;
  worktreeId?: string;
  destinationDesktopId: string;
}

export type QualifiedDeepLinkResult =
  | {
      readonly status: "qualified";
      readonly appId: OsAppId;
      readonly intent?: OsIntent;
      readonly ctx: WindowContext;
      readonly appState?: Record<string, unknown>;
    }
  | {
      readonly status: "unqualified";
      readonly reason: string;
    };

export function qualifyOsDeepLink(
  parsed: ParsedOsDeepLink,
  capture: DeepLinkCaptureContext,
): QualifiedDeepLinkResult {
  if (parsed.status !== "valid" || !parsed.appId) {
    return {
      status: "unqualified",
      reason: parsed.reason ?? "Deep link is invalid or empty",
    };
  }

  if (capture.owner.profileId !== parsed.ctx?.profileId) {
    return {
      status: "unqualified",
      reason: `Profile mismatch: link requested '${parsed.ctx?.profileId}', captured connection is '${capture.owner.profileId}'`,
    };
  }

  // Generation authority verification (C11): URL generation never authority
  if (
    parsed.ctx?.generation !== undefined &&
    parsed.ctx.generation !== capture.owner.generation
  ) {
    return {
      status: "unqualified",
      reason: `Stale generation: link requested generation ${parsed.ctx.generation}, current connection generation is ${capture.owner.generation}`,
    };
  }

  const generation = capture.owner.generation;
  const target = capture.target ?? {
    kind: "workspace",
    profileId: capture.owner.profileId,
  };

  const qualifiedCtx: WindowContext = {
    ...parsed.ctx,
    profileId: capture.owner.profileId,
    generation,
    target,
    projectId: capture.projectId ?? parsed.ctx?.projectId,
    worktreeId: capture.worktreeId ?? parsed.ctx?.worktreeId,
  };

  const params = parsed.searchParams;

  if (parsed.appId === "search") {
    const query = params?.get("query") ?? "";
    const mode = params?.get("mode") === "filename" ? "filename" : "text";
    const intent = createIntent("search:query", {
      profileId: capture.owner.profileId,
      generation,
      target,
      projectId: qualifiedCtx.projectId,
      worktreeId: qualifiedCtx.worktreeId,
      mode,
      query,
    });
    return {
      status: "qualified",
      appId: "search",
      intent,
      ctx: qualifiedCtx,
    };
  }

  if (parsed.appId === "files" && params?.get("file")) {
    const filePath = params.get("file")!;
    const intent = createIntent("file:reveal", {
      profileId: capture.owner.profileId,
      generation,
      target,
      projectId: qualifiedCtx.projectId,
      worktreeId: qualifiedCtx.worktreeId,
      filePath,
    });
    return {
      status: "qualified",
      appId: "files",
      intent,
      ctx: qualifiedCtx,
    };
  }

  if (parsed.appId === "editor") {
    const file = params?.get("file");
    if (file) {
      const intent = createIntent("file:open", {
        profileId: capture.owner.profileId,
        projectId: qualifiedCtx.projectId,
        worktreeId: qualifiedCtx.worktreeId,
        target,
        filePath: file,
        generation,
      });
      return {
        status: "qualified",
        appId: "editor",
        intent,
        ctx: qualifiedCtx,
      };
    }
    // Omitted file: open real chooser, never fabricates defaults
    return {
      status: "qualified",
      appId: "editor",
      ctx: qualifiedCtx,
      appState: {
        presentation: {
          kind: "choose-target",
          capturedContext: {
            kind: "desktop",
            desktopId: capture.destinationDesktopId,
            owner: capture.owner,
          },
          ownerGeneration: generation,
          destinationDesktopId: capture.destinationDesktopId,
          deliveryToken:
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `tok-${Date.now()}`,
        },
      },
    };
  }

  if (parsed.appId === "browser") {
    const url = params?.get("url");
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      const intent = createIntent("browser:open", {
        profileId: capture.owner.profileId,
        url,
      });
      return {
        status: "qualified",
        appId: "browser",
        intent,
        ctx: qualifiedCtx,
      };
    }
    // Omitted valid URL: open real chooser
    return {
      status: "qualified",
      appId: "browser",
      ctx: qualifiedCtx,
      appState: {
        presentation: {
          kind: "choose-target",
          capturedContext: {
            kind: "desktop",
            desktopId: capture.destinationDesktopId,
            owner: capture.owner,
          },
          ownerGeneration: generation,
          destinationDesktopId: capture.destinationDesktopId,
          deliveryToken:
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `tok-${Date.now()}`,
        },
      },
    };
  }

  return {
    status: "qualified",
    appId: parsed.appId,
    intent: parsed.intent,
    ctx: qualifiedCtx,
  };
}
