import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildTrustRepairRemoveCommand,
  buildTrustRepairRestoreCommand,
  quoteWindowsCommandArgument,
} from "./ssh-forward-trust-repair-command.js";
import type { SshForwardProfile } from "./ssh-forward-host.js";

const profile = {
  scopeId: "11111111-1111-4111-8111-111111111111",
  sshHost: "bastion.example",
  sshPort: 22,
} as SshForwardProfile;

describe("ssh-forward-trust-repair-command", () => {
  it("emits Command Prompt-safe argv with single Windows path separators", () => {
    const command = buildTrustRepairRemoveCommand(
      "C:\\Program Files\\Dam Hopper\\dam-hopper.exe",
      profile,
    );
    expect(command).toBe(
      '"C:\\Program Files\\Dam Hopper\\dam-hopper.exe" --ssh-forward-trust-repair remove-endpoint --scope "11111111-1111-4111-8111-111111111111" --host "bastion.example" --port 22',
    );
    expect(command).not.toContain("\\\\Program");
  });

  it("preserves trailing backslashes under CommandLineToArgvW quoting", () => {
    expect(quoteWindowsCommandArgument("C:\\Dam Hopper\\")).toBe(
      '"C:\\Dam Hopper\\\\"',
    );
  });

  it("round-trips supported arguments through Command Prompt on Windows", () => {
    if (process.platform !== "win32") return;
    const values = [
      "C:\\Program Files\\Dam Hopper\\",
      "C:\\%PATH%\\dam.exe",
      "C:\\bang!\\dam.exe",
    ];
    const script =
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
    const command = [
      quoteWindowsCommandArgument(process.execPath),
      quoteWindowsCommandArgument("-e"),
      quoteWindowsCommandArgument(script),
      ...values.map(quoteWindowsCommandArgument),
    ].join(" ");
    const output = execSync(command, {
      encoding: "utf8",
      shell: process.env.ComSpec ?? "cmd.exe",
    }).trim();
    expect(JSON.parse(output)).toEqual(values);
  });

  it("leaves restore backup ID explicit for offline recovery", () => {
    expect(
      buildTrustRepairRestoreCommand(
        "C:\\Dam Hopper\\dam-hopper.exe",
        profile.scopeId,
      ),
    ).toContain(' --backup-id "<backup-id>"');
  });
});
