import type { QualityPreference, StreamQualityEvent } from "@/api/browser-host-types.js";

export interface StreamQualityTuple {
  profileId: string;
  generation: number;
  windowId: string;
  tabId: string;
}

export interface StreamQualityState {
  readonly preference: QualityPreference;
  readonly ackedPreference: QualityPreference | null;
  readonly status: StreamQualityEvent | null;
  readonly pending: boolean;
}

export const DEFAULT_STREAM_QUALITY_STATE: StreamQualityState = Object.freeze({
  preference: "auto",
  ackedPreference: null,
  status: null,
  pending: false,
});

export type StreamQualityKeyInput =
  | StreamQualityTuple
  | { profileId?: string | null; generation?: number | null; windowId?: string | null; tabId?: string | null };

function toTupleKey(input: StreamQualityKeyInput | null | undefined): string | null {
  if (!input) return null;
  const { profileId, generation, windowId, tabId } = input;
  if (!profileId || typeof generation !== "number" || !Number.isInteger(generation) || !windowId || !tabId) {
    return null;
  }
  return `${profileId}\0${generation}\0${windowId}\0${tabId}`;
}

const records = new Map<string, StreamQualityState>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (set) {
    for (const listener of Array.from(set)) listener();
  }
}

function isEventIdentical(a: StreamQualityEvent | null, b: StreamQualityEvent): boolean {
  if (!a) return false;
  return (
    a.subscriptionEpoch === b.subscriptionEpoch &&
    a.preference === b.preference &&
    a.producerRun === b.producerRun &&
    a.captureVersion === b.captureVersion &&
    a.sharedTier === b.sharedTier &&
    a.viewerTier === b.viewerTier &&
    a.fps === b.fps &&
    a.jpegQuality === b.jpegQuality &&
    a.scale === b.scale &&
    a.imageWidth === b.imageWidth &&
    a.imageHeight === b.imageHeight &&
    a.audioSuppressed === b.audioSuppressed &&
    a.audioReason === b.audioReason &&
    a.status === b.status
  );
}

function deleteKey(key: string): void {
  if (records.delete(key)) notify(key);
}

export function subscribeStreamQuality(
  tuple: StreamQualityKeyInput | null | undefined,
  listener: () => void,
): () => void {
  const key = toTupleKey(tuple);
  if (!key) return () => {};
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(key);
    if (s) {
      s.delete(listener);
      if (s.size === 0) listeners.delete(key);
    }
  };
}

export function getStreamQuality(tuple: StreamQualityKeyInput | null | undefined): StreamQualityState {
  const key = toTupleKey(tuple);
  if (!key) return DEFAULT_STREAM_QUALITY_STATE;
  return records.get(key) ?? DEFAULT_STREAM_QUALITY_STATE;
}

export function getQualityPreference(tuple: StreamQualityKeyInput | null | undefined): QualityPreference {
  return getStreamQuality(tuple).preference;
}

export function setQualityPreference(tuple: StreamQualityKeyInput, preference: QualityPreference): void {
  const key = toTupleKey(tuple);
  if (!key) return;
  const current = records.get(key) ?? DEFAULT_STREAM_QUALITY_STATE;
  if (current.preference === preference) return;
  const pending = current.ackedPreference !== preference;
  const next: StreamQualityState = {
    preference,
    ackedPreference: current.ackedPreference,
    status: current.status,
    pending,
  };
  records.set(key, next);
  notify(key);
}

export function publishStreamQuality(tuple: StreamQualityKeyInput, event: StreamQualityEvent): void {
  const key = toTupleKey(tuple);
  if (!key) return;
  const current = records.get(key) ?? DEFAULT_STREAM_QUALITY_STATE;
  const ackedPreference = event.preference ?? current.ackedPreference;
  const pending =
    event.status === "unavailable"
      ? false
      : current.preference !== ackedPreference;

  if (
    current.pending === pending &&
    current.ackedPreference === ackedPreference &&
    isEventIdentical(current.status, event)
  ) {
    return;
  }

  const next: StreamQualityState = {
    preference: current.preference,
    ackedPreference,
    status: event,
    pending,
  };
  records.set(key, next);
  notify(key);
}

export function clearStreamQuality(tuple: StreamQualityKeyInput | null | undefined): void {
  const key = toTupleKey(tuple);
  if (!key) return;
  const current = records.get(key);
  if (!current || (current.status === null && !current.pending && current.ackedPreference === null)) return;
  const next: StreamQualityState = {
    preference: current.preference,
    ackedPreference: null,
    status: null,
    pending: false,
  };
  records.set(key, next);
  notify(key);
}

export function releaseTab(tuple: StreamQualityTuple): void {
  const key = toTupleKey(tuple);
  if (key) deleteKey(key);
}

export function releaseWindow(windowId: string): void {
  for (const key of Array.from(records.keys())) {
    const parts = key.split("\0");
    if (parts[2] === windowId) deleteKey(key);
  }
}

export function releaseGeneration(profileId: string, generation: number): void {
  const prefix = `${profileId}\0${generation}\0`;
  for (const key of Array.from(records.keys())) {
    if (key.startsWith(prefix)) deleteKey(key);
  }
}

export function clearAllStreamQualityForTesting(): void {
  records.clear();
  listeners.clear();
}
