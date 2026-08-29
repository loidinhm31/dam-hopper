import { createRoot, type Root } from "react-dom/client";
import { DndContext } from "@dnd-kit/core";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraggableTab } from "@/components/organisms/TabBar.js";
import { TerminalTabBar } from "@/components/organisms/TerminalTabBar.js";
import { RuntimeActiveSessionTitle } from "@/components/organisms/ActiveTerminalRuntimeDisplay.js";
import { TerminalRuntimeNavigatorItem } from "@/components/organisms/TerminalRuntimeNavigatorItem.js";
import type { RuntimeSessionItem } from "@/lib/terminal-runtime-tree.js";
import { BrowserDebugTerminalTargetList } from "@/components/organisms/BrowserDebugTerminalTargetList.js";
import { TerminalTitleText } from "@/components/atoms/TerminalTitleText.js";
import type { BrowserTerminalTarget } from "@/lib/browser-terminal-handoff.js";
import { applyTerminalTitleOrdinals } from "@/lib/terminal-title.js";
import type { DisplayTabEntry } from "@/components/organisms/TerminalTabBar.js";
import "@/index.css";

const baseTabs = [
  { sessionId: "session-a", label: "Terminal (starting…)", project: "project-a" },
  { sessionId: "session-b", label: "Terminal (starting…)", project: "project-b" },
];
const displayTab: DisplayTabEntry = {
  sessionId: "session-a",
  label: "Terminal (starting…)",
  title: {
    baseLabel: "Terminal (starting…)",
    ordinal: 1,
    fullText: "Terminal (starting…) #1",
  },
};

const runtimeSession: RuntimeSessionItem = {
  kind: "session",
  id: "session:session-a",
  groupId: "free",
  sessionId: "session-a",
  label: displayTab.label,
  openTitle: displayTab.title,
  project: "demo",
  command: "bash",
  startedAt: 1,
  ports: [],
};

function TitleFixture() {
  const [first, second] = applyTerminalTitleOrdinals(baseTabs);
  return (
    <div style={{ width: 132, display: "flex" }}>
      <TerminalTitleText
        title={first!.title}
        className="min-w-0 flex-1"
        baseClassName="font-mono"
      />
      <TerminalTitleText
        title={second!.title}
        className="min-w-0 flex-1"
        baseClassName="font-mono"
      />
    </div>
  );
}
function ProjectOrdinalFixture() {
  const [tabs, setTabs] = useState([
    { sessionId: "project-a-1", label: "project-a:duplicate", project: "project-a" },
    { sessionId: "project-b-1", label: "project-b:duplicate", project: "project-b" },
    { sessionId: "project-a-2", label: "project-a:duplicate", project: "project-a" },
  ]);
  const projected = applyTerminalTitleOrdinals(tabs);
  return (
    <>
      <button
        data-testid="close-project-a-first"
        onClick={() =>
          setTabs((current) =>
            current.filter((tab) => tab.sessionId !== "project-a-1"),
          )
        }
      >
        Close project A first
      </button>
      <div data-testid="project-ordinal-titles">
        {projected.map((tab) => (
          <TerminalTitleText
            key={tab.sessionId}
            title={tab.title}
            className="min-w-0"
          />
        ))}
      </div>
    </>
  );
}

const HANDOFF_BASE = "A very long terminal command title for browser handoff";


function HandoffFixture() {
  const [open] = applyTerminalTitleOrdinals([
    { sessionId: "session-a", label: HANDOFF_BASE },
  ]);
  const targets: BrowserTerminalTarget[] = [
    {
      sessionId: "session-a",
      label: open!.title.fullText,
      openTitle: open!.title,
      mounted: true,
      registered: true,
      alive: true,
      current: true,
    },
    {
      sessionId: "mounted-only",
      label: "demo · pnpm dev",
      mounted: true,
      registered: true,
      alive: true,
      current: false,
    },
  ];
  return (
    <BrowserDebugTerminalTargetList
      disabled={false}
      selectedId={null}
      targets={targets}
      onSelect={() => undefined}
    />
  );
}
function ConsumerFixture() {
  const selectSession = vi.fn();
  return (
    <div style={{ width: 220 }}>
      <DndContext>
        <DraggableTab
          paneId="pane-1"
          tab={displayTab}
          isActive
          onSelect={selectSession}
          onClose={selectSession}
          onTogglePin={selectSession}
        />
      </DndContext>
      <TerminalTabBar
        tabs={[displayTab]}
        activeTab={displayTab.sessionId}
        onSelectTab={selectSession}
        onCloseTab={selectSession}
      />
      <RuntimeActiveSessionTitle
        activeSessionId={displayTab.sessionId}
        activeSessionTitle={displayTab.title}
      />
      <TerminalRuntimeNavigatorItem
        activeSessionId={displayTab.sessionId}
        dragState={null}
        item={runtimeSession}
        onMoveItem={() => undefined}
        onSetDragState={() => undefined}
        onStartTunnel={async () => undefined}
        onStopTunnel={async () => undefined}
      />
    </div>
  );
}

