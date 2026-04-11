# Research: git2 Rust Diff & Merge Conflict APIs

## Diff Generation

### Working tree vs index (unstaged changes)
```rust
repo.diff_index_to_workdir(None, Some(&mut opts))
```

### Index vs HEAD (staged changes)
```rust
let head_tree = repo.head()?.peel_to_tree()?;
repo.diff_tree_to_index(Some(&head_tree), None, Some(&mut opts))
```

### Iterating Diffs
`Diff` provides `.deltas()` iterator → `DiffDelta` per file. Each delta has `old_file()`, `new_file()`, `status()` (Added/Deleted/Modified/Renamed/etc).

`Patch::from_diff(&diff, idx)` gives per-file patch with hunks and lines. `patch.to_buf()` gives unified diff text.

### File Content Retrieval
For diff viewer, need original + modified content:
- **Original (HEAD):** `repo.find_blob(delta.old_file().id())` → `.content()`
- **Modified (workdir):** Read from filesystem via existing `fs::ops::read_file()`

## Rollback/Revert Operations

### Discard file changes (checkout HEAD version)
```rust
let mut cb = git2::build::CheckoutBuilder::new();
cb.path(file_path).force();
repo.checkout_head(Some(&mut cb))
```

### Discard hunk (partial rollback)
No direct git2 API for hunk-level revert. Options:
1. **Apply reverse patch** — Generate patch for hunk, reverse it, apply via `repo.apply()`
2. **CLI fallback** — `git checkout -p` is interactive; not suitable for API
3. **Content manipulation** — Read original + modified, replace hunk region in modified file, write back

Recommendation: Option 3 (content manipulation) — compute which lines to replace from hunk data, write file. Simple and reliable.

### Unstage file
```rust
let mut index = repo.index()?;
let head_tree = repo.head()?.peel_to_tree()?;
// Reset specific path in index to HEAD
repo.reset_default(Some(head_tree.as_object()), &[path])?;
```

### Stage file
```rust
let mut index = repo.index()?;
index.add_path(Path::new(relative_path))?;
index.write()?;
```

## Merge Conflict Detection

### Check for conflicts
```rust
let index = repo.index()?;
if index.has_conflicts() {
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        // conflict.ancestor — common base
        // conflict.our — our version
        // conflict.their — their version
        // Each is Option<IndexEntry> with id (blob OID)
    }
}
```

### Get conflict content
```rust
let our_blob = repo.find_blob(conflict.our.unwrap().id)?;
let their_blob = repo.find_blob(conflict.their.unwrap().id)?;
let ancestor_blob = repo.find_blob(conflict.ancestor.unwrap().id)?;
```

### Resolve conflict
```rust
// Write resolved content to file
std::fs::write(&full_path, resolved_content)?;
// Stage the resolved file
let mut index = repo.index()?;
index.add_path(Path::new(relative_path))?;
index.write()?;
// Conflicts auto-clear when file is staged
```

## Existing Codebase Integration
`server/src/git/repository.rs` already has `get_status()` returning staged/modified/untracked counts. The diff API endpoints don't exist yet — need new routes.
