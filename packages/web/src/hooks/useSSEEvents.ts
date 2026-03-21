import { useEffect, useRef } from "react";
import { subscribeSSE, type SSEEvent } from "./useSSE.js";

export function useSSEEvent(type: string, handler: (event: SSEEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribeSSE(type, (e) => handlerRef.current(e));
  }, [type]);
}
