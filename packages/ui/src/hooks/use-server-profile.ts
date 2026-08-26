import { useSyncExternalStore } from "react";
import {
  getActiveProfile,
  getProfileChangeVersion,
  subscribeToProfileChanges,
  type ServerProfile,
} from "@/api/server-config.js";

/** Reactive active profile snapshot for guards and navigation chrome. */
export function useServerProfile(): ServerProfile | null {
  useSyncExternalStore(
    (notify) => subscribeToProfileChanges(() => notify()),
    getProfileChangeVersion,
    getProfileChangeVersion,
  );
  return getActiveProfile();
}
