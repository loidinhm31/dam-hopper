// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppZoomProvider, useAppZoom } from "./AppZoomContext.js";
import { APP_ZOOM_STORAGE_KEY } from "@/lib/app-zoom.js";
import type { AppZoomLevel, AppZoomStorage } from "@/lib/app-zoom.js";

function createStorage(
  initial?: string,
): AppZoomStorage & { read: () => string | null } {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, nextValue: string) => {
      value = nextValue;
    },
    read: () => value,
  };
}

function Harness() {
  const { level, canDecrease, canIncrease, setLevel, step } = useAppZoom();
  return (
    <>
      <output data-testid="level">{level}</output>
      <button
        type="button"
        data-testid="decrease"
        disabled={!canDecrease}
        onClick={() => step("decrease")}
      />
      <button
        type="button"
        data-testid="increase"
        disabled={!canIncrease}
        onClick={() => step("increase")}
      />
      <button
        type="button"
        data-testid="set-invalid"
        onClick={() => setLevel(85 as AppZoomLevel)}
      />
    </>
  );
}

let root: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  document.documentElement.style.zoom = "";
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  document.documentElement.style.zoom = "";
  vi.unstubAllGlobals();
});

function renderProvider(storage: AppZoomStorage = createStorage()) {
  vi.stubGlobal("localStorage", storage);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AppZoomProvider>
        <Harness />
      </AppZoomProvider>,
    );
  });
  return storage;
}

describe("AppZoomProvider", () => {
  it("loads the persisted level and applies it to the document root", () => {
    const storage = createStorage(JSON.stringify({ version: 1, zoom: 110 }));

    renderProvider(storage);

    expect(container.querySelector("[data-testid=level]")?.textContent).toBe(
      "110",
    );
    expect(document.documentElement.style.zoom).toBe("110%");
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
      "1.1",
    );
    expect(storage.read()).toContain(`"zoom":110`);
  });

  it("steps, persists, and reports boundary state", () => {
    const storage = createStorage();
    renderProvider(storage);
    const increase = container.querySelector(
      "[data-testid=increase]",
    ) as HTMLButtonElement;
    const decrease = container.querySelector(
      "[data-testid=decrease]",
    ) as HTMLButtonElement;

    act(() => increase.click());
    expect(document.documentElement.style.zoom).toBe("110%");
    expect(storage.read()).toContain(`"zoom":110`);

    act(() => {
      increase.click();
      increase.click();
      increase.click();
    });
    expect(document.documentElement.style.zoom).toBe("120%");
    expect(increase.disabled).toBe(true);

    act(() => {
      decrease.click();
      decrease.click();
      decrease.click();
      decrease.click();
      decrease.click();
      decrease.click();
      decrease.click();
    });
    expect(document.documentElement.style.zoom).toBe("50%");
    expect(decrease.disabled).toBe(true);
  });

  it("restores a pre-existing root zoom on unmount", () => {
    document.documentElement.style.zoom = "125%";

    renderProvider();
    expect(document.documentElement.style.zoom).toBe("100%");

    act(() => root?.unmount());
    root = null;
    expect(document.documentElement.style.zoom).toBe("125%");
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
      "",
    );
  });

  it("ignores a setter value outside the discrete level contract", () => {
    renderProvider();

    act(() =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=set-invalid]")
        ?.click(),
    );

    expect(container.querySelector("[data-testid=level]")?.textContent).toBe(
      "100",
    );
    expect(document.documentElement.style.zoom).toBe("100%");
  });

  it("fails open when localStorage operations throw", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };

    expect(() => renderProvider(unavailable)).not.toThrow();
    expect(document.documentElement.style.zoom).toBe("100%");
    expect(() => {
      const increase = container.querySelector(
        "[data-testid=increase]",
      ) as HTMLButtonElement;
      act(() => increase.click());
    }).not.toThrow();
    expect(document.documentElement.style.zoom).toBe("110%");
    expect(APP_ZOOM_STORAGE_KEY).toBe("dam-hopper:app-zoom:v1");
  });
});
