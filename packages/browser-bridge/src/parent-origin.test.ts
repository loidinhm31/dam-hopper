import { describe, expect, it } from "vitest";
import { isAllowedParentOrigin } from "./index.js";

describe("isAllowedParentOrigin", () => {
  it("accepts only exact configured parent origins", () => {
    const options = {
      allowedParentOrigins: ["https://damhopper.example.com"],
    } as const;

    expect(
      isAllowedParentOrigin("https://damhopper.example.com", options),
    ).toBe(true);
    expect(
      isAllowedParentOrigin("https://evil.example.com", options),
    ).toBe(false);
    expect(
      isAllowedParentOrigin("https://damhopper.example.com:8443", options),
    ).toBe(false);
    expect(isAllowedParentOrigin("http://localhost:5173", options)).toBe(false);
  });

  it("keeps the default parent boundary limited to HTTP loopback", () => {
    expect(isAllowedParentOrigin("http://localhost:4800", {})).toBe(true);
    expect(isAllowedParentOrigin("http://127.0.0.1:4800", {})).toBe(true);
    expect(isAllowedParentOrigin("https://localhost:4800", {})).toBe(false);
    expect(isAllowedParentOrigin("https://damhopper.example.com", {})).toBe(
      false,
    );
  });

  it("lets an explicit parent origin replace the loopback default", () => {
    const options = { parentOrigin: "https://damhopper.example.com" } as const;

    expect(
      isAllowedParentOrigin("https://damhopper.example.com", options),
    ).toBe(true);
    expect(isAllowedParentOrigin("http://localhost:4800", options)).toBe(
      false,
    );
  });
});
