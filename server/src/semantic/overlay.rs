//! Authoritative in-memory document overlay, UTF-16 position mapping,
//! atomic edit application, byte accounting, and adaptive sync derivation.

use std::collections::HashMap;
use thiserror::Error;

use super::protocol::{Position, Range, TextDocumentContentChangeEvent};
use super::resources::{
    ResourceLimitError, ResourcePolicy, ADAPTIVE_SYNC_THRESHOLD_BYTES,
    MAX_OPEN_DOCUMENTS_PER_SESSION, MAX_SESSION_OVERLAY_BYTES,
};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OverlayError {
    #[error("Document not found: {0}")]
    DocumentNotFound(String),

    #[error("Document already open: {0}")]
    DocumentAlreadyOpen(String),

    #[error("Invalid position at line {line}, character {character}: {reason}")]
    InvalidPosition {
        line: u32,
        character: u32,
        reason: String,
    },

    #[error("Invalid range: start position ({start_line}:{start_char}) is after end position ({end_line}:{end_char})")]
    InvalidRange {
        start_line: u32,
        start_char: u32,
        end_line: u32,
        end_char: u32,
    },

    #[error("Non-monotonic version: current version is {current}, received {received}")]
    NonMonotonicVersion { current: i64, received: i64 },

    #[error("Resource limit exceeded: {0}")]
    ResourceLimit(#[from] ResourceLimitError),
}

/// Borrowed line span representing a single line in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineSpan<'a> {
    /// 0-based line index.
    pub line_number: u32,
    /// 0-based byte offset where this line starts in the original text.
    pub start_byte: usize,
    /// Borrowed content of this line, strictly excluding line terminators (\r\n, \n, or \r).
    pub content: &'a str,
    /// Length in bytes of the line separator (0 for last line without trailing newline, 1 for \n or \r, 2 for \r\n).
    pub separator_len: usize,
}

/// Lossless borrowed line span iterator that recognizes CRLF, LF, and lone CR,
/// and properly preserves trailing empty lines without per-line allocations or text mutation.
pub struct LosslessLineSpans<'a> {
    remaining: &'a str,
    current_byte_offset: usize,
    current_line: u32,
    done: bool,
}

impl<'a> Iterator for LosslessLineSpans<'a> {
    type Item = LineSpan<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }

        let bytes = self.remaining.as_bytes();
        let mut idx = 0;
        while idx < bytes.len() {
            let b = bytes[idx];
            if b == b'\r' {
                let content = &self.remaining[..idx];
                let is_crlf = idx + 1 < bytes.len() && bytes[idx + 1] == b'\n';
                let sep_len = if is_crlf { 2 } else { 1 };
                let span = LineSpan {
                    line_number: self.current_line,
                    start_byte: self.current_byte_offset,
                    content,
                    separator_len: sep_len,
                };
                self.current_line = self.current_line.saturating_add(1);
                self.current_byte_offset += idx + sep_len;
                self.remaining = &self.remaining[idx + sep_len..];
                return Some(span);
            } else if b == b'\n' {
                let content = &self.remaining[..idx];
                let span = LineSpan {
                    line_number: self.current_line,
                    start_byte: self.current_byte_offset,
                    content,
                    separator_len: 1,
                };
                self.current_line = self.current_line.saturating_add(1);
                self.current_byte_offset += idx + 1;
                self.remaining = &self.remaining[idx + 1..];
                return Some(span);
            }
            idx += 1;
        }

        let content = self.remaining;
        let span = LineSpan {
            line_number: self.current_line,
            start_byte: self.current_byte_offset,
            content,
            separator_len: 0,
        };
        self.done = true;
        self.current_byte_offset += content.len();
        self.remaining = "";
        Some(span)
    }
}

/// Returns a zero-allocation iterator over borrowed line spans in `text`.
pub fn lossless_line_spans<'a>(text: &'a str) -> LosslessLineSpans<'a> {
    LosslessLineSpans {
        remaining: text,
        current_byte_offset: 0,
        current_line: 0,
        done: false,
    }
}

