# Baseline b031e6a Deterministic Failing-Before Reproduction Artifact (F4)

**Date:** 2026-10-26  
**Baseline Git Commit:** `b031e6a40123d8c5169012e0b736ac8c4f1f6091`  
**Execution Environment:** Disposable worktree at `/tmp/dam-hopper-baseline-f4` with `CARGO_TARGET_DIR=/home/loidinh/.cache/dam-hopper-baseline-target`.

---

## 1. Reproduction Methodology & Runbook

### Step 1: Provision Disposable Worktree at Baseline Commit
```bash
git worktree add --detach /tmp/dam-hopper-baseline-f4 b031e6a40123d8c5169012e0b736ac8c4f1f6091
```

### Step 2: Overlay Baseline Test
The test file `server/tests/git_protected_config.rs` exercises two key reachable Git mutation vectors targeting the canonical global configuration:
1. `test_baseline_b031e6a_worktree_remove_deletes_protected_config`: Signed ordinary User issues `DELETE /api/git/:project/worktrees` with `{ "path": worktree_dir, "force": true }` where `XDG_CONFIG_HOME` points inside the linked worktree.
2. `test_baseline_b031e6a_discard_file_mutates_protected_config`: Direct `discard_file` on a repository file corresponding to canonical global config.

### Step 3: Execute the Baseline Tests
```bash
CARGO_TARGET_DIR=/home/loidinh/.cache/dam-hopper-baseline-target cargo test \
  --manifest-path /tmp/dam-hopper-baseline-f4/server/Cargo.toml \
  --test git_protected_config -- --nocapture
```

### Step 4: Observed Baseline Execution Output (Exit Code 0, Proving Defect)
```text
     Running tests/git_protected_config.rs (/home/loidinh/.cache/dam-hopper-baseline-target/debug/deps/git_protected_config-d7d8f48e9c4d954b)

running 2 tests
[BASELINE REPRO F4] Response status: 200 OK
[BASELINE REPRO F4] Response body: {"ok":true}
test test_baseline_b031e6a_worktree_remove_deletes_protected_config ... ok
[BASELINE REPRO F4] discard_file result: Ok(())
test test_baseline_b031e6a_discard_file_mutates_protected_config ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 9.20s
```

### Step 5: Defect Findings on Baseline `b031e6a`
1. On baseline `b031e6a`, `remove_worktree_route` lacks any check against `is_protected_global_config_path`. A signed ordinary User was able to delete the worktree and destroy the canonical config `config.toml`. Furthermore, semantic targets were prematurely invalidated before attempting Git removal.
2. On baseline `b031e6a`, `discard_file` performs no validation against `is_protected_global_config_path`, overwriting unsaved canonical configuration without refusal.

### Step 6: Teardown Disposable Worktree
```bash
git worktree remove --force /tmp/dam-hopper-baseline-f4
```
