import { afterEach, describe, expect, it } from "vitest";
import { getBrowserDebugViewportFrame } from "@/lib/browser-debug-keep-alive.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("browser debug keep-alive in Chromium", () => {
  it("keeps a loaded iframe in its stable host while its viewport frame changes", async () => {
    const parking = document.createElement("div");
    const viewport = document.createElement("div");
    const frame = document.createElement("iframe");
    let loadCount = 0;
    frame.addEventListener("load", () => {
      loadCount += 1;
    });
    frame.srcdoc = "<p>cooperative target</p>";
    parking.append(frame);
    document.body.append(parking, viewport);
    await new Promise<void>((resolve) =>
      frame.addEventListener("load", () => resolve(), { once: true }),
    );
    frame.contentDocument?.body.setAttribute("data-keep-alive-probe", "loaded-once");

    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => new DOMRect(10, 20, 640, 480),
    });
    expect(getBrowserDebugViewportFrame(viewport)).toEqual({
      top: 20,
      left: 10,
      width: 640,
      height: 480,
    });
    expect(parking.querySelector("iframe")).toBe(frame);
    expect(frame.contentDocument?.body.getAttribute("data-keep-alive-probe")).toBe(
      "loaded-once",
    );
    expect(loadCount).toBe(1);

    expect(getBrowserDebugViewportFrame(null)).toBeNull();
    expect(parking.querySelector("iframe")).toBe(frame);
    expect(frame.contentDocument?.body.getAttribute("data-keep-alive-probe")).toBe(
      "loaded-once",
    );
    expect(loadCount).toBe(1);
  });
});
