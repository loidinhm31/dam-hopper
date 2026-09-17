import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProjectRef } from "@/api/ownership.js";
import { getActiveProfileId, setActiveProfile } from "@/api/server-config.js";

export interface WorkspaceStore {
  selectedProject: ProjectRef | null;
  navigationRevision: number;
  setSelectedProject: (project: ProjectRef | null) => void;
  // Compatibility fields for existing callers
  activeProject: string | null;
  activeProjectRevision: number;
  setActiveProject: (project: string | null, profileId?: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      selectedProject: null,
      navigationRevision: 0,
      setSelectedProject: (project) => {
        set((state) => {
          const isSame =
            (state.selectedProject === null && project === null) ||
            (state.selectedProject !== null &&
              project !== null &&
              state.selectedProject.profileId === project.profileId &&
              state.selectedProject.project === project.project);
          if (isSame) return state;
          if (project?.profileId && project.profileId !== getActiveProfileId()) {
            setActiveProfile(project.profileId);
          }
          return {
            selectedProject: project,
            navigationRevision: state.navigationRevision + 1,
            activeProject: project?.project ?? null,
            activeProjectRevision: state.activeProjectRevision + 1,
          };
        });
      },
      activeProject: null,
      activeProjectRevision: 0,
      setActiveProject: (projectName, profileId) => {
        if (!projectName) {
          get().setSelectedProject(null);
          return;
        }
        const currentRef = get().selectedProject;
        const targetProfileId = profileId ?? currentRef?.profileId ?? getActiveProfileId() ?? "";
        get().setSelectedProject({
          profileId: targetProfileId,
          project: projectName,
        });
      },
    }),
    {
      name: "dam-hopper:workspace-state",
      version: 1,
      partialize: (state) => ({
        selectedProject: state.selectedProject,
      }),
      onRehydrateStorage: () => (state) => {
        // Drop legacy unowned active-project key per G0/Phase 02 contract
        try {
          localStorage.removeItem("dam-hopper:active-project");
        } catch {
          // ignore
        }
        if (state?.selectedProject) {
          state.activeProject = state.selectedProject.project;
          if (state.selectedProject.profileId && state.selectedProject.profileId !== getActiveProfileId()) {
            setActiveProfile(state.selectedProject.profileId);
          }
        }
      },
    },
  ),
);
