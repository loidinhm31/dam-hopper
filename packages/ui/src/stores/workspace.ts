import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceStore {
  activeProject: string | null;
  activeProjectRevision: number;
  setActiveProject: (project: string | null) => void;
}

const ACTIVE_PROJECT_KEY = "dam-hopper:active-project";

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      activeProject: localStorage.getItem(ACTIVE_PROJECT_KEY),
      activeProjectRevision: 0,
      setActiveProject: (project) => {
        set((state) =>
          state.activeProject === project
            ? state
            : {
                activeProject: project,
                activeProjectRevision: state.activeProjectRevision + 1,
              },
        );
        if (project) {
          localStorage.setItem(ACTIVE_PROJECT_KEY, project);
        } else {
          localStorage.removeItem(ACTIVE_PROJECT_KEY);
        }
      },
    }),
    {
      name: "dam-hopper:workspace-state",
    },
  ),
);
