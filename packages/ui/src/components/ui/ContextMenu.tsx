import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "@/lib/utils.js";
import {
  claimContextMenu,
  releaseContextMenu,
} from "@/lib/context-menu-coordinator.js";

type RootProps = React.ComponentProps<typeof ContextMenuPrimitive.Root> & {
  defaultOpen?: boolean;
};
const PortalScope = React.createContext(false);

/**
 * Adds app-level coordination around Radix's local menu state. The coordinator
 * is intentionally module-scoped: context menus are transient UI state and do
 * not need a store or provider in the application state graph.
 */
function ContextMenuRoot({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: RootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const close = React.useCallback(() => {
    if (!isControlled) setUncontrolledOpen(false);
    onOpenChangeRef.current?.(false);
  }, [isControlled]);

  React.useEffect(() => {
    if (open) {
      claimContextMenu(close);
    } else {
      releaseContextMenu(close);
    }
    return () => releaseContextMenu(close);
  }, [close, open]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) claimContextMenu(close);
      else releaseContextMenu(close);
      if (!isControlled) setUncontrolledOpen(nextOpen);
      onOpenChangeRef.current?.(nextOpen);
    },
    [close, isControlled],
  );

  return (
    <ContextMenuPrimitive.Root
      {...props}
      open={open}
      onOpenChange={handleOpenChange}
    />
  );
}

type TriggerProps = Omit<
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Trigger>,
  "asChild" | "children"
> & { children: React.ReactElement };

const ContextMenuTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Trigger>,
  TriggerProps
>(function ContextMenuTrigger(props, ref) {
  return <ContextMenuPrimitive.Trigger {...props} asChild ref={ref} />;
});

/** Body-only portal; Content also self-portals when used without this wrapper. */
type PortalProps = Omit<
  React.ComponentProps<typeof ContextMenuPrimitive.Portal>,
  "container"
>;

function ContextMenuPortal({ children, ...props }: PortalProps) {
  return (
    <ContextMenuPrimitive.Portal {...props}>
      <PortalScope.Provider value>{children}</PortalScope.Provider>
    </ContextMenuPrimitive.Portal>
  );
}

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent(
  {
    className,
    avoidCollisions = true,
    collisionPadding = 8,
    ...props
  },
  ref,
) {
  const inPortal = React.useContext(PortalScope);
  const content = (
    <ContextMenuPrimitive.Content
      ref={ref}
      avoidCollisions={avoidCollisions}
      collisionPadding={collisionPadding}
      className={cn(
        "z-[100] max-h-[var(--radix-context-menu-content-available-height)] max-w-[var(--radix-context-menu-content-available-width)] min-w-40 overflow-y-auto overflow-x-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[var(--color-text)] shadow-xl outline-none",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
  return inPortal ? content : <ContextMenuPrimitive.Portal>{content}</ContextMenuPrimitive.Portal>;
});

function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      {...props}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none",
        "focus:bg-[var(--color-primary)]/10 focus:text-[var(--color-primary)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    />
  );
}

function ContextMenuCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      {...props}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 pl-8 text-xs outline-none",
        "focus:bg-[var(--color-primary)]/10 focus:text-[var(--color-primary)]",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
    />
  );
}

function ContextMenuLabel({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      {...props}
      className={cn("px-2 py-1.5 text-xs font-semibold text-[var(--color-text-muted)]", className)}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      {...props}
      className={cn("-mx-1 my-1 h-px bg-[var(--color-border)]", className)}
    />
  );
}

const ContextMenu = {
  Root: ContextMenuRoot,
  Trigger: ContextMenuTrigger,
  Portal: ContextMenuPortal,
  Content: ContextMenuContent,
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
} as const;

export { ContextMenu, ContextMenuRoot, ContextMenuTrigger, ContextMenuPortal,
  ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem,
  ContextMenuLabel, ContextMenuSeparator };
