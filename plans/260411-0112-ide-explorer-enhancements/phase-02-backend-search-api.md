# Phase 02: Backend Search API

> Parent: [plan.md](./plan.md) | Depends on: none (parallel with Phase 01)

## Overview

- **Priority:** P2
- **Status:** Done
- **Effort:** 2h
- **Description:** Add `GET /api/fs/search` endpoint for full-text content search within project files
- **Completed:** 2026-04-11

## Key Insights

- No search crate exists in Cargo.toml; `regex = "1"` already present
- `ignore = "0.4"` crate replaces `walkdir` — same dir-walking capability + .gitignore awareness (validated)
- All FS handlers follow consistent pattern: `resolve()` -> ops fn -> Json response
- Must run directory walking in `spawn_blocking` (walkdir is sync)
- Binary files must be skipped using existing heuristic (NUL byte probe)
- Route goes inside existing `ide_routes` block (feature-gated)

## Requirements

### Functional
- Search file contents by **plain text** (regex-escaped on server) within a project
- Return file path, line number, column, and matching line text
- Support optional subdirectory scoping
- Case-insensitive by default, configurable
- Cap results server-side (default 200, max 1000)
- Skip binary files
- **Respect .gitignore** patterns (skip node_modules, dist, build etc.)

### Non-functional
- Non-blocking: `spawn_blocking` for directory walk
- Response time: < 2s for typical project (< 10k files)
- Sandbox validation on all paths

## Architecture

```
GET /api/fs/search?project=X&q=PATTERN&path=REL&case=false&max=200
         |
    resolve(state, project, path) -> canonical root
         |
    ops::search_files(root, pattern, case, max) [spawn_blocking]
         |
    walkdir -> skip binary -> regex match per line -> collect SearchMatch
         |
    Json(SearchResponse { query, matches, truncated })
```

## Related Code Files

| File | Action | Description |
|------|--------|-------------|
| `server/Cargo.toml` | Modify | Add `ignore = "0.4"` dependency |
| `server/src/fs/ops.rs` | Modify | Add `SearchMatch` struct + `search_files()` fn |
| `server/src/fs/mod.rs` | Modify | Re-export `SearchMatch` |
| `server/src/api/fs.rs` | Modify | Add `SearchParams`, `SearchResponse`, `search` handler |
| `server/src/api/router.rs` | Modify | Add `.route("/api/fs/search", get(fs_api::search))` |

## Implementation Steps

### Step 1: Add dependency

```toml
# server/Cargo.toml [dependencies]
ignore = "0.4"
```

Using `ignore` instead of `walkdir` — provides same walk API but automatically respects `.gitignore`, `.ignore`, and hidden files. Same author as ripgrep.

### Step 2: Add search_files to ops.rs

```rust
use ignore::WalkBuilder;
use regex::RegexBuilder;

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: u64,
    pub col: u64,
    pub text: String,
}

pub const MAX_SEARCH_RESULTS: usize = 1000;
const MAX_LINE_LEN: usize = 500;
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

/// Search file contents. `query` is plain text (regex-escaped internally).
pub async fn search_files(
    root: &Path,
    query: &str,
    sub_path: Option<&str>,
    case_sensitive: bool,
    max_results: usize,
) -> Result<(Vec<SearchMatch>, bool), FsError> {
    let search_root = match sub_path {
        Some(p) if !p.is_empty() => root.join(p),
        _ => root.to_path_buf(),
    };
    let root_clone = root.to_path_buf();
    let escaped = regex::escape(query); // plain text search — escape user input
    let max = max_results.min(MAX_SEARCH_RESULTS);

    tokio::task::spawn_blocking(move || {
        let re = RegexBuilder::new(&escaped)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| FsError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Invalid pattern: {e}"),
            )))?;

        let mut matches = Vec::new();
        let mut truncated = false;

        // WalkBuilder respects .gitignore automatically
        for entry in WalkBuilder::new(&search_root)
            .hidden(false)      // include dotfiles
            .git_ignore(true)   // respect .gitignore
            .git_global(true)
            .git_exclude(true)
            .build()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().map_or(false, |ft| ft.is_file()) { continue; }

            let path = entry.path();

            // Skip large files
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > MAX_FILE_SIZE { continue; }
            }

            // Read file; skip if binary (read_to_string fails on non-UTF8)
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let rel = path.strip_prefix(&root_clone)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();

            for (line_idx, line) in content.lines().enumerate() {
                if let Some(m) = re.find(line) {
                    let text = if line.len() > MAX_LINE_LEN {
                        format!("{}...", &line[..MAX_LINE_LEN])
                    } else {
                        line.to_string()
                    };
                    matches.push(SearchMatch {
                        path: rel.clone(),
                        line: (line_idx + 1) as u64,
                        col: (m.start() + 1) as u64,
                        text,
                    });
                    if matches.len() >= max {
                        truncated = true;
                        return Ok((matches, truncated));
                    }
                }
            }
        }
        Ok((matches, truncated))
    })
    .await
    .map_err(|e| FsError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
}
```

