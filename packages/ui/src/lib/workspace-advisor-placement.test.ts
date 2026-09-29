// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ADVISOR_DEFAULT_Z_INDEX,
  measureAdvisorSlotGeometry,
  type AdvisorSlotDescriptor,
} from "./workspace-advisor-placement.js";

describe("workspace-advisor-placement", () => {
  describe("measureAdvisorSlotGeometry", () => {
    it("returns null when descriptor is null or invisible or element missing", () => {
      expect(measureAdvisorSlotGeometry(null)).toBeNull();

      expect(
        measureAdvisorSlotGeometry({
          id: "test",
          mode: "ide",
          element: null,
          visible: true,
        }),
      ).toBeNull();

      const el = document.createElement("div");
      document.body.appendChild(el);
      expect(
        measureAdvisorSlotGeometry({
          id: "test",
          mode: "ide",
          element: el,
          visible: false,
        }),
      ).toBeNull();
      document.body.removeChild(el);
    });

    it("returns null when element is not connected to DOM", () => {
      const el = document.createElement("div");
      expect(
        measureAdvisorSlotGeometry({
          id: "test",
          mode: "ide",
          element: el,
          visible: true,
        }),
      ).toBeNull();
    });

    it("returns null when element dimensions are 0", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      // In JSDOM, default getBoundingClientRect is all 0
      expect(
        measureAdvisorSlotGeometry({
          id: "test",
          mode: "ide",
          element: el,
          visible: true,
        }),
      ).toBeNull();
      document.body.removeChild(el);
    });

    it("measures geometry and applies default z-index by mode", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      el.getBoundingClientRect = () =>
        ({
          top: 100.4,
          left: 50.2,
          width: 320.1,
          height: 480.9,
          right: 370.3,
          bottom: 581.3,
          x: 50.2,
          y: 100.4,
          toJSON: () => {},
        }) as DOMRect;

      const ideGeo = measureAdvisorSlotGeometry({
        id: "ide-slot",
        mode: "ide",
        element: el,
        visible: true,
      });

      expect(ideGeo).toEqual({
        top: 100,
        left: 50,
        width: 320,
        height: 481,
        zIndex: ADVISOR_DEFAULT_Z_INDEX.ide,
        mode: "ide",
      });

      const termGeo = measureAdvisorSlotGeometry({
        id: "term-slot",
        mode: "terminal",
        element: el,
        visible: true,
      });
      expect(termGeo?.zIndex).toBe(ADVISOR_DEFAULT_Z_INDEX.terminal);

      const compactGeo = measureAdvisorSlotGeometry({
        id: "compact-slot",
        mode: "compact",
        element: el,
        visible: true,
      });
      expect(compactGeo?.zIndex).toBe(ADVISOR_DEFAULT_Z_INDEX.compact);

      document.body.removeChild(el);
    });

    it("preserves explicit custom zIndex", () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      el.getBoundingClientRect = () =>
        ({
          top: 10,
          left: 10,
          width: 100,
          height: 100,
          right: 110,
          bottom: 110,
          x: 10,
          y: 10,
          toJSON: () => {},
        }) as DOMRect;

      const geo = measureAdvisorSlotGeometry({
        id: "slot",
        mode: "terminal",
        element: el,
        visible: true,
        zIndex: 42,
      });

      expect(geo?.zIndex).toBe(42);
      document.body.removeChild(el);
    });
  });
});
