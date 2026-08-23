import { useEffect, useState } from "react";
import { useAppZoom } from "@/contexts/AppZoomContext.js";
import {
  readCompactWorkspaceMatch,
  subscribeToCompactWorkspace,
} from "./compact-workspace-media-query.js";

export function useCompactWorkspace() {
  const { level: appZoomLevel } = useAppZoom();
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    return subscribeToCompactWorkspace(
      () => forceRefresh((revision) => revision + 1),
      undefined,
      appZoomLevel,
    );
  }, [appZoomLevel]);

  const currentCompactWorkspace = readCompactWorkspaceMatch(
    undefined,
    appZoomLevel,
  );
  return currentCompactWorkspace;
}
