import { describe, expect, it } from "vitest";
import {
  isTerminalFitEligible,
  type TerminalFitCandidate,
} from "./terminal-fit-eligibility.js";

function measurableElement(overrides: Partial<HTMLElement> = {}): HTMLElement {
  const element = {
    isConnected: true,
    style: { display: "block" },
    parentElement: {
      style: { display: "block" },
      closest: () => null,
    },
    closest: () => null,
    getBoundingClientRect: () => ({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
    }),
    ...overrides,
  };
  return element as unknown as HTMLElement;
}

describe("isTerminalFitEligible", () => {
  it("returns false for undefined target", () => {
    expect(isTerminalFitEligible(undefined)).toBe(false);
  });

  it("fails closed for target without DOM elements", () => {
    const target: TerminalFitCandidate = {};
    expect(isTerminalFitEligible(target)).toBe(false);
  });

  it("refuses disconnected DOM elements", () => {
    const element = measurableElement({ isConnected: false });
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(false);
  });

  it("refuses elements parked in TerminalKeepAliveHost", () => {
    const element = measurableElement({
      closest: (selector: string) =>
        selector.includes("data-terminal-parking-host")
          ? ({} as Element)
          : null,
    });
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(false);
  });

  it("refuses elements in aria-hidden ancestor containers", () => {
    const element = measurableElement({
      closest: (selector: string) =>
        selector === "[aria-hidden='true']" ? ({} as Element) : null,
    });
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(false);
  });

  it("refuses elements with display: none", () => {
    const element = measurableElement({
      style: { display: "none" } as unknown as CSSStyleDeclaration,
    });
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(false);
  });

  it("refuses elements whose parent has display: none", () => {
    const element = measurableElement({
      parentElement: {
        style: { display: "none" },
        closest: () => null,
      } as unknown as HTMLElement,
    });
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(false);
  });

  it("refuses elements with zero size dimensions", () => {
    const element = measurableElement({
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }),
    });
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(false);
  });

  it("permits visible, connected elements attached to an active presentation host", () => {
    const element = measurableElement();
    expect(isTerminalFitEligible({ attachmentElement: element })).toBe(true);
  });
});
