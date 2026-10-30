use std::collections::BTreeMap;
use std::path::Path;

use crate::session_changes::types::{
    CoverageReason, Presence, Provenance, MAX_METADATA_BYTES, MAX_METADATA_NODES,
    MAX_PATH_BYTES, MAX_PATH_DEPTH,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone)]
pub enum TrieNode {
    /// A directory whose children were inspected
    Directory {
        children_complete: bool,
        children: BTreeMap<String, TrieNode>,
    },
    /// A regular file recorded in the namespace
    File,
    /// An excluded/ignored entry or pruned subtree (e.g. .git, ignored dir, ignored file)
    ExcludedPrefix,
    /// Blocked / unproven node due to symlink, special file, or budget truncation
    Blocked,
}

#[derive(Debug, Clone)]
pub struct AbsenceTrie {
    pub root: TrieNode,
    pub total_nodes: usize,
    pub total_metadata_bytes: usize,
    pub proof_complete: bool,
    pub truncated: bool,
}

impl Default for AbsenceTrie {
    fn default() -> Self {
        Self {
            root: TrieNode::Directory {
                children_complete: true,
                children: BTreeMap::new(),
            },
            total_nodes: 1,
            total_metadata_bytes: std::mem::size_of::<TrieNode>(),
            proof_complete: true,
            truncated: false,
        }
    }
}

pub struct AbsenceProofResult {
    pub presence: Presence,
    pub provenance: Provenance,
    pub reason: Option<CoverageReason>,
}
pub fn can_add_node_budget(total_nodes: usize, total_metadata_bytes: usize, truncated: bool, name_len: usize) -> bool {
    if truncated {
        return false;
    }
    if total_nodes + 1 > MAX_METADATA_NODES {
        return false;
    }
    let est_bytes = std::mem::size_of::<TrieNode>() + name_len + 32;
    if total_metadata_bytes + est_bytes > MAX_METADATA_BYTES {
        return false;
    }
    true
}

impl AbsenceTrie {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn can_add_node(&self, name_len: usize) -> bool {
        can_add_node_budget(self.total_nodes, self.total_metadata_bytes, self.truncated, name_len)
    }
    /// Record a certified directory with its exact immediate child entries.
    /// `dir_path` is normalized relative to root (e.g. "" or "src" or "packages/ui").
    pub fn record_directory(
        &mut self,
        dir_path: &Path,
        complete: bool,
        entries: &[(String, EntryKind, bool /* is_ignored */)],
    ) {
        if self.truncated {
            self.proof_complete = false;
            return;
        }

        let components = dir_path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .filter(|s| !s.is_empty() && s != ".")
            .collect::<Vec<_>>();

        if components.len() > MAX_PATH_DEPTH {
            self.proof_complete = false;
            self.truncated = true;
            return;
        }

        // Navigate to the parent directory node in the trie
        let mut curr = &mut self.root;
        for comp in &components {
            match curr {
                TrieNode::Directory { children, .. } => {
                    if !children.contains_key(comp) {
                        if !can_add_node_budget(self.total_nodes, self.total_metadata_bytes, self.truncated, comp.len()) {
                            self.proof_complete = false;
                            self.truncated = true;
                            return;
                        }
                        self.total_nodes += 1;
                        self.total_metadata_bytes += std::mem::size_of::<TrieNode>() + comp.len() + 32;
                        children.insert(
                            comp.clone(),
                            TrieNode::Directory {
                                children_complete: false,
                                children: BTreeMap::new(),
                            },
                        );
                    }
                    curr = children.get_mut(comp).unwrap();
                }
                _ => {
                    // Encountered a non-directory along path
                    self.proof_complete = false;
                    return;
                }
            }
        }

        // Now populate `curr` as a directory node
        match curr {
            TrieNode::Directory {
                children_complete,
                children,
            } => {
                *children_complete = complete && !self.truncated;
                for (name, kind, is_ignored) in entries {
                    if self.truncated || !can_add_node_budget(self.total_nodes, self.total_metadata_bytes, self.truncated, name.len()) {
                        *children_complete = false;
                        self.proof_complete = false;
                        self.truncated = true;
                        break;
                    }
                    self.total_nodes += 1;
                    self.total_metadata_bytes += std::mem::size_of::<TrieNode>() + name.len() + 32;

                    let node = if *is_ignored {
                        TrieNode::ExcludedPrefix
                    } else {
                        match kind {
                            EntryKind::Dir => TrieNode::Directory {
                                children_complete: false,
                                children: BTreeMap::new(),
                            },
                            EntryKind::File => TrieNode::File,
                            EntryKind::Symlink | EntryKind::Other => TrieNode::Blocked,
                        }
                    };
                    children.insert(name.clone(), node);
                }
            }
            _ => {
                self.proof_complete = false;
            }
        }
    }

