# Resource and Boundary Qualification Report: Session Changes Review

Date: 2026-10-30
Scope: Verification of resource bounds, adversarial limits, absence certification, and mutation invariance.

## Qualification Outcomes

| Invariant / Limit | Contract Reference | Observed Result | Evidence |
| :--- | :--- | :--- | :--- |
| **Repository Mutation Invariance** | Contracts S1, S6, S11 | **PASS** | SHA-256 hash of tracked working tree files strictly identical before and after baseline capture and revision comparison (`test_adversarial_root_preflight_and_invariance`). |
| **Root Preflight & Canonical Resolution** | Contracts S1, S4 | **PASS** | `validate_project_root_preflight` rejects parent traversal (`../sneaky`), absolute escapes, and unbounded paths; permits valid relative canonical project roots. |
| **Path Length & Depth Bounds** | Contracts S5, S11 | **PASS** | Paths exceeding `MAX_PATH_DEPTH` (64) or `MAX_PATH_BYTES` (4096) handled gracefully without panic; deep directories bounded by budget (`test_adversarial_symlink_and_deep_paths`). |
| **Symlink Isolation** | Contracts S4, S11 | **PASS** | Outside symlinks (`link_to_secret`) are not followed as regular files or traversed outside the canonical project root. |
| **Absence Certification & Tampering** | Contracts S5, S8 | **PASS** | Verified parent directory certifies absent file with `AbsentInVerifiedDirectory`. Truncated or incomplete parent directories remain `Unknown` with `Unproven` provenance (`test_absence_proof_adversarial_tampering`). |
| **Turn Settling Deduplication** | Contracts S2, S7 | **PASS** | Duplicate `POST /settled` turn calls return `duplicate: true`, preventing redundant revision computation. |
| **Lifecycle Acknowledgment Barrier** | Contracts S2, S3 | **PASS** | Unactivated/unacknowledged baselines reject comparison with `OriginalUnavailable`; only acknowledged baselines advance to `Ready`. |

## Verified Bounds

- `MAX_PATH_BYTES`: 4096 bytes per path.
- `MAX_PATH_DEPTH`: 64 path segments.
- `MAX_METADATA_NODES`: 100,000 nodes maximum in in-memory AbsenceTrie.
- `MAX_FILE_BYTES`: 2,097,152 bytes (2 MiB) regular file limit for diff generation.
- Memory & Disk Accounting: Baselines stored in isolated temp directory per server run; memory usage bounded by trie node budget.
