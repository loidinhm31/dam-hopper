import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceStore {
  activeProject: string | null;
  setActiveProject: (project: string | null) => void;
}

const ACTIVE_PROJECT_KEY = "dam-hopper:active-project";

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      activeProject: localStorage.getItem(ACTIVE_PROJECT_KEY),
      setActiveProject: (project) => {
        set({ activeProject: project });
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