    /// Evaluate the historical presence of a current-only path against the baseline trie.
    pub fn prove_path(&self, relative_path: &Path) -> AbsenceProofResult {
        let path_str = relative_path.to_string_lossy();
        if path_str.len() > MAX_PATH_BYTES {
            return AbsenceProofResult {
                presence: Presence::Unknown,
                provenance: Provenance::Unproven,
                reason: Some(CoverageReason::PathLimit),
            };
        }

        let components = relative_path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .filter(|s| !s.is_empty() && s != ".")
            .collect::<Vec<_>>();

        if components.is_empty() || components.len() > MAX_PATH_DEPTH {
            return AbsenceProofResult {
                presence: Presence::Unknown,
                provenance: Provenance::Unproven,
                reason: Some(CoverageReason::AbsenceUnknown),
            };
        }

        let mut curr = &self.root;

        for (i, comp) in components.iter().enumerate() {
            match curr {
                TrieNode::Directory {
                    children_complete,
                    children,
                } => {
                    if let Some(child_node) = children.get(comp) {
                        match child_node {
                            TrieNode::ExcludedPrefix => {
                                // Explicitly ignored at capture
                                return AbsenceProofResult {
                                    presence: Presence::Unknown,
                                    provenance: Provenance::ExcludedAtCapture,
                                    reason: Some(CoverageReason::AbsenceUnknown),
                                };
                            }
                            TrieNode::Blocked => {
                                // Blocked ancestor (symlink, special file)
                                return AbsenceProofResult {
                                    presence: Presence::Unknown,
                                    provenance: Provenance::Unproven,
                                    reason: Some(CoverageReason::AbsenceUnknown),
                                };
                            }
                            TrieNode::File => {
                                if i == components.len() - 1 {
                                    // It was a file at capture!
                                    return AbsenceProofResult {
                                        presence: Presence::Present,
                                        provenance: Provenance::Captured,
                                        reason: None,
                                    };
                                } else {
                                    // File where directory expected
                                    return AbsenceProofResult {
                                        presence: Presence::Unknown,
                                        provenance: Provenance::Unproven,
                                        reason: Some(CoverageReason::AbsenceUnknown),
                                    };
                                }
                            }
                            TrieNode::Directory { .. } => {
                                if i == components.len() - 1 {
                                    // Path names a directory in the trie
                                    return AbsenceProofResult {
                                        presence: Presence::Present,
                                        provenance: Provenance::Captured,
                                        reason: None,
                                    };
                                }
                                curr = child_node;
                            }
                        }
                    } else {
                        // `comp` is NOT found in `children`.
                        // If this parent directory was certified complete, its absence here proves the whole path was absent!
                        if *children_complete {
                            return AbsenceProofResult {
                                presence: Presence::Absent,
                                provenance: Provenance::AbsentInVerifiedDirectory,
                                reason: None,
                            };
                        } else {
                            // Parent directory was not certified complete (e.g. truncated or permission issue)
                            return AbsenceProofResult {
                                presence: Presence::Unknown,
                                provenance: Provenance::Unproven,
                                reason: Some(CoverageReason::AbsenceUnknown),
                            };
                        }
                    }
                }
                TrieNode::ExcludedPrefix => {
                    return AbsenceProofResult {
                        presence: Presence::Unknown,
                        provenance: Provenance::ExcludedAtCapture,
                        reason: Some(CoverageReason::AbsenceUnknown),
                    };
                }
                _ => {
                    return AbsenceProofResult {
                        presence: Presence::Unknown,
                        provenance: Provenance::Unproven,
                        reason: Some(CoverageReason::AbsenceUnknown),
                    };
                }
            }
        }

        AbsenceProofResult {
            presence: Presence::Unknown,
            provenance: Provenance::Unproven,
            reason: Some(CoverageReason::AbsenceUnknown),
        }
    }
}
