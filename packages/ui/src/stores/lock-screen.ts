import { create } from "zustand";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export interface LockVerifierRecord {
  version: 1;
  salt: string;
  hash: string;
  length: number;
  updatedAt: number;
}

export const LOCK_VERIFIER_STORAGE_KEY = "dam-hopper:os-lock-verifier";
export const LOCK_ACTIVE_STORAGE_KEY = "dam-hopper:os-lock-active";
export const LOCK_COOLDOWN_STORAGE_KEY = "dam-hopper:os-lock-cooldown";

export const MAX_LOCK_ATTEMPTS = 5;
export const LOCK_COOLDOWN_MS = 15_000;
export async function deriveLockHash(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const saltMatches = saltHex.match(/.{1,2}/g);
  const salt = new Uint8Array(
    saltMatches ? saltMatches.map((byte) => parseInt(byte, 16)) : [],
  );

  // Use pbkdf2Async from @noble/hashes (pure JS, Secure Context independent)
  // Matches standard WebCrypto PBKDF2 with SHA-256, 100,000 iterations, 32 bytes (256 bits).
  const derived = await pbkdf2Async(sha256, enc.encode(pin), salt, {
    c: 100_000,
    dkLen: 32,
  });
  return bytesToHex(derived);
}

export function generateLockSalt(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error(
      "Secure random number generator (crypto.getRandomValues) is unavailable.",
    );
  }
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export interface LockScreenState {
  isLocked: boolean;
  hasPin: boolean;
  pinLength: number;
  isCooldown: boolean;
  cooldownUntil: number | null;
  failedAttempts: number;
  isVerifying: boolean;

  init: () => void;
  lock: () => void;
  unlock: () => void;
  verifyAndUnlock: (pin: string) => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  removePin: (currentPin: string) => Promise<boolean>;
  reset: () => void;
}

function readStoredVerifier(): LockVerifierRecord | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCK_VERIFIER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockVerifierRecord;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.salt === "string" &&
      typeof parsed.hash === "string" &&
      typeof parsed.length === "number" &&
      parsed.length >= 4 &&
      parsed.length <= 8
    ) {
      return parsed;
    }
  } catch {
    // Malformed storage
  }
  return null;
}

function readStoredCooldown(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCK_COOLDOWN_STORAGE_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    if (Number.isFinite(ts) && ts > Date.now()) {
      return ts;
    }
  } catch {
    // Malformed storage
  }
  return null;
}

export const useLockScreenStore = create<LockScreenState>((set, get) => ({
  isLocked: false,
  hasPin: false,
  pinLength: 4,
  isCooldown: false,
  cooldownUntil: null,
  failedAttempts: 0,
  isVerifying: false,

  init: () => {
    const verifier = readStoredVerifier();
    const hasPin = Boolean(verifier);
    const pinLength = verifier?.length ?? 4;
    const cooldownUntil = readStoredCooldown();
    const isCooldown = cooldownUntil !== null && cooldownUntil > Date.now();
    const isLocked =
      hasPin &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem(LOCK_ACTIVE_STORAGE_KEY) === "1";

    set({
      hasPin,
      pinLength,
      isCooldown,
      cooldownUntil,
      isLocked,
    });
  },

  lock: () => {
    const { hasPin } = get();
    if (!hasPin) return;
    try {
      localStorage.setItem(LOCK_ACTIVE_STORAGE_KEY, "1");
    } catch {
      // Storage error
    }
    set({ isLocked: true });
  },

  unlock: () => {
    try {
      localStorage.removeItem(LOCK_ACTIVE_STORAGE_KEY);
      localStorage.removeItem(LOCK_COOLDOWN_STORAGE_KEY);
    } catch {
      // Storage error
    }
    set({
      isLocked: false,
      failedAttempts: 0,
      isCooldown: false,
      cooldownUntil: null,
    });
  },

  verifyAndUnlock: async (pin: string) => {
    const state = get();
    if (state.isVerifying) return false;

    // Check cooldown
    if (state.cooldownUntil && state.cooldownUntil > Date.now()) {
      set({ isCooldown: true });
      return false;
    }

    const verifier = readStoredVerifier();
    if (!verifier) {
      // Fail closed when verifier is missing or unusable
      return false;
    }

    set({ isVerifying: true });
    try {
      const computedHash = await deriveLockHash(pin, verifier.salt);
      if (computedHash === verifier.hash) {
        get().unlock();
        return true;
      }

      // Failed attempt
      const nextFailures = state.failedAttempts + 1;
      if (nextFailures >= MAX_LOCK_ATTEMPTS) {
        const cooldownUntil = Date.now() + LOCK_COOLDOWN_MS;
        try {
          localStorage.setItem(
            LOCK_COOLDOWN_STORAGE_KEY,
            String(cooldownUntil),
          );
        } catch {
          // Ignore
        }
        set({
          failedAttempts: nextFailures,
          isCooldown: true,
          cooldownUntil,
        });
      } else {
        set({ failedAttempts: nextFailures });
      }
      return false;
    } finally {
      set({ isVerifying: false });
    }
  },

  setPin: async (pin: string) => {
    if (pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
      throw new Error("PIN must be 4 to 8 digits");
    }
    const salt = generateLockSalt();
    const hash = await deriveLockHash(pin, salt);
    const record: LockVerifierRecord = {
      version: 1,
      salt,
      hash,
      length: pin.length,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(
        LOCK_VERIFIER_STORAGE_KEY,
        JSON.stringify(record),
      );
    } catch (err) {
      throw new Error("Failed to persist PIN verifier to local storage");
    }
    set({
      hasPin: true,
      pinLength: pin.length,
      failedAttempts: 0,
      isCooldown: false,
      cooldownUntil: null,
    });
  },

  changePin: async (currentPin: string, newPin: string) => {
    const verifier = readStoredVerifier();
    if (!verifier) return false;
    const currentHash = await deriveLockHash(currentPin, verifier.salt);
    if (currentHash !== verifier.hash) return false;

    await get().setPin(newPin);
    return true;
  },

  removePin: async (currentPin: string) => {
    const verifier = readStoredVerifier();
    if (!verifier) return false;
    const currentHash = await deriveLockHash(currentPin, verifier.salt);
    if (currentHash !== verifier.hash) return false;

    try {
      localStorage.removeItem(LOCK_VERIFIER_STORAGE_KEY);
      localStorage.removeItem(LOCK_ACTIVE_STORAGE_KEY);
      localStorage.removeItem(LOCK_COOLDOWN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    set({
      hasPin: false,
      pinLength: 4,
      isLocked: false,
      failedAttempts: 0,
      isCooldown: false,
      cooldownUntil: null,
    });
    return true;
  },

  reset: () => {
    try {
      localStorage.removeItem(LOCK_VERIFIER_STORAGE_KEY);
      localStorage.removeItem(LOCK_ACTIVE_STORAGE_KEY);
      localStorage.removeItem(LOCK_COOLDOWN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    set({
      isLocked: false,
      hasPin: false,
      pinLength: 4,
      isCooldown: false,
      cooldownUntil: null,
      failedAttempts: 0,
      isVerifying: false,
    });
  },
}));
