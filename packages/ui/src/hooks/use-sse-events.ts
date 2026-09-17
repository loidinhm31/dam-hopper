import { useEffect, useRef } from "react";
import { subscribeIpc, type IpcEvent } from "./use-sse.js";
import type { ProfileId } from "@/api/ownership.js";

export function useIpcEvent(
  type: string,
  handler: (event: IpcEvent) => void,
): void;
export function useIpcEvent(
  profileId: ProfileId,
  type: string,
  handler: (event: IpcEvent) => void,
): void;
export function useIpcEvent(
  profileIdOrType: ProfileId | string,
  typeOrHandler: string | ((event: IpcEvent) => void),
  maybeHandler?: (event: IpcEvent) => void,
): void {
  const handler =
    typeof typeOrHandler === "function" ? typeOrHandler : maybeHandler!;
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (typeof typeOrHandler === "function") {
      const type = profileIdOrType;
      return subscribeIpc(type, (e) => handlerRef.current(e));
    } else {
      const profileId = profileIdOrType;
      const type = typeOrHandler;
      return subscribeIpc(profileId, type, (e) => handlerRef.current(e));
    }
  }, [profileIdOrType, typeOrHandler]);
}
