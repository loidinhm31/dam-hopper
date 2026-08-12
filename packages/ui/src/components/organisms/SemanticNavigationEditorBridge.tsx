import { useEffect, useRef } from "react";
import type * as monacoNs from "monaco-editor";
import { useEditorStore } from "@/stores/editor.js";
import { useSemanticNavigation } from "@/contexts/SemanticNavigationContext.js";
import { createSemanticProviders } from "@/lib/semantic-navigation.js";
import { semanticLanguageForFile } from "@/lib/semantic-language.js";
import { getActiveProfileId } from "@/api/server-config.js";

interface Props {
  editor: monacoNs.editor.IStandaloneCodeEditor | null;
  monaco: typeof monacoNs | null;
  project: string | null;
}

/** Installs one disposable public-provider registry for the active Monaco model. */
export function SemanticNavigationEditorBridge({
  editor,
  monaco,
  project,
}: Props) {
  const semantic = useSemanticNavigation();
  const semanticRef = useRef(semantic);
  useEffect(() => {
    semanticRef.current = semantic;
  }, [semantic]);
  const getActiveTab = useEditorStore((state) => state.getActiveTab);
  const tabs = useEditorStore((state) => state.tabs ?? []);
  const activeKeys = useEditorStore((state) => state.activeKeys ?? {});
  const activeKey = project ? activeKeys[project] : null;
  const activeTab = tabs.find((tab) => tab.key === activeKey) ?? null;
  const semanticAvailability = semantic.availability;
  const semanticTrust = semantic.trust;
  const semanticTrustAllowsNavigation =
    semanticTrust !== null && semanticTrust.trust !== "revoked";
  const activeLanguage = activeTab
    ? semanticLanguageForFile(activeTab.mime, activeTab.path)
    : null;
  const capabilityState = semanticAvailability.find(
    (item) => item.language === activeLanguage,
  )?.state;

  useEffect(() => {
    if (!editor || !monaco || !project) return;
    const model = editor.getModel();
    const tab = getActiveTab(project);
    if (!model || !tab || tab.tier === "diff") return;
    const language = semanticLanguageForFile(tab.mime, tab.path);
    const profileId = getActiveProfileId();
    if (!language) return;
    const capability = semanticAvailability.find(
      (item) => item.language === language,
    );
    if (
      !language ||
      !profileId ||
      !tab.path ||
      !capability ||
      (capability.state !== "ready" && capability.state !== "restricted") ||
      !semanticTrustAllowsNavigation
    )
      return;
    const disposable = createSemanticProviders(
      monaco,
      model.getLanguageId(),
      {
        isAvailable: (candidateLanguage) => {
          const current = semanticRef.current;
          return (
            current.availability.some(
              (item) =>
                item.language === candidateLanguage &&
                (item.state === "ready" || item.state === "restricted"),
            ) &&
            current.status !== "unavailable" &&
            current.status !== "crashed" &&
            current.trust?.trust !== "revoked"
          );
        },
        navigate: ({
          requestId,
          operation,
          line,
          character,
          documentVersion,
          signal,
        }) => {
          const currentProfileId = getActiveProfileId();
          const currentTab = useEditorStore.getState().getActiveTab(project);
          if (!currentProfileId || !currentTab) return Promise.resolve(null);
          return semanticRef.current.requestNavigation(
            {
              requestId,
              documentVersion,
              operation,
              uri: {
                profileId: currentProfileId,
                projectId: currentTab.project,
                path: currentTab.path,
                language,
              },
              position: { line, character },
            },
            signal,
          );
        },
      },
      () => {
        const currentTab = useEditorStore.getState().getActiveTab(project);
        const currentLanguage = currentTab
          ? semanticLanguageForFile(currentTab.mime, currentTab.path)
          : null;
        if (!currentTab || currentLanguage !== language) return null;
        return {
          language,
          path: currentTab.path,
          version: currentTab.semanticVersion ?? 0,
        };
      },
      editor,
    );
    return () => disposable.dispose();
  }, [
    activeKey,
    activeTab?.path,
    activeTab?.semanticVersion,
    activeTab?.tabGeneration,
    editor,
    getActiveTab,
    monaco,
    project,
    capabilityState,
    activeLanguage,
    semanticAvailability,
    semanticTrustAllowsNavigation,
  ]);

  return null;
}