/// Computes byte offset within a UTF-8 text given a 0-based line and UTF-16 character code unit offset.
pub fn position_to_byte_offset(text: &str, pos: Position) -> Result<usize, OverlayError> {
    let mut total_lines: u32 = 0;
    for span in lossless_line_spans(text) {
        total_lines = span.line_number + 1;
        if span.line_number == pos.line {
            let mut utf16_count: u32 = 0;
            let mut char_byte_offset: usize = 0;

            for ch in span.content.chars() {
                if utf16_count == pos.character {
                    return Ok(span.start_byte + char_byte_offset);
                }
                if utf16_count > pos.character {
                    return Err(OverlayError::InvalidPosition {
                        line: pos.line,
                        character: pos.character,
                        reason: "Position splits a UTF-16 surrogate pair".into(),
                    });
                }
                utf16_count += ch.len_utf16() as u32;
                char_byte_offset += ch.len_utf8();
            }

            if utf16_count == pos.character {
                return Ok(span.start_byte + char_byte_offset);
            }

            return Err(OverlayError::InvalidPosition {
                line: pos.line,
                character: pos.character,
                reason: format!(
                    "Character offset {} exceeds line length {}",
                    pos.character, utf16_count
                ),
            });
        }
    }

    Err(OverlayError::InvalidPosition {
        line: pos.line,
        character: pos.character,
        reason: format!(
            "Line {} exceeds total document lines ({})",
            pos.line, total_lines
        ),
    })
}

/// Single tracked unsaved document overlay.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverlayDocument {
    pub uri: String,
    pub language_id: String,
    pub open_incarnation: u64,
    pub version: i64,
    pub text: String,
    pub byte_len: usize,
}

impl OverlayDocument {
    /// Create a new document overlay, validating initial document size limit.
    pub fn new(
        uri: String,
        language_id: String,
        open_incarnation: u64,
        version: i64,
        text: String,
    ) -> Result<Self, OverlayError> {
        let byte_len = text.len();
        ResourcePolicy::validate_document_size(byte_len)?;

        Ok(Self {
            uri,
            language_id,
            open_incarnation,
            version,
            text,
            byte_len,
        })
    }

    /// Apply a full range-less replacement to the document.
    pub fn apply_full_replacement(
        &mut self,
        new_version: i64,
        new_text: String,
    ) -> Result<(), OverlayError> {
        if new_version <= self.version {
            return Err(OverlayError::NonMonotonicVersion {
                current: self.version,
                received: new_version,
            });
        }
        self.apply_full_replacement_internal(new_text)?;
        self.version = new_version;
        Ok(())
    }

    pub fn apply_full_replacement_internal(
        &mut self,
        new_text: String,
    ) -> Result<(), OverlayError> {
        let new_byte_len = new_text.len();
        ResourcePolicy::validate_document_size(new_byte_len)?;

        self.text = new_text;
        self.byte_len = new_byte_len;

        Ok(())
    }

    /// Apply a single ranged edit to the document.
    pub fn apply_ranged_edit(
        &mut self,
        new_version: i64,
        range: Range,
        replacement: &str,
    ) -> Result<(), OverlayError> {
        if new_version <= self.version {
            return Err(OverlayError::NonMonotonicVersion {
                current: self.version,
                received: new_version,
            });
        }
        self.apply_ranged_edit_internal(range, replacement)?;
        self.version = new_version;
        Ok(())
    }

    pub fn apply_ranged_edit_internal(
        &mut self,
        range: Range,
        replacement: &str,
    ) -> Result<(), OverlayError> {
        let start_byte = position_to_byte_offset(&self.text, range.start)?;
        let end_byte = position_to_byte_offset(&self.text, range.end)?;

        if start_byte > end_byte {
            return Err(OverlayError::InvalidRange {
                start_line: range.start.line,
                start_char: range.start.character,
                end_line: range.end.line,
                end_char: range.end.character,
            });
        }

        let new_byte_len = self.byte_len - (end_byte - start_byte) + replacement.len();
        ResourcePolicy::validate_document_size(new_byte_len)?;

        self.text.replace_range(start_byte..end_byte, replacement);
        self.byte_len = new_byte_len;

        Ok(())
    }
    /// Check if post-edit full-text size recommends incremental or full sync.
    pub fn is_incremental_sync_recommended(&self) -> bool {
        self.byte_len >= ADAPTIVE_SYNC_THRESHOLD_BYTES
    }
}

/// Tracks memory byte budget for all overlays inside a semantic session.
#[derive(Debug, Default)]
pub struct SessionOverlayMap {
    documents: HashMap<String, OverlayDocument>,
    total_overlay_bytes: usize,
    open_incarnation_counter: u64,
}