describe("terminal title ordinals in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    container.style.width = "180px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps both ordinal suffixes visible beside genuinely truncated bases", async () => {
    await act(async () => root.render(<TitleFixture />));
    const hosts = [...container.querySelectorAll<HTMLElement>("span.flex")];
    expect(hosts.length).toBeGreaterThanOrEqual(2);
    for (const host of hosts) {
      const visual = host.querySelectorAll<HTMLElement>("span[aria-hidden='true']");
      const base = visual[0];
      const suffix = visual[1];
      expect(host.querySelector(".sr-only")?.textContent).toMatch(/#\d/);
      expect(base?.scrollWidth).toBeGreaterThan(base?.clientWidth ?? 0);
      expect(suffix?.textContent).toMatch(/ #\d/);
      expect(suffix?.getBoundingClientRect().right).toBeLessThanOrEqual(
        host.getBoundingClientRect().right,
      );
    }
  });
  it("resets ordinals by project and recomputes after closing", async () => {
    await act(async () => root.render(<ProjectOrdinalFixture />));
    const titles = container.querySelector(
      '[data-testid="project-ordinal-titles"]',
    );
    expect(titles?.textContent).toContain("project-a:duplicate #1");
    expect(titles?.textContent).toContain("project-b:duplicate #1");
    expect(titles?.textContent).toContain("project-a:duplicate #2");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="close-project-a-first"]',
        )
        ?.click();
    });
    expect(
      [...titles!.querySelectorAll<HTMLElement>(".sr-only")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["project-b:duplicate #1", "project-a:duplicate #1"]);
  });
  it("mounts split, legacy, runtime, and active title consumers", async () => {
    await act(async () => root.render(<ConsumerFixture />));
    expect(container.textContent).toContain("Terminal (starting…) #1");
    expect(container.querySelectorAll(".sr-only").length).toBeGreaterThanOrEqual(4);
    expect(
      container.querySelector('button[aria-label="Pin terminal"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Close terminal"]'),
    ).not.toBeNull();
  });

  it("keeps open handoff titles structured and mounted-only labels readable", async () => {
    await act(async () => root.render(<HandoffFixture />));
    expect(container.textContent).toContain(`${HANDOFF_BASE} #1`);
    expect(container.textContent).toContain("demo · pnpm dev");
    expect(container.textContent).not.toContain("mounted-only");
    expect(container.textContent).toContain("Ready");
    expect(container.querySelectorAll(".sr-only")).toHaveLength(1);
  });

  it("keeps the handoff suffix visible above the current marker", async () => {
    await act(async () => root.render(<HandoffFixture />));
    const row = container
      .querySelector<HTMLInputElement>("#browser-terminal-session-a")
      ?.closest("label");
    const visuals = row?.querySelectorAll<HTMLElement>(
      "span[aria-hidden='true']",
    );
    const base = visuals?.[0];
    const suffix = visuals?.[1];
    const marker = row?.querySelector<HTMLElement>(
      "span.min-w-0.truncate:not([aria-hidden='true'])",
    );
    expect(base?.scrollWidth).toBeGreaterThan(base?.clientWidth ?? 0);
    expect(suffix?.getBoundingClientRect().right).toBeLessThanOrEqual(
      row?.getBoundingClientRect().right ?? 0,
    );
    expect(row?.scrollWidth).toBeLessThanOrEqual(row?.clientWidth ?? 0);
    expect(marker?.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      suffix?.getBoundingClientRect().bottom ?? 0,
    );
  });

});
