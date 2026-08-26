import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SshForwardHostProvider } from "@/contexts/SshForwardHostContext.js";
import { TopNavRouteMenu } from "@/components/organisms/TopNavRouteMenu.js";
import type { SshForwardHost } from "@/lib/ssh-forward-host.js";
import "@/index.css";

const host = {} as SshForwardHost;
let container: HTMLDivElement;
let root: Root;

function renderHost(
  value: SshForwardHost | null,
  kind: "web" | "nativeDesktop" | "nativeMobile",
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return act(async () =>
    root.render(
      <BrowserRouter>
        <SshForwardHostProvider host={value} environment={{ kind }}>
          <TopNavRouteMenu
            collapsed={false}
            compactLabelClass="text-xs"
            compactTextClass="text-xs"
            isCompactWorkspace={false}
          />
        </SshForwardHostProvider>
      </BrowserRouter>,
    ),
  );
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
});

describe("SSH forwarding availability in Chromium", () => {
  it("keeps route navigation absent in browser and mobile contexts", async () => {
    await renderHost(null, "web");
    expect(document.body.textContent).not.toContain("SSH FORWARDS");
    await act(async () =>
      root.render(
        <BrowserRouter>
          <SshForwardHostProvider
            host={null}
            environment={{ kind: "nativeMobile" }}
          >
            <TopNavRouteMenu
              collapsed={false}
              compactLabelClass="text-xs"
              compactTextClass="text-xs"
              isCompactWorkspace={false}
            />
          </SshForwardHostProvider>
        </BrowserRouter>,
      ),
    );
    expect(document.body.textContent).not.toContain("SSH FORWARDS");
  });

  it("shows the entry only for the native desktop host", async () => {
    await renderHost(host, "nativeDesktop");
    expect(document.body.textContent).toContain("SSH FORWARDS");
    expect(document.querySelector('a[href="/ssh-forwarding"]')).not.toBeNull();
  });
});
