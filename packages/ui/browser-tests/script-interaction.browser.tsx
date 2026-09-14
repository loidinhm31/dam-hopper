import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlPreview } from "@/components/organisms/HtmlPreview.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("comprehensive script interaction in HtmlPreview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(content: string) {
    await act(async () => root.render(<HtmlPreview content={content} debounceMs={0} />));
  }

  it("executes interactive counter script with DOM manipulation", async () => {
    let result = "";
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data === "string" && e.data.startsWith("counter-")) {
        result = e.data;
      }
    };
    window.addEventListener("message", onMessage);

    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <h1 id="count">0</h1>
          <button id="inc-btn" onclick="inc()">Increment</button>
          <script>
            let c = 0;
            function inc() {
              c++;
              document.getElementById('count').textContent = String(c);
              window.parent.postMessage('counter-' + c, '*');
            }
            inc();
          </script>
        </body>
      </html>
    `;

    await render(html);
    await vi.waitFor(() => expect(result).toBe("counter-1"), { timeout: 3000 });
    window.removeEventListener("message", onMessage);
  });

  it("submits forms without being blocked by sandbox allow-forms", async () => {
    let formSubmitted = false;
    const onMessage = (e: MessageEvent) => {
      if (e.data === "form-submitted") formSubmitted = true;
    };
    window.addEventListener("message", onMessage);

    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <form onsubmit="event.preventDefault(); window.parent.postMessage('form-submitted', '*');">
            <input type="text" name="name" value="test" />
            <button id="submit-btn" type="submit">Submit</button>
          </form>
          <script>
            document.getElementById('submit-btn').click();
          </script>
        </body>
      </html>
    `;

    await render(html);
    await vi.waitFor(() => expect(formSubmitted).toBe(true), { timeout: 3000 });
    window.removeEventListener("message", onMessage);
  });

  it("allows scripts to use localStorage via in-memory storage shim without SecurityError", async () => {
    let storageOutcome = "";
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data === "string" && e.data.startsWith("storage-")) {
        storageOutcome = e.data;
      }
    };
    window.addEventListener("message", onMessage);

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Storage Test</title>
        </head>
        <body>
          <script>
            try {
              localStorage.setItem('myKey', 'persistedVal');
              const readBack = localStorage.getItem('myKey');
              window.parent.postMessage('storage-success:' + readBack, '*');
            } catch (err) {
              window.parent.postMessage('storage-error:' + err.message, '*');
            }
          </script>
        </body>
      </html>
    `;

    await render(html);
    await vi.waitFor(
      () => expect(storageOutcome).toBe("storage-success:persistedVal"),
      { timeout: 3000 },
    );
    window.removeEventListener("message", onMessage);
  });

  it("renders in-frame visual alert modal for window.alert calls", async () => {
    let alertCreated = false;
    const onMessage = (e: MessageEvent) => {
      if (e.data === "alert-rendered") alertCreated = true;
    };
    window.addEventListener("message", onMessage);

    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <script>
            alert('Hello world from preview!');
            // Check if visual dialog was added to DOM
            setTimeout(() => {
              const dialog = document.getElementById('__dh_preview_alert');
              if (dialog && dialog.textContent.includes('Hello world from preview!')) {
                window.parent.postMessage('alert-rendered', '*');
              }
            }, 50);
          </script>
        </body>
      </html>
    `;

    await render(html);
    await vi.waitFor(() => expect(alertCreated).toBe(true), { timeout: 3000 });
    window.removeEventListener("message", onMessage);
  });
});
