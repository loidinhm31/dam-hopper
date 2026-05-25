import { useEffect, useState } from "react";
import {
  readCompactWorkspaceMatch,
  subscribeToCompactWorkspace,
} from "./compact-workspace-media-query.js";

export function useCompactWorkspace() {
  const [isCompactWorkspace, setIsCompactWorkspace] = useState(
    readCompactWorkspaceMatch,
  );

  useEffect(() => {
    return subscribeToCompactWorkspace(setIsCompactWorkspace);
  }, []);

  return isCompactWorkspace;
}