impl SessionOverlayMap {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn total_bytes(&self) -> usize {
        self.total_overlay_bytes
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    pub fn get(&self, uri: &str) -> Option<&OverlayDocument> {
        self.documents.get(uri)
    }

    pub fn get_mut(&mut self, uri: &str) -> Option<&mut OverlayDocument> {
        self.documents.get_mut(uri)
    }

    /// Open a new document overlay, enforcing document count and session byte limits.
    pub fn open_document(
        &mut self,
        uri: String,
        language_id: String,
        version: i64,
        text: String,
    ) -> Result<u64, OverlayError> {
        if self.documents.contains_key(&uri) {
            return Err(OverlayError::DocumentAlreadyOpen(uri));
        }

        if self.documents.len() >= MAX_OPEN_DOCUMENTS_PER_SESSION {
            return Err(OverlayError::ResourceLimit(
                ResourceLimitError::TooManyDocuments {
                    count: self.documents.len() + 1,
                    max: MAX_OPEN_DOCUMENTS_PER_SESSION,
                },
            ));
        }

        let new_bytes = text.len();
        if self.total_overlay_bytes + new_bytes > MAX_SESSION_OVERLAY_BYTES {
            return Err(OverlayError::ResourceLimit(
                ResourceLimitError::SessionOverlayExceeded {
                    bytes: self.total_overlay_bytes + new_bytes,
                    max: MAX_SESSION_OVERLAY_BYTES,
                },
            ));
        }

        self.open_incarnation_counter += 1;
        let incarnation = self.open_incarnation_counter;

        let doc = OverlayDocument::new(uri.clone(), language_id, incarnation, version, text)?;
        self.total_overlay_bytes += new_bytes;
        self.documents.insert(uri, doc);

        Ok(incarnation)
    }

    /// Apply an atomic batch of content changes to an existing document overlay.
    /// Ensures that if any edit in the batch fails, the previous document state is preserved.
    pub fn apply_changes(
        &mut self,
        uri: &str,
        new_version: i64,
        changes: &[TextDocumentContentChangeEvent],
    ) -> Result<bool, OverlayError> {
        let doc = self
            .documents
            .get(uri)
            .ok_or_else(|| OverlayError::DocumentNotFound(uri.to_string()))?;
        if new_version <= doc.version {
            return Err(OverlayError::NonMonotonicVersion {
                current: doc.version,
                received: new_version,
            });
        }

        let old_doc_bytes = doc.byte_len;

        // Clone document to perform speculative atomic mutation
        let mut speculative_doc = doc.clone();

        for change in changes {
            if let Some(range) = change.range {
                speculative_doc.apply_ranged_edit_internal(range, &change.text)?;
            } else {
                speculative_doc.apply_full_replacement_internal(change.text.clone())?;
            }
        }
        speculative_doc.version = new_version;
        let new_doc_bytes = speculative_doc.byte_len;
        let new_total_bytes = self.total_overlay_bytes - old_doc_bytes + new_doc_bytes;

        if new_total_bytes > MAX_SESSION_OVERLAY_BYTES {
            return Err(OverlayError::ResourceLimit(
                ResourceLimitError::SessionOverlayExceeded {
                    bytes: new_total_bytes,
                    max: MAX_SESSION_OVERLAY_BYTES,
                },
            ));
        }

        let is_incremental = speculative_doc.is_incremental_sync_recommended();

        // Commit atomically
        self.total_overlay_bytes = new_total_bytes;
        self.documents.insert(uri.to_string(), speculative_doc);

        Ok(is_incremental)
    }

    /// Close a document overlay, releasing its allocated byte budget.
    pub fn close_document(&mut self, uri: &str) -> Option<OverlayDocument> {
        if let Some(removed) = self.documents.remove(uri) {
            self.total_overlay_bytes = self.total_overlay_bytes.saturating_sub(removed.byte_len);
            Some(removed)
        } else {
            None
        }
    }

