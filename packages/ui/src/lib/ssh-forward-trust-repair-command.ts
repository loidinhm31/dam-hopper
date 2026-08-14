import type { SshForwardProfile } from "@/lib/ssh-forward-host.js";

export function buildTrustRepairRemoveCommand(
  executablePath: string,
  profile: SshForwardProfile,
): string {
  return `${quoteWindowsCommandArgument(executablePath)} --ssh-forward-trust-repair remove-endpoint --scope ${quoteWindowsCommandArgument(profile.scopeId)} --host ${quoteWindowsCommandArgument(profile.sshHost)} --port ${profile.sshPort}`;
}

export function buildTrustRepairRestoreCommand(
  executablePath: string,
  scopeId: string,
): string {
  return `${quoteWindowsCommandArgument(executablePath)} --ssh-forward-trust-repair restore --scope ${quoteWindowsCommandArgument(scopeId)} --backup-id ${quoteWindowsCommandArgument("<backup-id>")}`;
}

/** Quote one argument for Command Prompt and CommandLineToArgvW/Rust argv. */
export function quoteWindowsCommandArgument(value: string): string {
  let result = "";
  let segment = "";
  for (const character of value) {
    if (character === "%" || character === "!") {
      result += quoteWindowsArgvSegment(segment) + `^${character}`;
      segment = "";
    } else {
      segment += character;
    }
  }
  return result + quoteWindowsArgvSegment(segment);
}

function quoteWindowsArgvSegment(value: string): string {
  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
    } else if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      result += "\\".repeat(backslashes) + character;
      backslashes = 0;
    }
  }
  return result + "\\".repeat(backslashes * 2) + '"';
}
