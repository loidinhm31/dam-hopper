export const TERMINAL_FILE_PANEL_TABS = ["explorer", "changes"] as const;

export type TerminalFloatingFilePanelTab =
  (typeof TERMINAL_FILE_PANEL_TABS)[number];

export function getTerminalFloatingFilePanelTabForKey(
  activeTab: TerminalFloatingFilePanelTab,
  key: string,
): TerminalFloatingFilePanelTab | null {
  const activeIndex = TERMINAL_FILE_PANEL_TABS.indexOf(activeTab);

  switch (key) {
    case "ArrowLeft":
      return TERMINAL_FILE_PANEL_TABS.at(
        (activeIndex - 1 + TERMINAL_FILE_PANEL_TABS.length) %
          TERMINAL_FILE_PANEL_TABS.length,
      )!;
    case "ArrowRight":
      return TERMINAL_FILE_PANEL_TABS.at(
        (activeIndex + 1) % TERMINAL_FILE_PANEL_TABS.length,
      )!;
    case "Home":
      return TERMINAL_FILE_PANEL_TABS[0];
    case "End":
      return TERMINAL_FILE_PANEL_TABS.at(-1)!;
    default:
      return null;
  }
}