    /// Replay helper: returns all open documents for full resync on child restart.
    pub fn all_documents(&self) -> Vec<OverlayDocument> {
        self.documents.values().cloned().collect()
    }
    /// Returns sorted document URIs in FIFO open order without cloning document texts.
    pub fn ordered_document_uris(&self) -> Vec<String> {
        let mut entries: Vec<(&String, u64)> = self
            .documents
            .iter()
            .map(|(uri, doc)| (uri, doc.open_incarnation))
            .collect();
        entries.sort_by_key(|&(_, inc)| inc);
        entries.into_iter().map(|(uri, _)| uri.clone()).collect()
    }
    /// Version-only snapshot of all currently open overlays avoiding text cloning.
    pub fn document_versions_snapshot(&self) -> HashMap<String, i64> {
        self.documents
            .iter()
            .map(|(uri, doc)| (uri.clone(), doc.version))
            .collect()
    }

    /// Clear all documents and reset overlay byte counter to 0.
    pub fn clear(&mut self) {
        self.documents.clear();
        self.total_overlay_bytes = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_to_byte_offset_basic() {
        let text = "hello\nworld\nfoo bar";
        assert_eq!(
            position_to_byte_offset(
                text,
                Position {
                    line: 0,
                    character: 0
                }
            )
            .unwrap(),
            0
        );
        assert_eq!(
            position_to_byte_offset(
                text,
                Position {
                    line: 0,
                    character: 5
                }
            )
            .unwrap(),
            5
        );
        assert_eq!(
            position_to_byte_offset(
                text,
                Position {
                    line: 1,
                    character: 0
                }
            )
            .unwrap(),
            6
        );
        assert_eq!(
            position_to_byte_offset(
                text,
                Position {
                    line: 2,
                    character: 4
                }
            )
            .unwrap(),
            16
        );
    }

    #[test]
    fn test_position_to_byte_offset_utf16_astral_emoji() {
        // Line with astral emoji rocket 🚀 (\uD83D\uDE80 = 2 UTF-16 code units, 4 UTF-8 bytes)
        let text = "/* 🚀 */ const astralVal = 123;";
        // '/* ' is 3 chars, 3 UTF-16 code units, 3 bytes
        // '🚀' is 1 char, 2 UTF-16 code units, 4 bytes
        // ' */' is 3 chars, 3 UTF-16 code units, 3 bytes
        // After '🚀' is character 3 + 2 = 5. Byte offset should be 3 + 4 = 7.
        assert_eq!(
            position_to_byte_offset(
                text,
                Position {
                    line: 0,
                    character: 5
                }
            )
            .unwrap(),
            7
        );
        // After ' */ ' is character 3 + 2 + 3 = 8. Byte offset should be 3 + 4 + 3 = 10.
        assert_eq!(
            position_to_byte_offset(
                text,
                Position {
                    line: 0,
                    character: 8
                }
            )
            .unwrap(),
            10
        );
    }

    #[test]
    fn test_ranged_edit_atomic_application() {
        let mut map = SessionOverlayMap::new();
        let inc = map
            .open_document(
                "test://file.ts".into(),
                "typescript".into(),
                1,
                "let a = 10;\nlet b = 20;".into(),
            )
            .unwrap();
        assert_eq!(inc, 1);

        // Edit '10' to '999'
        let change = TextDocumentContentChangeEvent {
            range: Some(Range {
                start: Position {
                    line: 0,
                    character: 8,
                },
                end: Position {
                    line: 0,
                    character: 10,
                },
            }),
            range_length: Some(2),
            text: "999".into(),
        };

        map.apply_changes("test://file.ts", 2, &[change]).unwrap();
        let doc = map.get("test://file.ts").unwrap();
        assert_eq!(doc.text, "let a = 999;\nlet b = 20;");
        assert_eq!(doc.version, 2);
    }

    #[test]
    fn test_document_scoped_close_preserves_other_models() {
        let mut map = SessionOverlayMap::new();
        map.open_document(
            "docA.ts".into(),
            "typescript".into(),
            1,
            "const A = 1;".into(),
        )
        .unwrap();
        map.open_document(
            "docB.ts".into(),
            "typescript".into(),
            1,
            "const B = 2;".into(),
        )
        .unwrap();

        assert_eq!(map.document_count(), 2);

        // Close docA
        let closed = map.close_document("docA.ts");
        assert!(closed.is_some());
        assert_eq!(map.document_count(), 1);

        // docB remains completely intact
        let doc_b = map.get("docB.ts").unwrap();
        assert_eq!(doc_b.text, "const B = 2;");
    }

    #[test]
    fn test_non_monotonic_version_rejected() {
        let mut map = SessionOverlayMap::new();
        map.open_document("doc.ts".into(), "typescript".into(), 5, "let x = 1;".into())
            .unwrap();

        let change = TextDocumentContentChangeEvent {
            range: None,
            range_length: None,
            text: "let x = 2;".into(),
        };

        // Same version 5 rejected
        assert!(matches!(
            map.apply_changes("doc.ts", 5, std::slice::from_ref(&change)),
            Err(OverlayError::NonMonotonicVersion {
                current: 5,
                received: 5
            })
        ));

        // Lower version 4 rejected
        assert!(matches!(
            map.apply_changes("doc.ts", 4, &[change]),
            Err(OverlayError::NonMonotonicVersion {
                current: 5,
                received: 4
            })
        ));
    }

    #[test]
    fn test_multi_change_batch_atomic_application() {
        let mut map = SessionOverlayMap::new();
        map.open_document(
            "doc.ts".into(),
            "typescript".into(),
            1,
            "foo bar baz".into(),
        )
        .unwrap();

        let c1 = TextDocumentContentChangeEvent {
            range: Some(Range {
                start: Position {
                    line: 0,
                    character: 0,
                },
                end: Position {
                    line: 0,
                    character: 3,
                },
            }),
            range_length: Some(3),
            text: "alpha".into(),
        };
        let c2 = TextDocumentContentChangeEvent {
            range: Some(Range {
                start: Position {
                    line: 0,
                    character: 10,
                },
                end: Position {
                    line: 0,
                    character: 13,
                },
            }),
            range_length: Some(3),
            text: "omega".into(),
        };

        map.apply_changes("doc.ts", 2, &[c1, c2]).unwrap();
        let doc = map.get("doc.ts").unwrap();
        assert_eq!(doc.text, "alpha bar omega");
        assert_eq!(doc.version, 2);
    }

    #[test]
    fn test_lossless_line_spans_comprehensive() {
        // Empty string -> single empty line
        let spans: Vec<_> = lossless_line_spans("").collect();
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].line_number, 0);
        assert_eq!(spans[0].start_byte, 0);
        assert_eq!(spans[0].content, "");
        assert_eq!(spans[0].separator_len, 0);

