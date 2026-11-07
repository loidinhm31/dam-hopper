import {
  DOUBLE_SHIFT_SHORTCUT,
  DoubleShiftDetector,
  matchesKeyboardShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import {
  listActionDescriptors,
  resolveActionBinding,
  type ActionBindingsSettingsProjection,
  type ActionDescriptor,
  type OsActionId,
} from "./actions.js";

export interface ActionShortcutMatchResult {
  readonly actionId: OsActionId;
  readonly descriptor: ActionDescriptor;
  readonly chord: string;
}

/**
 * Checks whether a given keyboard event matches any configured OS action binding
 * from the action catalog and settings projection.
 *
 * Invariants (Architecture Contracts C1 & C5):
 * - If a binding is null/unbound, it never matches.
 * - DoubleShift is supported only if a DoubleShiftDetector is provided and matches.
 * - Ordinary Shift key presses that do not form a complete DoubleShift do not match.
 * - Protected local chords (like Terminal Copy Ctrl+Shift+C / Cmd+Shift+C) are preserved.
 * - Repeat events and composing IME events never match an OS action.
 */
export function matchConfiguredAction(
  event: ShortcutKeyEvent,
  settings?: ActionBindingsSettingsProjection | null,
  detector?: DoubleShiftDetector,
): ActionShortcutMatchResult | null {
  if (event.repeat || event.isComposing) return null;

  const descriptors = listActionDescriptors();

  for (const descriptor of descriptors) {
    const binding = resolveActionBinding(descriptor.id, settings);
    if (!binding) continue;

    if (binding === DOUBLE_SHIFT_SHORTCUT) {
      if (detector && detector.match(event)) {
        return {
          actionId: descriptor.id,
          descriptor,
          chord: binding,
        };
      }
    } else if (matchesKeyboardShortcut(binding, event)) {
      return {
        actionId: descriptor.id,
        descriptor,
        chord: binding,
      };
    }
  }

  return null;
}
