use crate::session_changes::types::{
    CoverageReason, MAX_PER_FILE_DIFF_MS, MAX_TEXT_LINE_BYTES, MAX_TEXT_RENDER_BYTES,
    MAX_TEXT_RENDER_LINES,
};
use std::time::Instant;

pub struct DiffStatsResult {
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub reasons: Vec<CoverageReason>,
}

/// Count lines in a UTF-8 string without stripping newline characters.
pub fn count_logical_lines(s: &str) -> (usize, bool) {
    if s.is_empty() {
        return (0, true);
    }
    let mut line_count = 0;
    let mut max_line_len = 0;
    let mut curr_line_len = 0;

    for byte in s.bytes() {
        curr_line_len += 1;
        if byte == b'\n' {
            line_count += 1;
            if curr_line_len > max_line_len {
                max_line_len = curr_line_len;
            }
            curr_line_len = 0;
        }
    }
    if curr_line_len > 0 {
        line_count += 1;
        if curr_line_len > max_line_len {
            max_line_len = curr_line_len;
        }
    }

    let line_len_ok = max_line_len <= MAX_TEXT_LINE_BYTES;
    (line_count, line_len_ok)
}

/// Compute bounded text diff line counts between old and new UTF-8 byte buffers.
pub fn compute_line_stats(old_bytes: &[u8], new_bytes: &[u8]) -> DiffStatsResult {
    let mut reasons = Vec::new();

    // Check size caps
    if old_bytes.len() > MAX_TEXT_RENDER_BYTES || new_bytes.len() > MAX_TEXT_RENDER_BYTES {
        reasons.push(CoverageReason::TextLimit);
        return DiffStatsResult {
            additions: None,
            deletions: None,
            reasons,
        };
    }

    // Check UTF-8 validity
    let old_str = match std::str::from_utf8(old_bytes) {
        Ok(s) => s,
        Err(_) => {
            reasons.push(CoverageReason::NonUtf8);
            return DiffStatsResult {
                additions: None,
                deletions: None,
                reasons,
            };
        }
    };
    let new_str = match std::str::from_utf8(new_bytes) {
        Ok(s) => s,
        Err(_) => {
            reasons.push(CoverageReason::NonUtf8);
            return DiffStatsResult {
                additions: None,
                deletions: None,
                reasons,
            };
        }
    };

    // Check line counts and max line length
    let (old_lines, old_line_len_ok) = count_logical_lines(old_str);
    let (new_lines, new_line_len_ok) = count_logical_lines(new_str);

    if old_lines > MAX_TEXT_RENDER_LINES
        || new_lines > MAX_TEXT_RENDER_LINES
        || !old_line_len_ok
        || !new_line_len_ok
    {
        reasons.push(CoverageReason::TextLimit);
        return DiffStatsResult {
            additions: None,
            deletions: None,
            reasons,
        };
    }

    // Fast paths:
    if old_bytes == new_bytes {
        return DiffStatsResult {
            additions: Some(0),
            deletions: Some(0),
            reasons,
        };
    }

    if old_lines == 0 {
        return DiffStatsResult {
            additions: Some(new_lines as u64),
            deletions: Some(0),
            reasons,
        };
    }

    if new_lines == 0 {
        return DiffStatsResult {
            additions: Some(0),
            deletions: Some(old_lines as u64),
            reasons,
        };
    }

    // Use libgit2 in-memory patch with cooperative 50ms timeout check
    let start_time = Instant::now();
    let patch_res = git2::Patch::from_buffers(old_bytes, None, new_bytes, None, None);

    if start_time.elapsed().as_millis() as u64 > MAX_PER_FILE_DIFF_MS {
        reasons.push(CoverageReason::Deadline);
        return DiffStatsResult {
            additions: None,
            deletions: None,
            reasons,
        };
    }

    match patch_res {
        Ok(patch) => match patch.line_stats() {
            Ok((_, adds, dels)) => DiffStatsResult {
                additions: Some(adds as u64),
                deletions: Some(dels as u64),
                reasons,
            },
            Err(_) => {
                reasons.push(CoverageReason::DiffLimit);
                DiffStatsResult {
                    additions: None,
                    deletions: None,
                    reasons,
                }
            }
        },
        Err(_) => {
            reasons.push(CoverageReason::DiffLimit);
            DiffStatsResult {
                additions: None,
                deletions: None,
                reasons,
            }
        }
    }
}
