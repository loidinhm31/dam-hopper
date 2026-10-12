use std::path::PathBuf;
use std::sync::Arc;

pub const DEFAULT_MAX_ENTRIES: usize = 128;
pub const DEFAULT_MAX_RETAINED_BYTES: usize = 64 * 1024 * 1024; // 64 MiB

/// Unique identity for a committed file baseline in a repository at a specific commit.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CacheKey {
    /// Canonical resolved path to owning VCS root / worktree.
    pub repository_identity: PathBuf,
    /// Project-relative VCS root ID (e.g. "." or sub-path).
    pub root_id: String,
    /// HEAD commit OID at the time the baseline was resolved.
    pub head_oid: git2::Oid,
    /// Repository-relative path to the committed baseline at HEAD.
    pub committed_baseline_path: String,
}

/// A continuous span of lines attributed to a single historical commit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoricalBlameSpan {
    /// 1-based start line in the committed baseline.
    pub start_line: usize,
    /// Number of lines in this span.
    pub line_count: usize,
    /// Attribution commit OID.
    pub final_commit_oid: git2::Oid,
}

/// Owned, immutable baseline data cached for a committed file at HEAD.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlameBaseline {
    /// Normalized baseline bytes (CRLF-normalized by stripping CR before LF).
    pub bytes: Vec<u8>,
    /// Sorted historical attribution spans covering the baseline lines.
    pub spans: Vec<HistoricalBlameSpan>,
    /// Logical line count of the baseline.
    pub line_count: usize,
    /// HEAD blob OID used for validation against current HEAD tree entry.
    pub blob_oid: git2::Oid,
}

impl BlameBaseline {
    pub fn new(
        bytes: Vec<u8>,
        spans: Vec<HistoricalBlameSpan>,
        line_count: usize,
        blob_oid: git2::Oid,
    ) -> Self {
        Self {
            bytes,
            spans,
            line_count,
            blob_oid,
        }
    }
}

/// Accounts for the memory retained by a single cache entry.
pub fn account_entry_bytes(key: &CacheKey, baseline: &BlameBaseline) -> usize {
    let key_struct = std::mem::size_of::<CacheKey>();
    let key_path = key.repository_identity.as_os_str().len();
    let key_root_id = key.root_id.capacity();
    let key_baseline_path = key.committed_baseline_path.capacity();

    let baseline_arc_overhead = std::mem::size_of::<Arc<BlameBaseline>>();
    let baseline_struct = std::mem::size_of::<BlameBaseline>();
    let baseline_bytes = baseline.bytes.capacity();
    let spans_bytes = baseline
        .spans
        .capacity()
        .saturating_mul(std::mem::size_of::<HistoricalBlameSpan>());

    // LRU node pointer / hash table overhead estimate
    let lru_entry_overhead = 64;

    key_struct
        .saturating_add(key_path)
        .saturating_add(key_root_id)
        .saturating_add(key_baseline_path)
        .saturating_add(baseline_arc_overhead)
        .saturating_add(baseline_struct)
        .saturating_add(baseline_bytes)
        .saturating_add(spans_bytes)
        .saturating_add(lru_entry_overhead)
}

struct CacheInner {
    lru: lru::LruCache<CacheKey, Arc<BlameBaseline>>,
    current_retained_bytes: usize,
    max_entries: usize,
    max_retained_bytes: usize,
}

/// Thread-safe LRU cache retaining historical blame baselines.
pub struct BlameBaselineCache {
    inner: parking_lot::Mutex<CacheInner>,
}

impl std::fmt::Debug for BlameBaselineCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("BlameBaselineCache")
            .field("entries", &inner.lru.len())
            .field("current_retained_bytes", &inner.current_retained_bytes)
            .field("max_entries", &inner.max_entries)
            .field("max_retained_bytes", &inner.max_retained_bytes)
            .finish()
    }
}

impl BlameBaselineCache {
    /// Creates a new cache with default limits (128 entries, 64 MiB).
    pub fn new() -> Self {
        Self::with_capacities(DEFAULT_MAX_ENTRIES, DEFAULT_MAX_RETAINED_BYTES)
    }