        // Lone CR text
        let cr_text = "line0\rline1\rline2";
        let spans: Vec<_> = lossless_line_spans(cr_text).collect();
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[0], LineSpan { line_number: 0, start_byte: 0, content: "line0", separator_len: 1 });
        assert_eq!(spans[1], LineSpan { line_number: 1, start_byte: 6, content: "line1", separator_len: 1 });
        assert_eq!(spans[2], LineSpan { line_number: 2, start_byte: 12, content: "line2", separator_len: 0 });

        // Mixed text: CRLF, CR, LF
        let mixed = "first\r\nsecond\rthird\nfourth";
        let spans: Vec<_> = lossless_line_spans(mixed).collect();
        assert_eq!(spans.len(), 4);
        assert_eq!(spans[0], LineSpan { line_number: 0, start_byte: 0, content: "first", separator_len: 2 });
        assert_eq!(spans[1], LineSpan { line_number: 1, start_byte: 7, content: "second", separator_len: 1 });
        assert_eq!(spans[2], LineSpan { line_number: 2, start_byte: 14, content: "third", separator_len: 1 });
        assert_eq!(spans[3], LineSpan { line_number: 3, start_byte: 20, content: "fourth", separator_len: 0 });

        // Trailing empty lines across all separators
        let trailing_lf: Vec<_> = lossless_line_spans("foo\n").collect();
        assert_eq!(trailing_lf.len(), 2);
        assert_eq!(trailing_lf[0], LineSpan { line_number: 0, start_byte: 0, content: "foo", separator_len: 1 });
        assert_eq!(trailing_lf[1], LineSpan { line_number: 1, start_byte: 4, content: "", separator_len: 0 });

        let trailing_crlf: Vec<_> = lossless_line_spans("foo\r\n").collect();
        assert_eq!(trailing_crlf.len(), 2);
        assert_eq!(trailing_crlf[0], LineSpan { line_number: 0, start_byte: 0, content: "foo", separator_len: 2 });
        assert_eq!(trailing_crlf[1], LineSpan { line_number: 1, start_byte: 5, content: "", separator_len: 0 });

        let trailing_cr: Vec<_> = lossless_line_spans("foo\r").collect();
        assert_eq!(trailing_cr.len(), 2);
        assert_eq!(trailing_cr[0], LineSpan { line_number: 0, start_byte: 0, content: "foo", separator_len: 1 });
        assert_eq!(trailing_cr[1], LineSpan { line_number: 1, start_byte: 4, content: "", separator_len: 0 });

