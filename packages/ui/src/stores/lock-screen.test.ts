// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  useLockScreenStore,
  deriveLockHash,
  LOCK_ACTIVE_STORAGE_KEY,
  LOCK_VERIFIER_STORAGE_KEY,
  LOCK_COOLDOWN_STORAGE_KEY,
} from "./lock-screen.js";

describe("useLockScreenStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useLockScreenStore.getState().reset();
  });

  it("initializes without PIN by default", () => {
    useLockScreenStore.getState().init();
    const state = useLockScreenStore.getState();
    expect(state.hasPin).toBe(false);
    expect(state.isLocked).toBe(false);
    expect(state.pinLength).toBe(4);
  });

  it("sets up a new PIN with PBKDF2 hash and locks the workspace", async () => {
    await useLockScreenStore.getState().setPin("1234");
    const state = useLockScreenStore.getState();
    expect(state.hasPin).toBe(true);
    expect(state.pinLength).toBe(4);

    const storedRaw = localStorage.getItem(LOCK_VERIFIER_STORAGE_KEY);
    expect(storedRaw).not.toBeNull();
    const parsed = JSON.parse(storedRaw!);
    expect(parsed.length).toBe(4);
    expect(parsed.hash).toBeDefined();

    // Verify derived hash matches
    const testHash = await deriveLockHash("1234", parsed.salt);
    expect(testHash).toBe(parsed.hash);

    // Lock
    useLockScreenStore.getState().lock();
    expect(useLockScreenStore.getState().isLocked).toBe(true);
    expect(localStorage.getItem(LOCK_ACTIVE_STORAGE_KEY)).toBe("1");
  });

  it("rejects invalid PIN length or non-numeric PIN", async () => {
    await expect(useLockScreenStore.getState().setPin("12")).rejects.toThrow();
    await expect(useLockScreenStore.getState().setPin("123456789")).rejects.toThrow();
    await expect(useLockScreenStore.getState().setPin("abcd")).rejects.toThrow();
  });

  it("verifies and unlocks with correct PIN and rejects incorrect PIN", async () => {
    await useLockScreenStore.getState().setPin("5678");
    useLockScreenStore.getState().lock();
    expect(useLockScreenStore.getState().isLocked).toBe(true);

    // Wrong PIN
    const wrong = await useLockScreenStore.getState().verifyAndUnlock("0000");
    expect(wrong).toBe(false);
    expect(useLockScreenStore.getState().isLocked).toBe(true);
    expect(useLockScreenStore.getState().failedAttempts).toBe(1);

    // Correct PIN
    const correct = await useLockScreenStore.getState().verifyAndUnlock("5678");
    expect(correct).toBe(true);
    expect(useLockScreenStore.getState().isLocked).toBe(false);
    expect(useLockScreenStore.getState().failedAttempts).toBe(0);
    expect(localStorage.getItem(LOCK_ACTIVE_STORAGE_KEY)).toBeNull();
  });

  it("enforces cooldown after 5 failed attempts", async () => {
    await useLockScreenStore.getState().setPin("9999");
    useLockScreenStore.getState().lock();

    for (let i = 0; i < 4; i++) {
      const res = await useLockScreenStore.getState().verifyAndUnlock("1111");
      expect(res).toBe(false);
      expect(useLockScreenStore.getState().isCooldown).toBe(false);
    }

    // 5th failed attempt triggers cooldown
    const fifth = await useLockScreenStore.getState().verifyAndUnlock("1111");
    expect(fifth).toBe(false);
    expect(useLockScreenStore.getState().isCooldown).toBe(true);
    expect(useLockScreenStore.getState().cooldownUntil).toBeGreaterThan(Date.now());
    expect(localStorage.getItem(LOCK_COOLDOWN_STORAGE_KEY)).not.toBeNull();

    // Even correct PIN fails while in cooldown
    const blocked = await useLockScreenStore.getState().verifyAndUnlock("9999");
    expect(blocked).toBe(false);
  });

  it("supports changing PIN with current verification", async () => {
    await useLockScreenStore.getState().setPin("1111");
    const badChange = await useLockScreenStore.getState().changePin("2222", "3333");
    expect(badChange).toBe(false);

    const goodChange = await useLockScreenStore.getState().changePin("1111", "3333");
    expect(goodChange).toBe(true);

    useLockScreenStore.getState().lock();
    expect(await useLockScreenStore.getState().verifyAndUnlock("1111")).toBe(false);
    expect(await useLockScreenStore.getState().verifyAndUnlock("3333")).toBe(true);
  });

  it("supports removing PIN with current verification", async () => {
    await useLockScreenStore.getState().setPin("4444");
    useLockScreenStore.getState().lock();

    const badRemove = await useLockScreenStore.getState().removePin("0000");
    expect(badRemove).toBe(false);

    const goodRemove = await useLockScreenStore.getState().removePin("4444");
    expect(goodRemove).toBe(true);
    expect(useLockScreenStore.getState().hasPin).toBe(false);
    expect(useLockScreenStore.getState().isLocked).toBe(false);
    expect(localStorage.getItem(LOCK_VERIFIER_STORAGE_KEY)).toBeNull();
  });

  it("restores active lock on reload", async () => {
    await useLockScreenStore.getState().setPin("1234");
    useLockScreenStore.getState().lock();

    // Reset memory state, then call init() simulating page refresh
    useLockScreenStore.setState({ isLocked: false, hasPin: false });
    useLockScreenStore.getState().init();

    expect(useLockScreenStore.getState().hasPin).toBe(true);
    expect(useLockScreenStore.getState().isLocked).toBe(true);
  });
});
