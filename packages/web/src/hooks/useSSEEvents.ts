import { useEffect, useRef } from "react";
import { subscribeIpc, type IpcEvent } from "./useSSE.js";

export function useIpcEvent(type: string, handler: (event: IpcEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribeIpc(type, (e) => handlerRef.current(e));
  }, [type]);
}
