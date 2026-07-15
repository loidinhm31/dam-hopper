import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";

export const TERMINAL_FIND_STATUS = {
  EMPTY: "empty",
  MATCHES: "matches",
  NO_MATCH: "no-match",
} as const;

export type TerminalFindStatus =
  (typeof TERMINAL_FIND_STATUS)[keyof typeof TERMINAL_FIND_STATUS];

export interface TerminalFindSnapshot {
  isOpen: boolean;
  query: string;
  resultIndex: number;
  resultCount: number;
  status: TerminalFindStatus;
}

type TerminalFindListener = () => void;
type SearchAddonApi = Pick<
  SearchAddon,
  "findNext" | "findPrevious" | "clearDecorations" | "onDidChangeResults"
>;

const SEARCH_OPTIONS: ISearchOptions = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  incremental: false,
  decorations: {
    matchBackground: "#334155",
    matchBorder: "#64748b",
    matchOverviewRuler: "#64748b",
    activeMatchBackground: "#60a5fa",
    activeMatchBorder: "#bfdbfe",
    activeMatchColorOverviewRuler: "#60a5fa",
  },
};

const EMPTY_SNAPSHOT: TerminalFindSnapshot = {
  isOpen: false,
  query: "",
  resultIndex: 0,
  resultCount: 0,
  status: TERMINAL_FIND_STATUS.EMPTY,
};

export class TerminalFindController {
  private snapshot: TerminalFindSnapshot = { ...EMPTY_SNAPSHOT };
  private readonly listeners = new Set<TerminalFindListener>();
  private readonly resultSubscription: { dispose: () => void };
  private disposed = false;

  public constructor(private readonly searchAddon: SearchAddonApi) {
    this.resultSubscription = searchAddon.onDidChangeResults(
      (event: ISearchResultChangeEvent) => this.handleResults(event),
    );
  }

  public open(): void {
    if (this.disposed || this.snapshot.isOpen) return;
    this.update({ isOpen: true });
  }

  public close(): void {
    if (this.disposed || !this.snapshot.isOpen) return;

    this.searchAddon.clearDecorations();
    this.update({ ...EMPTY_SNAPSHOT });
  }

  public setQuery(query: string): void {
    if (this.disposed || !this.snapshot.isOpen) return;

    if (query.length === 0) {
      this.searchAddon.clearDecorations();
      this.update({
        query: "",
        resultIndex: 0,
        resultCount: 0,
        status: TERMINAL_FIND_STATUS.EMPTY,
      });
      return;
    }

    this.update({
      query,
      resultIndex: 0,
      resultCount: 0,
      status: TERMINAL_FIND_STATUS.NO_MATCH,
    });
    this.searchAddon.findNext(query, SEARCH_OPTIONS);
  }

  public findNext(): void {
    if (this.disposed || !this.snapshot.isOpen || !this.snapshot.query) return;
    this.searchAddon.findNext(this.snapshot.query, SEARCH_OPTIONS);
  }

  public findPrevious(): void {
    if (this.disposed || !this.snapshot.isOpen || !this.snapshot.query) return;
    this.searchAddon.findPrevious(this.snapshot.query, SEARCH_OPTIONS);
  }

  public getSnapshot(): TerminalFindSnapshot {
    return { ...this.snapshot };
  }

  public subscribe(listener: TerminalFindListener): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resultSubscription.dispose();
    this.searchAddon.clearDecorations();
    this.snapshot = { ...EMPTY_SNAPSHOT };
    this.listeners.forEach((listener) => listener());
    this.listeners.clear();
  }

  private handleResults(event: ISearchResultChangeEvent): void {
    if (this.disposed || !this.snapshot.query) return;

    this.update({
      resultIndex: event.resultIndex >= 0 ? event.resultIndex + 1 : 0,
      resultCount: event.resultCount,
      status:
        event.resultCount > 0
          ? TERMINAL_FIND_STATUS.MATCHES
          : TERMINAL_FIND_STATUS.NO_MATCH,
    });
  }

  private update(changes: Partial<TerminalFindSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener());
  }
}
