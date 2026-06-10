import { useCallback, useEffect, useMemo, useState } from "react";
import { getTransport } from "@/api/transport.js";
import type { SearchMatch } from "@/api/fs-types.js";
import type { WsTransport } from "@/api/ws-transport.js";
import { useEditorStore } from "@/stores/editor.js";
import {
  buildContentSearchMatchKey,
  findNextContentSearchMatch,
} from "@/lib/search-matches.js";
import { runReplaceNext } from "@/lib/search-replace-next.js";

interface UseSearchPanelReplaceOptions {
  project: string;
  matches: SearchMatch[];
  searchQuery: string;
  replaceQuery: string;
  caseSensitive: boolean;
  refreshMatches: () => Promise<SearchMatch[]>;
  openMatch: (match: SearchMatch, options?: { closeSearch?: boolean }) => void;
}

export function useSearchPanelReplace({
  project,
  matches,
  searchQuery,
  replaceQuery,
  caseSensitive,
  refreshMatches,
  openMatch,
}: UseSearchPanelReplaceOptions) {
  const tabs = useEditorStore((state) => state.tabs);
  const [selectedMatchKey, setSelectedMatchKey] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMatch = useMemo(
    () =>
      matches.find((match) => buildContentSearchMatchKey(match) === selectedMatchKey) ??
      null,
    [matches, selectedMatchKey],
  );

  useEffect(() => {
    if (selectedMatchKey && !selectedMatch) {
      setSelectedMatchKey(null);
    }
  }, [selectedMatch, selectedMatchKey]);

  useEffect(() => {
    setWarning(null);
    setError(null);
  }, [searchQuery, replaceQuery, caseSensitive]);

  useEffect(() => {
    if (matches.length === 0) {
      setSelectedMatchKey(null);
    }
  }, [matches.length]);

  const selectMatch = useCallback((match: SearchMatch) => {
    setSelectedMatchKey(buildContentSearchMatchKey(match));
    setWarning(null);
    setError(null);
  }, []);

  const replaceDisabled =
    searchQuery.length < 2 || matches.length === 0 || isReplacing;

  const replaceNext = useCallback(async () => {
    if (replaceDisabled) return;

    setIsReplacing(true);
    setWarning(null);
    setError(null);

    try {
      const result = await runReplaceNext({
        currentProject: project,
        matches,
        selectedMatch: selectedMatch ?? findNextContentSearchMatch(matches),
        searchQuery,
        replaceQuery,
        caseSensitive,
        hasDirtyOpenTab: (targetProject, path) =>
          tabs.some(
            (tab) =>
              tab.project === targetProject && tab.path === path && tab.dirty,
          ),
        openMatch: (match) => openMatch(match, { closeSearch: false }),
        readFile: (targetProject, path) =>
          (getTransport() as WsTransport).fsRead(targetProject, path),
        writeFile: (targetProject, path, content, expectedMtime) =>
          (getTransport() as WsTransport).fsWriteFile(
            targetProject,
            path,
            content,
            expectedMtime,
          ),
        refreshMatches,
        reloadOpenTab: async (targetProject, path) => {
          const tab = useEditorStore
            .getState()
            .tabs.find(
              (candidate) =>
                candidate.project === targetProject &&
                candidate.path === path &&
                !candidate.dirty,
            );
          if (tab) {
            await useEditorStore.getState().reloadTab(tab.key);
          }
        },
      });

      if (result.kind === "blocked-dirty") {
        setSelectedMatchKey(buildContentSearchMatchKey(result.match));
        setWarning(result.message);
        return;
      }

      if (result.kind === "stale") {
        setSelectedMatchKey(
          result.nextMatch ? buildContentSearchMatchKey(result.nextMatch) : null,
        );
        setWarning(result.message);
        return;
      }

      if (result.kind === "error") {
        setError(result.message);
        return;
      }

      setSelectedMatchKey(
        result.nextMatch ? buildContentSearchMatchKey(result.nextMatch) : null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replace Next failed.");
    } finally {
      setIsReplacing(false);
    }
  }, [
    caseSensitive,
    matches,
    openMatch,
    project,
    refreshMatches,
    replaceDisabled,
    replaceQuery,
    searchQuery,
    selectedMatch,
    tabs,
  ]);

  return {
    selectedMatchKey,
    isReplacing,
    warning,
    error,
    replaceDisabled,
    selectMatch,
    replaceNext,
  };
}