    /// Creates a new cache with custom entry-count and byte-budget limits.
    pub fn with_capacities(max_entries: usize, max_retained_bytes: usize) -> Self {
        Self {
            inner: parking_lot::Mutex::new(CacheInner {
                lru: lru::LruCache::unbounded(),
                current_retained_bytes: 0,
                max_entries,
                max_retained_bytes,
            }),
        }
    }

    /// Looks up a cached baseline by key. On hit, promotes entry to MRU position.
    pub fn get(&self, key: &CacheKey) -> Option<Arc<BlameBaseline>> {
        let mut inner = self.inner.lock();
        inner.lru.get(key).cloned()
    }

    /// Inserts a baseline into the cache. Evicts LRU entries if capacity or byte limits are exceeded.
    /// If the entry exceeds the total byte limit or max_entries is 0, admission is skipped.
    pub fn insert(&self, key: CacheKey, baseline: Arc<BlameBaseline>) {
        let mut inner = self.inner.lock();
        if inner.max_entries == 0 {
            return;
        }

        let entry_bytes = account_entry_bytes(&key, &baseline);
        if entry_bytes > inner.max_retained_bytes {
            // Oversized entry skips admission.
            return;
        }

        // If key already exists, subtract old accounted bytes using original key's capacity.
        if let Some((old_k, old_val)) = inner.lru.pop_entry(&key) {
            let old_bytes = account_entry_bytes(&old_k, &old_val);
            inner.current_retained_bytes =
                inner.current_retained_bytes.saturating_sub(old_bytes);
        }

        // Evict LRU entries until both limits hold.
        while inner.lru.len() >= inner.max_entries
            || inner
                .current_retained_bytes
                .saturating_add(entry_bytes)
                > inner.max_retained_bytes
        {
            if let Some((evicted_key, evicted_val)) = inner.lru.pop_lru() {
                let evicted_bytes = account_entry_bytes(&evicted_key, &evicted_val);
                inner.current_retained_bytes =
                    inner.current_retained_bytes.saturating_sub(evicted_bytes);
            } else {
                break;
            }
        }

        inner.lru.put(key, baseline);
        inner.current_retained_bytes =
            inner.current_retained_bytes.saturating_add(entry_bytes);
    }

    /// Returns the number of currently retained cache entries.
    pub fn len(&self) -> usize {
        self.inner.lock().lru.len()
    }

    /// Returns true if the cache contains no entries.
    pub fn is_empty(&self) -> bool {
        self.inner.lock().lru.is_empty()
    }

    /// Returns the current total accounted retained bytes.
    pub fn retained_bytes(&self) -> usize {
        self.inner.lock().current_retained_bytes
    }

    /// Clears all entries from the cache.
    pub fn clear(&self) {
        let mut inner = self.inner.lock();
        inner.lru.clear();
        inner.current_retained_bytes = 0;
    }
}

