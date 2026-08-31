export interface OpenTerminalTitle {
  baseLabel: string;
  ordinal: number;
  fullText: string;
}

export type WithOpenTerminalTitle<T> = T & {
  title: OpenTerminalTitle;
};

export function freeTerminalBaseLabel(index?: number): string {
  return index === undefined ? "Terminal (starting…)" : `Terminal ${index}`;
}

export function terminalBaseLabel(
  name: string | null | undefined,
  fallback: string,
): string {
  return name ?? fallback;
}

const PROJECTLESS_TAB_GROUP = Symbol("projectless-terminal-tabs");

export function applyTerminalTitleOrdinals<
  T extends { label: string; project?: string },
>(readonlyTabs: readonly T[]): Array<WithOpenTerminalTitle<T>> {
  const ordinalsByProject = new Map<string | symbol, number>();
  return readonlyTabs.map((tab) => {
    const projectGroup =
      typeof tab.project === "string" && tab.project.length > 0
        ? tab.project
        : PROJECTLESS_TAB_GROUP;
    const ordinal = (ordinalsByProject.get(projectGroup) ?? 0) + 1;
    ordinalsByProject.set(projectGroup, ordinal);
    const title: OpenTerminalTitle = {
      baseLabel: tab.label,
      ordinal,
      fullText: `${tab.label} #${ordinal}`,
    };
    return { ...tab, title };
  });
}
