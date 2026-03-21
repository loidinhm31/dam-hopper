import chalk from "chalk";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

export const color = {
  success: chalk.green,
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,
  bold: chalk.bold,
};

export function printSuccess(msg: string): void {
  console.log(color.success("✓") + " " + msg);
}

export function printError(msg: string): void {
  console.error(color.error("✗") + " " + msg);
}

export function printWarn(msg: string): void {
  console.warn(color.warn("⚠") + " " + msg);
}
