import type { TerminalAgentType } from "@/api/client.js";

export type TerminalAgentNotificationSource =
  | "bel"
  | "osc9"
  | "osc777"
  | "osc99"
  | "quiet"
  | "terminal-exit";

export type TerminalAgentNotificationStatus =
  | "needs-attention"
  | "finished"
  | "unknown";

export interface TerminalAgentNotification {
  source: TerminalAgentNotificationSource;
  sessionId: string;
  project?: string;
  agent: TerminalAgentType;
  title: string;
  body?: string;
  status: TerminalAgentNotificationStatus;
  receivedAt: number;
}

export interface TerminalNotificationParseContext {
  sessionId: string;
  project?: string;
  agent?: TerminalAgentType;
  now?: () => number;
}

const DEFAULT_TITLE = "Terminal needs attention";
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 180;

export function parseBelNotification(
  context: TerminalNotificationParseContext,
): TerminalAgentNotification {
  return createTerminalAgentNotification("bel", context, {
    title: DEFAULT_TITLE,
    status: "needs-attention",
  });
}

export function parseOsc9Notification(
  payload: string,
  context: TerminalNotificationParseContext,
): TerminalAgentNotification | null {
  const parts = splitPayload(stripOscPrefix(payload, "9"));
  if (parts.length === 0) return null;

  const offset = parts[0] === "notify" ? 1 : 0;
  return createFromParts("osc9", parts.slice(offset), context);
}

export function parseOsc777Notification(
  payload: string,
  context: TerminalNotificationParseContext,
): TerminalAgentNotification | null {
  const parts = splitPayload(stripOscPrefix(payload, "777"));
  if (parts[0] !== "notify") return null;

  return createFromParts("osc777", parts.slice(1), context);
}

export function parseOsc99Notification(
  payload: string,
  context: TerminalNotificationParseContext,
): TerminalAgentNotification | null {
  const strippedPayload = stripOscPrefix(payload, "99");
  const parts = splitPayload(strippedPayload);
  if (parts.length === 0 && strippedPayload.length === 0) return null;

  const offset = parts[0] === "notify" ? 1 : 0;
  return createFromParts("osc99", parts.slice(offset), context);
}

export function sanitizeTerminalNotificationText(
  text: string | undefined | null,
  maxLength: number,
): string {
  if (!text) return "";

  const sanitized = text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, " ")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(sanitized).slice(0, maxLength).join("");
}

export function createTerminalAgentNotification(
  source: TerminalAgentNotificationSource,
  context: TerminalNotificationParseContext,
  fields: {
    title: string;
    body?: string;
    status?: TerminalAgentNotificationStatus;
  },
): TerminalAgentNotification {
  const body = sanitizeTerminalNotificationText(fields.body, MAX_BODY_LENGTH);

  return {
    source,
    sessionId: context.sessionId,
    project: context.project,
    agent: context.agent ?? "unknown",
    title:
      sanitizeTerminalNotificationText(fields.title, MAX_TITLE_LENGTH) ||
      DEFAULT_TITLE,
    body: body || undefined,
    status: fields.status ?? "unknown",
    receivedAt: context.now?.() ?? Date.now(),
  };
}

function createFromParts(
  source: Extract<TerminalAgentNotificationSource, "osc9" | "osc777" | "osc99">,
  parts: string[],
  context: TerminalNotificationParseContext,
): TerminalAgentNotification {
  const title = parts[0] || DEFAULT_TITLE;
  const body = parts.slice(1).join(";") || undefined;

  return createTerminalAgentNotification(source, context, {
    title,
    body,
    status: "needs-attention",
  });
}

function stripOscPrefix(payload: string, prefix: string): string {
  return payload.startsWith(`${prefix};`)
    ? payload.slice(prefix.length + 1)
    : payload;
}

function splitPayload(payload: string): string[] {
  return payload
    .split(";")
    .map((part) => sanitizeTerminalNotificationText(part, MAX_BODY_LENGTH))
    .filter((part) => part.length > 0);
}
