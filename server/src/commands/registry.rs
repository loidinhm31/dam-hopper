use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use super::presets::{CommandDefinition, load_all_databases};

const BM25_K1: f64 = 1.2;
const BM25_B: f64 = 0.75;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub command: SearchResultCommand,
    pub score: f64,
    pub project_type: String,
}

/// Flattened command for serialization (avoids re-exporting internal type).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultCommand {
    pub name: String,
    pub command: String,
    pub description: String,
    pub tags: Vec<String>,
}

impl From<&CommandDefinition> for SearchResultCommand {
    fn from(c: &CommandDefinition) -> Self {
        Self {
            name: c.name.clone(),
            command: c.command.clone(),
            description: c.description.clone(),
            tags: c.tags.clone(),
        }
    }
}

struct IndexedDocument {
    command: CommandDefinition,
    project_type: String,
    term_freq: HashMap<String, usize>,
    length: usize,
}

pub struct BM25Index {
    documents: Vec<IndexedDocument>,
    avg_doc_length: f64,
    idf: HashMap<String, f64>,
}

pub struct CommandRegistry {
    index: BM25Index,
    by_type: HashMap<String, Vec<CommandDefinition>>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        let databases = load_all_databases();
        let mut by_type: HashMap<String, Vec<CommandDefinition>> = HashMap::new();
        let mut all_entries: Vec<(CommandDefinition, String)> = Vec::new();

        for db in databases {
            by_type.insert(db.project_type.clone(), db.commands.clone());
            for cmd in db.commands {
                all_entries.push((cmd, db.project_type.clone()));
            }
        }

        let index = build_index(all_entries);

        Self { index, by_type }
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchResult> {
        search_index(&self.index, query, limit, None)
    }

    pub fn search_by_type(&self, query: &str, project_type: &str, limit: usize) -> Vec<SearchResult> {
        search_index(&self.index, query, limit, Some(project_type))
    }

    pub fn get_commands(&self, project_type: &str) -> &[CommandDefinition] {
        self.by_type.get(project_type).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn all_project_types(&self) -> Vec<&str> {
        self.by_type.keys().map(|s| s.as_str()).collect()
    }
}

impl Default for CommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() >= 2)
        .map(String::from)
        .collect()
}

fn build_corpus(cmd: &CommandDefinition) -> String {
    format!("{} {} {} {}", cmd.name, cmd.command, cmd.description, cmd.tags.join(" "))
}

fn build_index(entries: Vec<(CommandDefinition, String)>) -> BM25Index {
    let documents: Vec<IndexedDocument> = entries
        .into_iter()
        .map(|(cmd, project_type)| {
            let tokens = tokenize(&build_corpus(&cmd));
            let mut term_freq: HashMap<String, usize> = HashMap::new();
            for token in &tokens {
                *term_freq.entry(token.clone()).or_insert(0) += 1;
            }
            let length = tokens.len();
            IndexedDocument { command: cmd, project_type, term_freq, length }
        })
        .collect();

    let doc_count = documents.len();
    let total_length: usize = documents.iter().map(|d| d.length).sum();
    let avg_doc_length = if doc_count > 0 { total_length as f64 / doc_count as f64 } else { 1.0 };

    let mut df: HashMap<String, usize> = HashMap::new();
    for doc in &documents {
        for term in doc.term_freq.keys() {
            *df.entry(term.clone()).or_insert(0) += 1;
        }
    }

    let mut idf: HashMap<String, f64> = HashMap::new();
    for (term, freq) in &df {
        let score = ((doc_count as f64 - *freq as f64 + 0.5) / (*freq as f64 + 0.5) + 1.0).ln();
        idf.insert(term.clone(), score);
    }

    BM25Index { documents, avg_doc_length, idf }
}

fn search_index(
    index: &BM25Index,
    query: &str,
    limit: usize,
    filter_project_type: Option<&str>,
) -> Vec<SearchResult> {
    let query_terms = tokenize(query);
    if query_terms.is_empty() {
        return vec![];
    }

    let mut scores: Vec<(f64, usize)> = Vec::new();

    for (i, doc) in index.documents.iter().enumerate() {
        if let Some(pt) = filter_project_type {
            if doc.project_type != pt {
                continue;
            }
        }

        let mut score = 0.0f64;
        for term in &query_terms {
            let idf = index.idf.get(term).copied().unwrap_or(0.0);
            let tf = doc.term_freq.get(term).copied().unwrap_or(0) as f64;
            let numerator = tf * (BM25_K1 + 1.0);
            let denominator = tf + BM25_K1 * (1.0 - BM25_B + BM25_B * (doc.length as f64 / index.avg_doc_length));
            score += idf * (numerator / denominator);
        }

        if score > 0.0 {
            scores.push((score, i));
        }
    }

    scores.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scores.truncate(limit);

    scores
        .into_iter()
        .map(|(score, i)| {
            let doc = &index.documents[i];
            SearchResult {
                command: SearchResultCommand::from(&doc.command),
                score,
                project_type: doc.project_type.clone(),
            }
        })
        .collect()
}