        // Multiple consecutive separators
        let consecutive: Vec<_> = lossless_line_spans("\r\n\r\n").collect();
        assert_eq!(consecutive.len(), 3);
        assert_eq!(consecutive[0], LineSpan { line_number: 0, start_byte: 0, content: "", separator_len: 2 });
        assert_eq!(consecutive[1], LineSpan { line_number: 1, start_byte: 2, content: "", separator_len: 2 });
        assert_eq!(consecutive[2], LineSpan { line_number: 2, start_byte: 4, content: "", separator_len: 0 });
    }

    #[test]
    fn test_position_to_byte_offset_cr_crlf_mixed_and_edits() {
        let text = "alpha\r\nbeta\rgamma\ndelta";
        // Line 0: "alpha" (0..5), sep \r\n (5..7)
        // Line 1: "beta" (7..11), sep \r (11..12)
        // Line 2: "gamma" (12..17), sep \n (17..18)
        // Line 3: "delta" (18..23), sep none

        assert_eq!(position_to_byte_offset(text, Position { line: 0, character: 0 }).unwrap(), 0);
        assert_eq!(position_to_byte_offset(text, Position { line: 0, character: 5 }).unwrap(), 5);
        assert_eq!(position_to_byte_offset(text, Position { line: 1, character: 0 }).unwrap(), 7);
        assert_eq!(position_to_byte_offset(text, Position { line: 1, character: 2 }).unwrap(), 9);
        assert_eq!(position_to_byte_offset(text, Position { line: 1, character: 4 }).unwrap(), 11);
        assert_eq!(position_to_byte_offset(text, Position { line: 2, character: 0 }).unwrap(), 12);
        assert_eq!(position_to_byte_offset(text, Position { line: 2, character: 5 }).unwrap(), 17);
        assert_eq!(position_to_byte_offset(text, Position { line: 3, character: 0 }).unwrap(), 18);
        assert_eq!(position_to_byte_offset(text, Position { line: 3, character: 5 }).unwrap(), 23);

        // End of line offset strictly points to start of separator, never interior of CRLF
        let crlf_text = "abc\r\ndef";
        assert_eq!(position_to_byte_offset(crlf_text, Position { line: 0, character: 3 }).unwrap(), 3);
        assert_eq!(position_to_byte_offset(crlf_text, Position { line: 1, character: 0 }).unwrap(), 5);

        // Applying ranged edit on a lone CR document preserves CR line separators
        let mut map = SessionOverlayMap::new();
        map.open_document("cr.ts".into(), "typescript".into(), 1, "const a = 1;\rconst b = 2;\rconst c = 3;".into()).unwrap();
        let change = TextDocumentContentChangeEvent {
            range: Some(Range {
                start: Position { line: 1, character: 6 },
                end: Position { line: 1, character: 7 },
            }),
            range_length: Some(1),
            text: "target".into(),
        };
        map.apply_changes("cr.ts", 2, &[change]).unwrap();
        let doc = map.get("cr.ts").unwrap();
        assert_eq!(doc.text, "const a = 1;\rconst target = 2;\rconst c = 3;");
    }

    #[test]
    fn test_position_to_byte_offset_boundary_and_surrogate_rejections() {
        let text = "a\r\n/* 🚀 */\rb";
        // Line 1 has rocket emoji: '/* ' (3 UTF-16, 3 bytes), '🚀' (2 UTF-16 code units, 4 bytes)
        // Column 3 is start of rocket, Column 5 is after rocket.
        // Column 4 splits the surrogate pair -> must return error
        let split_err = position_to_byte_offset(text, Position { line: 1, character: 4 });
        assert!(matches!(split_err, Err(OverlayError::InvalidPosition { line: 1, character: 4, .. })));

        // Out of bounds character
        let oob_char = position_to_byte_offset(text, Position { line: 0, character: 2 });
        assert!(matches!(oob_char, Err(OverlayError::InvalidPosition { line: 0, character: 2, .. })));

        // Out of bounds line
        let oob_line = position_to_byte_offset(text, Position { line: 3, character: 0 });
        assert!(matches!(oob_line, Err(OverlayError::InvalidPosition { line: 3, character: 0, .. })));
    }
}
