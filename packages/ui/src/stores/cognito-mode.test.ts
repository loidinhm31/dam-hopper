import { beforeEach, describe, expect, it } from "vitest";
import { useCognitoModeStore } from "./cognito-mode.js";

describe("useCognitoModeStore", () => {
  beforeEach(() => {
    useCognitoModeStore.getState().reset();
  });

  it("initializes with inactive state and null activation shortcut", () => {
    const state = useCognitoModeStore.getState();
    expect(state.active).toBe(false);
    expect(state.activationShortcut).toBeNull();
  });

  it("activates and freezes the supplied shortcut", () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    const activeState = useCognitoModeStore.getState();
    expect(activeState.active).toBe(true);
    expect(activeState.activationShortcut).toBe("Mod+Alt+KeyB");
  });

  it("deactivates and clears activation shortcut on toggle while active", () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    useCognitoModeStore.getState().toggle("Ctrl+Alt+KeyC");
    const inactiveState = useCognitoModeStore.getState();
    expect(inactiveState.active).toBe(false);
    expect(inactiveState.activationShortcut).toBeNull();
  });

  it("resets to initial inactive state", () => {
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    useCognitoModeStore.getState().reset();
    const state = useCognitoModeStore.getState();
    expect(state.active).toBe(false);
    expect(state.activationShortcut).toBeNull();
  });

  it("handles repeated activation and deactivation cycles", () => {
    for (let i = 0; i < 3; i++) {
      useCognitoModeStore.getState().toggle(`Chord-${i}`);
      expect(useCognitoModeStore.getState().active).toBe(true);
      expect(
        useCognitoModeStore.getState().activationShortcut,
      ).toBe(`Chord-${i}`);

      useCognitoModeStore.getState().toggle(`Chord-${i}`);
      expect(useCognitoModeStore.getState().active).toBe(false);
      expect(useCognitoModeStore.getState().activationShortcut).toBeNull();
    }
  });
});
