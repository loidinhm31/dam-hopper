// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKFLOW_CONTEXT_SHORTCUT,
  isEditableOrSuppressedTarget,
  isWorkflowShortcutOwner,
  matchesWorkflowToggleShortcut,
  restoreWorkflowFocus,
} from "./workflow-focus.js";

describe("workflow-focus", () => {
  it("exposes default Mod+Shift+KeyW shortcut", () => {
    expect(DEFAULT_WORKFLOW_CONTEXT_SHORTCUT).toBe("Mod+Shift+KeyW");
  });

  describe("isEditableOrSuppressedTarget", () => {
    it("returns false for null / non-element target", () => {
      expect(isEditableOrSuppressedTarget(null)).toBe(false);
      expect(isEditableOrSuppressedTarget(undefined as unknown as EventTarget)).toBe(false);
    });

    it("returns true for input, textarea, and select elements", () => {
      const input = document.createElement("input");
      const textarea = document.createElement("textarea");
      const select = document.createElement("select");
      const div = document.createElement("div");

      expect(isEditableOrSuppressedTarget(input)).toBe(true);
      expect(isEditableOrSuppressedTarget(textarea)).toBe(true);
      expect(isEditableOrSuppressedTarget(select)).toBe(true);
      expect(isEditableOrSuppressedTarget(div)).toBe(false);
    });

    it("returns true for contenteditable elements", () => {
      const div = document.createElement("div");
      div.contentEditable = "true";
      expect(isEditableOrSuppressedTarget(div)).toBe(true);
    });

    it("returns true for elements inside monaco-editor, xterm, or dialogs", () => {
      const monacoContainer = document.createElement("div");
      monacoContainer.className = "monaco-editor";
      const monacoChild = document.createElement("span");
      monacoContainer.appendChild(monacoChild);

      const xtermContainer = document.createElement("div");
      xtermContainer.className = "xterm-screen";
      const xtermChild = document.createElement("span");
      xtermContainer.appendChild(xtermChild);

      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      const dialogChild = document.createElement("button");
      dialog.appendChild(dialogChild);

      const suppressDiv = document.createElement("div");
      suppressDiv.setAttribute("data-suppress-shortcuts", "true");
      const suppressChild = document.createElement("span");
      suppressDiv.appendChild(suppressChild);

      expect(isEditableOrSuppressedTarget(monacoChild)).toBe(true);
      expect(isEditableOrSuppressedTarget(xtermChild)).toBe(true);
      expect(isEditableOrSuppressedTarget(dialogChild)).toBe(true);
      expect(isEditableOrSuppressedTarget(suppressChild)).toBe(true);
    });
  });

  describe("isWorkflowShortcutOwner", () => {
    it("returns true when target and activeElement are non-editable", () => {
      const button = document.createElement("button");
      document.body.appendChild(button);
      button.focus();

      expect(isWorkflowShortcutOwner(button, button)).toBe(true);
      document.body.removeChild(button);
    });

    it("returns false if target is inside an editable input", () => {
      const input = document.createElement("input");
      expect(isWorkflowShortcutOwner(input, document.body)).toBe(false);
    });

    it("returns false if activeElement is inside terminal or monaco", () => {
      const xterm = document.createElement("div");
      xterm.className = "xterm";
      const child = document.createElement("button");
      xterm.appendChild(child);
      document.body.appendChild(xterm);
      child.focus();

      expect(isWorkflowShortcutOwner(document.body, child)).toBe(false);
      document.body.removeChild(xterm);
    });
  });

  describe("matchesWorkflowToggleShortcut", () => {
    it("matches Ctrl+Shift+W on non-Mac", () => {
      const event = {
        type: "keydown",
        code: "KeyW",
        ctrlKey: true,
        shiftKey: true,
        metaKey: false,
        altKey: false,
      } as unknown as KeyboardEvent;

      expect(matchesWorkflowToggleShortcut(event, false)).toBe(true);
      expect(matchesWorkflowToggleShortcut(event, true)).toBe(false);
    });

    it("matches Cmd+Shift+W on Mac", () => {
      const event = {
        type: "keydown",
        code: "KeyW",
        ctrlKey: false,
        shiftKey: true,
        metaKey: true,
        altKey: false,
      } as unknown as KeyboardEvent;

      expect(matchesWorkflowToggleShortcut(event, true)).toBe(true);
      expect(matchesWorkflowToggleShortcut(event, false)).toBe(false);
    });
  });

  describe("restoreWorkflowFocus", () => {
    it("calls focus on connected element", () => {
      const button = document.createElement("button");
      document.body.appendChild(button);
      const focusSpy = vi.spyOn(button, "focus");

      restoreWorkflowFocus(button);
      expect(focusSpy).toHaveBeenCalled();
      document.body.removeChild(button);
    });

    it("does not throw for disconnected element or null", () => {
      const button = document.createElement("button");
      expect(() => restoreWorkflowFocus(button)).not.toThrow();
      expect(() => restoreWorkflowFocus(null)).not.toThrow();
    });
  });
});
