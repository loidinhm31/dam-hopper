import { useMemo, useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button } from "@/components/atoms/Button.js";
import { StoreInventory } from "@/components/agent-store/StoreInventory.js";
import { ItemDetail } from "@/components/agent-store/ItemDetail.js";
import { DistributionMatrix } from "@/components/agent-store/DistributionMatrix.js";
import { ShipDialog } from "@/components/agent-store/ShipDialog.js";
import { HealthStatus } from "@/components/agent-store/HealthStatus.js";
import { MemoryEditor } from "@/components/agent-store/MemoryEditor.js";
import { ImportFromRepoDialog } from "@/components/agent-store/ImportFromRepoDialog.js";
import {
  useAgentStoreItems,
  useAgentStoreMatrix,
  useAddToStore,
  useProjects,
} from "@/api/queries.js";
import type { AgentStoreItem } from "@/api/client.js";

type Tab = "store" | "memory" | "import";

export function AgentStorePage() {
  const { data: items = [], isLoading, isError: itemsError } = useAgentStoreItems();
  const { data: matrix = {}, isError: matrixError } = useAgentStoreMatrix();
  const { data: projects = [], isError: projectsError } = useProjects();
  const addToStore = useAddToStore();

  const [activeTab, setActiveTab] = useState<Tab>("store");
  const [selectedItem, setSelectedItem] = useState<AgentStoreItem | null>(null);
  const [showShipDialog, setShowShipDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);

  const shipCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [itemKey, projectMap] of Object.entries(matrix)) {
      counts[itemKey] = Object.values(projectMap).filter((v) => v.shipped).length;
    }
    return counts;
  }, [matrix]);

  const hasError = itemsError || matrixError || projectsError;

  return (
    <AppLayout title="Agent Store">
      <div className="flex flex-col gap-4">
        {/* Tab bar + action */}
        <div className="flex items-center gap-4">
          <div className="flex rounded border border-[var(--color-border)] overflow-hidden">
            {(["store", "memory", "import"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  "px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer capitalize",
                  activeTab === tab
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]",
                ].join(" ")}
              >
                {tab === "store" ? "Store" : tab === "memory" ? "Memory Files" : "Import"}
              </button>
            ))}
          </div>

          <div className="flex-1">
            {activeTab === "store" && <HealthStatus />}
          </div>

          {activeTab === "store" && (
            <Button
              variant="primary"
              size="sm"
              loading={addToStore.isPending}
              onClick={() => addToStore.mutate({ category: "skill" })}
            >
              + Add
            </Button>
          )}
          {activeTab === "import" && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowImportDialog(true)}
            >
              Import from Repo
            </Button>
          )}
        </div>

        {hasError && activeTab === "store" && (
          <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-3 text-xs text-[var(--color-danger)]">
            Failed to load agent store data. Check that the workspace has a valid agent store configured.
          </div>
        )}

        {/* ── Store tab ────────────────────────────────────────────────── */}
        {activeTab === "store" && (
          <>
            <div className="flex gap-4" style={{ minHeight: 0, height: "clamp(360px, 45vh, 520px)" }}>
              <div className="w-64 shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden flex flex-col">
                <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
                  <p className="text-[10px] font-bold text-[var(--color-primary)] tracking-widest uppercase opacity-70">
                    Central Store
                  </p>
                </div>
                {isLoading ? (
                  <div className="flex items-center justify-center flex-1">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
                  </div>
                ) : (
                  <StoreInventory
                    items={items}
                    selectedItem={selectedItem}
                    shipCounts={shipCounts}
                    onSelect={setSelectedItem}
                  />
                )}
              </div>

              <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden flex flex-col">
                {selectedItem ? (
                  <ItemDetail item={selectedItem} onShip={() => setShowShipDialog(true)} />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-muted)]">
                    Select an item to preview
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <p className="text-[10px] font-bold text-[var(--color-primary)] tracking-widest uppercase opacity-70 mb-3">
                Distribution Matrix
              </p>
              <DistributionMatrix items={items} projects={projects} matrix={matrix} />
            </div>
          </>
        )}

        {/* ── Memory tab ───────────────────────────────────────────────── */}
        {activeTab === "memory" && (
          <div
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col"
            style={{ height: "clamp(400px, 60vh, 640px)" }}
          >
            <MemoryEditor projects={projects} />
          </div>
        )}

        {/* ── Import tab ───────────────────────────────────────────────── */}
        {activeTab === "import" && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p className="text-xs text-[var(--color-text-muted)]">
              Import skills and commands from a public git repository into the central store.
              Click <strong>Import from Repo</strong> above to get started.
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              The repository will be shallow-cloned, scanned for SKILL.md directories and command
              markdown files, and you&apos;ll be able to select which items to add to the store.
            </p>
          </div>
        )}
      </div>

      {showShipDialog && selectedItem && (
        <ShipDialog
          item={selectedItem}
          projects={projects}
          onClose={() => setShowShipDialog(false)}
        />
      )}

      {showImportDialog && (
        <ImportFromRepoDialog onClose={() => setShowImportDialog(false)} />
      )}
    </AppLayout>
  );
}