**Notes:**
- `regex::escape(query)` ensures plain text search — no regex syntax errors from user input
- `read_to_string` naturally skips binary files (non-UTF8 returns Err)
- `WalkBuilder` from `ignore` crate auto-skips .gitignore patterns
- Files > 10MB skipped to prevent memory issues

### Step 3: Add handler in api/fs.rs

```rust
#[derive(Deserialize)]
pub struct SearchParams {
    pub project: String,
    pub q: String,
    pub path: Option<String>,
    pub case: Option<bool>,
    pub max: Option<usize>,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub query: String,
    pub matches: Vec<ops::SearchMatch>,
    pub truncated: bool,
}

pub async fn search(
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, ApiError> {
    let canonical = resolve(&state, &params.project, &params.path.as_deref().unwrap_or(""))
        .await
        .map_err(ApiError::from)?;
    let max = params.max.unwrap_or(200).min(ops::MAX_SEARCH_RESULTS);
    let (matches, truncated) = ops::search_files(
        &canonical, &params.q, None, params.case.unwrap_or(false), max,
    ).await.map_err(AppError::Fs)?;
    Ok(Json(SearchResponse { query: params.q, matches, truncated }))
}
```

### Step 4: Register route in router.rs

Add inside `ide_routes` block:
```rust
.route("/api/fs/search", get(fs_api::search))
```

### Step 5: Re-export in fs/mod.rs

```rust
pub use ops::SearchMatch;
```

## Todo

- [ ] Add `ignore = "0.4"` to Cargo.toml
- [ ] Implement `SearchMatch` struct in ops.rs
- [ ] Implement `search_files()` with spawn_blocking
- [ ] Add `search` handler in api/fs.rs
- [ ] Register route in router.rs
- [ ] Re-export SearchMatch from fs/mod.rs
- [ ] Write integration test: search for known string in temp dir
- [ ] Test: regex error returns 400
- [ ] Test: binary files skipped
- [ ] Test: result cap works (truncated=true)

## Success Criteria

- `GET /api/fs/search?project=web&q=useState` returns matching lines
- Binary files excluded from results
- Regex errors return 400 with message
- Results capped at max parameter
- Response includes `truncated: true` when cap hit
- Path sandboxing prevents traversal outside project

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Large repos slow search | Cap results; consider adding timeout |
| Regex ReDoS | Use `regex` crate (safe by default, no backtracking) |
| Memory: reading large files | Skip files > 10MB (add size check in walk) |

## Security Considerations

- All paths validated through `WorkspaceSandbox`
- User input is `regex::escape()`d — no raw regex execution from user input
- Error messages sanitized (no absolute paths leaked)
- Search scoped to authenticated project only (existing auth middleware)

## Next Steps

- Phase 03: Frontend search panel consumes this endpoint
