import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";

/** Generate a cryptographically random 32-byte hex token. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Load token from file, or create a new one with 0600 permissions. */
export async function loadOrCreateToken(tokenPath: string): Promise<string> {
  try {
    const existing = await readFile(tokenPath, "utf-8");
    const token = existing.trim();
    if (token.length > 0) return token;
  } catch {
    // File doesn't exist — create it
  }

  const token = generateToken();
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, token, { mode: 0o600, encoding: "utf-8" });
  return token;
}

/** Timing-safe token comparison. */
export function validateToken(input: string, stored: string): boolean {
  try {
    const a = Buffer.from(input.trim(), "utf-8");
    const b = Buffer.from(stored.trim(), "utf-8");
    // Buffers must be same length for timingSafeEqual
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