impl Default for BlameBaselineCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_key(name: &str) -> CacheKey {
        CacheKey {
            repository_identity: PathBuf::from(format!("/tmp/repo-{}", name)),
            root_id: ".".to_string(),
            head_oid: git2::Oid::from_str("1111111111111111111111111111111111111111").unwrap(),
            committed_baseline_path: format!("src/{}.rs", name),
        }
    }

    fn dummy_baseline(text: &str) -> Arc<BlameBaseline> {
        let bytes = text.as_bytes().to_vec();
        let spans = vec![HistoricalBlameSpan {
            start_line: 1,
            line_count: 1,
            final_commit_oid: git2::Oid::from_str("1111111111111111111111111111111111111111").unwrap(),
        }];
        Arc::new(BlameBaseline::new(
            bytes,
            spans,
            1,
            git2::Oid::from_str("2222222222222222222222222222222222222222").unwrap(),
        ))
    }

    #[test]
    fn test_cache_insert_and_get() {
        let cache = BlameBaselineCache::new();
        let key = dummy_key("foo");
        let baseline = dummy_baseline("println!(\"hello\");\n");

        assert!(cache.get(&key).is_none());
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.retained_bytes(), 0);

        cache.insert(key.clone(), baseline.clone());

        assert_eq!(cache.len(), 1);
        assert!(cache.retained_bytes() > 0);

        let hit = cache.get(&key).expect("cache hit");
        assert_eq!(hit.bytes, baseline.bytes);
        assert_eq!(hit.spans, baseline.spans);
        assert_eq!(hit.blob_oid, baseline.blob_oid);
    }

    #[test]
    fn test_cache_lru_promotion_and_eviction() {
        // Capacity of 2 entries, large byte limit.
        let cache = BlameBaselineCache::with_capacities(2, 10_000_000);
        let k1 = dummy_key("one");
        let k2 = dummy_key("two");
        let k3 = dummy_key("three");

        cache.insert(k1.clone(), dummy_baseline("1"));
        cache.insert(k2.clone(), dummy_baseline("2"));
        assert_eq!(cache.len(), 2);

        // Access k1 to promote it to MRU (k2 becomes LRU).
        assert!(cache.get(&k1).is_some());

        // Insert k3 -> should evict k2.
        cache.insert(k3.clone(), dummy_baseline("3"));
        assert_eq!(cache.len(), 2);
        assert!(cache.get(&k1).is_some());
        assert!(cache.get(&k2).is_none()); // k2 was evicted
        assert!(cache.get(&k3).is_some());
    }

    #[test]
    fn test_cache_byte_budget_eviction() {
        let k1 = dummy_key("one");
        let b1 = dummy_baseline("short");
        let weight = account_entry_bytes(&k1, &b1);

        // Allow at most 2 items worth of bytes, but max_entries = 10.
        let cache = BlameBaselineCache::with_capacities(10, weight * 2 + 10);

        let k2 = dummy_key("two");
        let k3 = dummy_key("three");

        cache.insert(k1.clone(), b1.clone());
        cache.insert(k2.clone(), b1.clone());
        assert_eq!(cache.len(), 2);

        // Inserting k3 should evict k1 due to byte budget.
        cache.insert(k3.clone(), b1.clone());
        assert_eq!(cache.len(), 2);
        assert!(cache.get(&k1).is_none()); // k1 evicted
        assert!(cache.get(&k2).is_some());
        assert!(cache.get(&k3).is_some());
    }

    #[test]
    fn test_cache_replacement_accounting() {
        let cache = BlameBaselineCache::new();
        let key = dummy_key("replace");

        let b1 = dummy_baseline("short");
        cache.insert(key.clone(), b1);
        let bytes1 = cache.retained_bytes();
        assert_eq!(cache.len(), 1);

        let b2 = dummy_baseline("much longer baseline text content to increase size");
        cache.insert(key.clone(), b2);
        let bytes2 = cache.retained_bytes();
        assert_eq!(cache.len(), 1);
        assert!(bytes2 > bytes1);

        // Replace with shorter
        let b3 = dummy_baseline("s");
        cache.insert(key.clone(), b3);
        assert_eq!(cache.len(), 1);
        assert!(cache.retained_bytes() < bytes2);
    }

    #[test]
    fn test_cache_oversized_entry_bypasses_admission() {
        // Max bytes smaller than single entry.
        let cache = BlameBaselineCache::with_capacities(10, 50);
        let key = dummy_key("oversized");
        let baseline = dummy_baseline("any content");

        cache.insert(key.clone(), baseline);
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.retained_bytes(), 0);
        assert!(cache.get(&key).is_none());
    }

    #[test]
    fn test_cache_zero_capacities() {
        let cache = BlameBaselineCache::with_capacities(0, 10_000_000);
        let key = dummy_key("zero");
        cache.insert(key.clone(), dummy_baseline("content"));
        assert_eq!(cache.len(), 0);
        assert!(cache.get(&key).is_none());
    }

    #[test]
    fn test_cache_clear() {
        let cache = BlameBaselineCache::new();
        cache.insert(dummy_key("a"), dummy_baseline("a"));
        cache.insert(dummy_key("b"), dummy_baseline("b"));
        assert_eq!(cache.len(), 2);
        assert!(cache.retained_bytes() > 0);

        cache.clear();
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.retained_bytes(), 0);
    }
}
