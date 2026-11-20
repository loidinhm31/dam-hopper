import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadAntiDetectionScript(): string {
  const stealthPath = path.resolve(
    process.cwd(),
    "../../server/src/browser_host/stealth.rs",
  );
  const source = readFileSync(stealthPath, "utf8");
  const match = source.match(
    /pub const ANTI_DETECTION_SCRIPT: &str = r#"([\s\S]*?)"#;/,
  );
  if (!match) {
    throw new Error("Could not extract ANTI_DETECTION_SCRIPT from stealth.rs");
  }
  return match[1];
}

function loadWorkerStealthScript(): string {
  const stealthPath = path.resolve(
    process.cwd(),
    "../../server/src/browser_host/stealth.rs",
  );
  const source = readFileSync(stealthPath, "utf8");
  const match = source.match(
    /pub const WORKER_STEALTH_SCRIPT: &str = r#"([\s\S]*?)"#;/,
  );
  if (!match) {
    throw new Error("Could not extract WORKER_STEALTH_SCRIPT from stealth.rs");
  }
  return match[1];
}

describe("ANTI_DETECTION_SCRIPT runtime stealth invariants", () => {
  it("masks patched functions and getters, is idempotent, and avoids own string keys on AudioNode.prototype", () => {
    const script = loadAntiDetectionScript();
    class FakeEventTarget {}
    class FakeNavigator {
      get webdriver() {
        return false;
      }
    }
    class FakeDocument {
      hasFocus() {
        return false;
      }
    }
    class FakeHistory {
      pushState() {
        return "pushed";
      }
      replaceState() {
        return "replaced";
      }
    }
    class FakePermissions {
      query() {
        return Promise.resolve({ state: "denied" });
      }
    }
    class FakeMediaElement {
      canPlayType() {
        return "";
      }
    }
    class FakeAudioNode {
      connect() {}
      disconnect() {}
    }
    class FakeAudioContext {
      createMediaElementSource() {}
    }
    class FakeIFrameElement {
      get contentWindow() {
        return null;
      }
    }
    class FakeWebGLRenderingContext {
      getParameter(pname: number) {
        if (pname === 37445) return "Google Inc. (Google)";
        if (pname === 37446) {
          return "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
        }
        return "WebGL 1.0";
      }
    }
    class FakeWebGL2RenderingContext {
      getParameter(pname: number) {
        if (pname === 37445) return "Google Inc. (NVIDIA)";
        if (pname === 37446) {
          return "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)";
        }
        return "WebGL 2.0";
      }
    }
    class FakeScreen {
      get width() {
        return 800;
      }
      get height() {
        return 600;
      }
      get availWidth() {
        return 800;
      }
      get availHeight() {
        return 600;
      }
    }

    const fakeNav = Object.create(FakeNavigator.prototype);
    fakeNav.userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36";
    fakeNav.mediaDevices = { enumerateDevices: async () => [] };
    const fakeScreen = Object.create(FakeScreen.prototype);

    const context: Record<string, unknown> = {
      EventTarget: FakeEventTarget,
      Navigator: FakeNavigator,
      Document: FakeDocument,
      History: FakeHistory,
      Permissions: FakePermissions,
      HTMLMediaElement: FakeMediaElement,
      AudioNode: FakeAudioNode,
      AudioContext: FakeAudioContext,
      HTMLIFrameElement: FakeIFrameElement,
      WebGLRenderingContext: FakeWebGLRenderingContext,
      WebGL2RenderingContext: FakeWebGL2RenderingContext,
      Screen: FakeScreen,
      MediaSource: { isTypeSupported: () => false },
      Notification: { permission: "denied" },
      navigator: fakeNav,
      screen: fakeScreen,
      innerWidth: 300,
      innerHeight: 65,
      outerWidth: 800,
      outerHeight: 600,
      top: {},
      performance: { now: () => 1 },
      addEventListener() {},
    };
    context.window = context;

    vm.createContext(context);
    vm.runInContext(script, context);
    // Double-injection must be idempotent
    vm.runInContext(script, context);

    expect(
      vm.runInContext("function userFn() { return 42; } Function.prototype.toString.call(userFn)", context),
    ).toContain("return 42");
    expect(() => vm.runInContext("Function.prototype.toString.call({})", context)).toThrow();

    expect(vm.runInContext("Document.prototype.hasFocus.toString()", context)).toBe(
      "function hasFocus() { [native code] }",
    );
    expect(vm.runInContext("Function.prototype.toString.call(Document.prototype.hasFocus)", context)).toBe(
      "function hasFocus() { [native code] }",
    );
    expect(vm.runInContext("History.prototype.pushState.toString()", context)).toBe(
      "function pushState() { [native code] }",
    );
    expect(vm.runInContext("History.prototype.replaceState.toString()", context)).toBe(
      "function replaceState() { [native code] }",
    );
    expect(vm.runInContext("Permissions.prototype.query.toString()", context)).toBe(
      "function query() { [native code] }",
    );
    expect(vm.runInContext("HTMLMediaElement.prototype.canPlayType.toString()", context)).toBe(
      "function canPlayType() { [native code] }",
    );
    expect(vm.runInContext("MediaSource.isTypeSupported.toString()", context)).toBe(
      "function isTypeSupported() { [native code] }",
    );
    expect(vm.runInContext("AudioNode.prototype.connect.toString()", context)).toBe(
      "function connect() { [native code] }",
    );
    expect(vm.runInContext("AudioNode.prototype.disconnect.toString()", context)).toBe(
      "function disconnect() { [native code] }",
    );
    expect(vm.runInContext("AudioContext.prototype.createMediaElementSource.toString()", context)).toBe(
      "function createMediaElementSource() { [native code] }",
    );
    expect(
      vm.runInContext(
        "Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get.toString()",
        context,
      ),
    ).toBe("function get contentWindow() { [native code] }");
    expect(
      vm.runInContext("Object.getOwnPropertyDescriptor(navigator, 'userAgentData').get.toString()", context),
    ).toBe("function get userAgentData() { [native code] }");
    expect(vm.runInContext("Object.getOwnPropertyNames(AudioNode.prototype)", context)).not.toContain(
      "__dhOrigConn",
    );
    expect(vm.runInContext("Object.getOwnPropertyNames(AudioNode.prototype)", context)).not.toContain(
      "__dhOrigDisc",
    );
    expect(vm.runInContext("'webdriver' in navigator && navigator.webdriver === false", context)).toBe(true);
    expect(vm.runInContext("window.outerWidth === 1280 && window.outerHeight === 985", context)).toBe(true);
    expect(
      vm.runInContext(
        "Object.getOwnPropertyDescriptor(window, 'outerWidth').enumerable && Object.getOwnPropertyDescriptor(window, 'outerHeight').enumerable",
        context,
      ),
    ).toBe(true);
    expect(vm.runInContext("screen.width === 1920 && screen.height === 1080", context)).toBe(true);
    expect(
      vm.runInContext("WebGLRenderingContext.prototype.getParameter.toString()", context),
    ).toBe("function getParameter() { [native code] }");
    expect(
      vm.runInContext("new WebGLRenderingContext().getParameter(37445)", context),
    ).toBe("Google Inc. (AMD)");
    expect(
      vm.runInContext("new WebGLRenderingContext().getParameter(37446)", context),
    ).toContain("AMD Radeon 780M");
    // Hardware GPU (non-SwiftShader) preserves its genuine vendor and renderer
    expect(
      vm.runInContext("new WebGL2RenderingContext().getParameter(37445)", context),
    ).toBe("Google Inc. (NVIDIA)");
    expect(
      vm.runInContext("new WebGL2RenderingContext().getParameter(37446)", context),
    ).toContain("NVIDIA GeForce RTX 4090");
  });

  it("handles top-level outerHeight chrome padding, fallback webdriver masking, and WORKER_STEALTH_SCRIPT idempotency", () => {
    const antiScript = loadAntiDetectionScript();
    const workerScript = loadWorkerStealthScript();

    class FakeEventTarget {}
    class FakeNavigator {
      get webdriver() {
        return true;
      }
    }
    const fakeNav = Object.create(FakeNavigator.prototype);
    Object.defineProperty(fakeNav, "webdriver", {
      value: true,
      configurable: true,
      enumerable: true,
    });
    fakeNav.userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

    const topContext: Record<string, unknown> = {
      EventTarget: FakeEventTarget,
      Navigator: FakeNavigator,
      navigator: fakeNav,
      innerWidth: 1280,
      innerHeight: 900,
      outerWidth: 1280,
      outerHeight: 900,
      performance: { now: () => 1 },
      addEventListener() {},
    };
    topContext.window = topContext;
    topContext.top = topContext;

    vm.createContext(topContext);
    vm.runInContext(antiScript, topContext);

    expect(
      vm.runInContext(
        "!Object.prototype.hasOwnProperty.call(navigator, 'webdriver') && 'webdriver' in navigator && navigator.webdriver === false",
        topContext,
      ),
    ).toBe(true);
    expect(
      vm.runInContext(
        "Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver').get.toString()",
        topContext,
      ),
    ).toBe("function get webdriver() { [native code] }");
    expect(vm.runInContext("window.outerWidth === 1280 && window.outerHeight === 985", topContext)).toBe(true);

    class WorkerWebGL {
      getParameter(pname: number) {
        if (pname === 37445) return "Google Inc. (Google)";
        if (pname === 37446) return "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
        return "WebGL";
      }
    }
    const workerCtx: Record<string, unknown> = {
      navigator: {
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
      },
      WebGLRenderingContext: WorkerWebGL,
    };
    workerCtx.self = workerCtx;

    vm.createContext(workerCtx);
    vm.runInContext(workerScript, workerCtx);
    vm.runInContext(workerScript, workerCtx);

    expect(
      vm.runInContext("WebGLRenderingContext.prototype.getParameter.toString()", workerCtx),
    ).toBe("function getParameter() { [native code] }");
    expect(
      vm.runInContext("new WebGLRenderingContext().getParameter(37445)", workerCtx),
    ).toBe("Google Inc. (AMD)");
    expect(
      vm.runInContext("new WebGLRenderingContext().getParameter(37446)", workerCtx),
    ).toContain("AMD Radeon 780M");
  });
});
