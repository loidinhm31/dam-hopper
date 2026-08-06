import { logger } from "@dam-hopper/shared/logger";

export interface TerminalFitTarget {
  fitAddon: { fit: () => void };
  terminal: { focus: () => void };
}

interface ScheduledFit {
  frameId: number;
  focus: boolean;
}

const scheduledFits = new Map<TerminalFitTarget, ScheduledFit>();

export function fitTerminalNow(
  target: TerminalFitTarget | undefined,
  options: { focus?: boolean } = {},
): void {
  if (!target) return;

  try {
    target.fitAddon.fit();
    if (options.focus) target.terminal.focus();
  } catch {
    logger.debug("TerminalFitScheduler", "skipped disposed terminal");
  }
}

export function scheduleTerminalFit(
  target: TerminalFitTarget | undefined,
  options: { focus?: boolean } = {},
): void {
  if (!target) return;

  const existing = scheduledFits.get(target);
  if (existing) {
    if ("focus" in options) existing.focus = options.focus === true;
    return;
  }

  const scheduled: ScheduledFit = {
    frameId: 0,
    focus: options.focus ?? false,
  };
  scheduled.frameId = requestAnimationFrame(() => {
    scheduledFits.delete(target);
    fitTerminalNow(target, { focus: scheduled.focus });
  });
  scheduledFits.set(target, scheduled);
}

export function fitAllTerminals(
  targets: Iterable<TerminalFitTarget>,
  options: { focus?: boolean } = {},
): void {
  for (const target of targets) scheduleTerminalFit(target, options);
}

export function cancelScheduledTerminalFit(
  target: TerminalFitTarget | undefined,
): void {
  if (!target) return;

  const scheduled = scheduledFits.get(target);
  if (!scheduled) return;

  cancelAnimationFrame(scheduled.frameId);
  scheduledFits.delete(target);
}
