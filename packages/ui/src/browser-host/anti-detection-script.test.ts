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

describe("ANTI_DETECTION_SCRIPT runtime stealth invariants", () => {
  it("masks patched functions and getters, is idempotent, and avoids own string keys on AudioNode.prototype", () => {
    const script = loadAntiDetectionScript();
    class FakeEventTarget {}
    class FakeNavigator {}
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

    const fakeNav = Object.create(FakeNavigator.prototype);
    fakeNav.userAgent =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36";
    fakeNav.mediaDevices = { enumerateDevices: async () => [] };

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
      MediaSource: { isTypeSupported: () => false },
      Notification: { permission: "denied" },
      navigator: fakeNav,
      innerWidth: 1280,
      innerHeight: 800,
      outerWidth: 0,
      outerHeight: 0,
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
  });
});
