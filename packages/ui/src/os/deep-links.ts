import type { ServerProfile } from "@/api/server-config.js";
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
      intent = createIntent("file:open", {
        profileId,
        projectId: project ?? "default",
        worktreeId: worktree,
        filePath: file ?? "untitled.ts",
        line,
      });
      break;

    case "browser":
      intent = createIntent("browser:open", {
        profileId,
        url: url ?? "http://localhost:5173",
      });
      break;

    case "files":
      if (file) {
        intent = createIntent("file:reveal", {
          profileId,
          projectId: project ?? "",
          worktreeId: worktree,
          filePath: file,
        });
      }
      break;

    case "search":
      intent = createIntent("search:query", {
        profileId,
        projectId: project ?? "",
        worktreeId: worktree,
        query: params.get("query") ?? "",
      });
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

    case "session-changes":
      if (!terminal || !incarnation || !ompSession) {
        return {
          status: "invalid",
          reason:
            "Session Changes deep link requires terminal, incarnation, and ompSession parameters",
        };
      }
      const genRaw = params.get("generation");
      let generation: number | undefined;
      if (genRaw !== null) {
        const parsed = Number.parseInt(genRaw, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== genRaw.trim()) {
          return {
            status: "invalid",
            reason: `Malformed generation parameter "${genRaw}"`,
          };
        }
        generation = parsed;
      }
      intent = createIntent("session-changes:open", {
        profileId,
        generation,
        terminalId: terminal,
        terminalIncarnation: incarnation,
        ompSessionId: ompSession,
        rootId: root ?? ".",
      });
      break;

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
  };
}
