import type { UsageSessionDetail, UsageSessionPage } from "@/api/client.js";
import { Button } from "@/components/atoms/Button.js";
import {
  UsageSessionList,
  type UsageSessionViewState,
} from "./UsageSessionList.js";
import { UsageSessionTree } from "./UsageSessionTree.js";

export interface UsageSessionAuditProps {
  page?: UsageSessionPage;
  detail?: UsageSessionDetail;
  selectedSessionId: string | null;
  cursorActive: boolean;
  listState: UsageSessionViewState;
  treeState: UsageSessionViewState;
  listError: string;
  detailError: string;
  onSelectSession: (id: string) => void;
  onNextPage: () => void;
  onFirstPage: () => void;
}

export function UsageSessionAudit({
  page,
  detail,
  selectedSessionId,
  cursorActive,
  listState,
  treeState,
  listError,
  detailError,
  onSelectSession,
  onNextPage,
  onFirstPage,
}: UsageSessionAuditProps) {
  return (
    <section
      id="usage-sessions-panel"
      role="tabpanel"
      aria-labelledby="usage-sessions-tab"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div>
          <h2 className="text-xs font-semibold text-[var(--color-text)]">
            Session model audit
          </h2>
          <p className="mt-1 text-[10px] leading-4 text-[var(--color-text-muted)]">
            Factual Codex model and token summaries only. Raw event content is
            never displayed.
          </p>
        </div>
        {cursorActive ? (
          <Button variant="ghost" size="sm" onClick={onFirstPage}>
            First page
          </Button>
        ) : null}
      </div>
      {page?.paused ? (
        <p role="status" className="text-xs text-[var(--color-text-muted)]">
          Collection is paused. Stored session summaries remain available.
        </p>
      ) : null}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
        <UsageSessionList
          sessions={page?.sessions ?? []}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          state={listState}
          errorMessage={listError}
          nextCursor={page?.nextCursor}
          onLoadMore={onNextPage}
        />
        {selectedSessionId ? (
          <UsageSessionTree
            detail={detail}
            state={treeState}
            errorMessage={detailError}
          />
        ) : (
          <div className="rounded border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]">
            Select a session to inspect its token and model summaries.
          </div>
        )}
      </div>
    </section>
  );
}
