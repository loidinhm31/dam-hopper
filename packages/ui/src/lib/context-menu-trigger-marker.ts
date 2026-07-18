export const contextMenuTriggerMarker =
  "data-dam-hopper-context-menu-trigger";

export function eventTargetsContextMenuTrigger(event: MouseEvent): boolean {
  return event.composedPath().some(
    (target) =>
      target instanceof Element && target.hasAttribute(contextMenuTriggerMarker),
  );
}
