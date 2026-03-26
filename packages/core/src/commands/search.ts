import type { CommandDefinition, SearchResult } from "./types.js";

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export interface IndexedDocument {
  command: CommandDefinition;
  projectType: string;
  termFreq: Map<string, number>;
  length: number;
}

export interface BM25Index {
  documents: IndexedDocument[];
  avgDocLength: number;
  idf: Map<string, number>;
  docCount: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function buildCorpus(cmd: CommandDefinition): string {
  return `${cmd.name} ${cmd.command} ${cmd.description} ${cmd.tags.join(" ")}`;
}

export function buildIndex(
  entries: Array<{ command: CommandDefinition; projectType: string }>,
): BM25Index {
  const documents: IndexedDocument[] = entries.map(({ command, projectType }) => {
    const tokens = tokenize(buildCorpus(command));
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }
    return { command, projectType, termFreq, length: tokens.length };
  });

  const docCount = documents.length;
  const totalLength = documents.reduce((sum, d) => sum + d.length, 0);
  const avgDocLength = docCount > 0 ? totalLength / docCount : 1;

  // Build document frequency per term
  const df = new Map<string, number>();
  for (const doc of documents) {
    for (const term of doc.termFreq.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1)
  const idf = new Map<string, number>();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((docCount - freq + 0.5) / (freq + 0.5) + 1));
  }

  return { documents, avgDocLength, idf, docCount };
}

export function searchIndex(
  index: BM25Index,
  query: string,
  limit = 10,
  filterProjectType?: string,
): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scores: Array<{ doc: IndexedDocument; score: number }> = [];

  for (const doc of index.documents) {
    if (filterProjectType && doc.projectType !== filterProjectType) continue;

    let score = 0;
    for (const term of queryTerms) {
      const idf = index.idf.get(term) ?? 0;
      const tf = doc.termFreq.get(term) ?? 0;
      const numerator = tf * (BM25_K1 + 1);
      const denominator =
        tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / index.avgDocLength));
      score += idf * (numerator / denominator);
    }

    if (score > 0) {
      scores.push({ doc, score });
    }
  }

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, score }) => ({
      command: doc.command,
      score,
      projectType: doc.projectType,
    }));
}
