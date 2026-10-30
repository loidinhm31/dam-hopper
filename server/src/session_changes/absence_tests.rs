use super::absence::*;
use crate::session_changes::types::{CoverageReason, Presence, Provenance};
use std::path::Path;

#[test]
fn test_certified_absence_proof() {
    let mut trie = AbsenceTrie::new();

    // In root "", we have "src" (Dir) and "README.md" (File), children_complete = true
    trie.record_directory(
        Path::new(""),
        true,
        &[
            ("src".to_string(), EntryKind::Dir, false),
            ("README.md".to_string(), EntryKind::File, false),
        ],
    );

    // In "src", we have "main.rs" (File), children_complete = true
    trie.record_directory(
        Path::new("src"),
        true,
        &[("main.rs".to_string(), EntryKind::File, false)],
    );

    // Now test a genuinely new file in "src": "src/utils.rs"
    let proof_new = trie.prove_path(Path::new("src/utils.rs"));
    assert_eq!(proof_new.presence, Presence::Absent);
    assert_eq!(proof_new.provenance, Provenance::AbsentInVerifiedDirectory);
    assert!(proof_new.reason.is_none());

    // Test existing file "src/main.rs"
    let proof_existing = trie.prove_path(Path::new("src/main.rs"));
    assert_eq!(proof_existing.presence, Presence::Present);
    assert_eq!(proof_existing.provenance, Provenance::Captured);

    // Test a new file at root: "Cargo.toml"
    let proof_cargo = trie.prove_path(Path::new("Cargo.toml"));
    assert_eq!(proof_cargo.presence, Presence::Absent);
    assert_eq!(proof_cargo.provenance, Provenance::AbsentInVerifiedDirectory);
}

#[test]
fn test_ignored_file_and_subtree_provenance() {
    let mut trie = AbsenceTrie::new();

    // Root contains "secret.env" (ignored) and "target" (ignored dir)
    trie.record_directory(
        Path::new(""),
        true,
        &[
            ("secret.env".to_string(), EntryKind::File, true),
            ("target".to_string(), EntryKind::Dir, true),
            ("src".to_string(), EntryKind::Dir, false),
        ],
    );

    // Later, secret.env is unignored and appears in current inventory.
    // It must NOT be treated as absent! It was excludedAtCapture -> unknown
    let proof_secret = trie.prove_path(Path::new("secret.env"));
    assert_eq!(proof_secret.presence, Presence::Unknown);
    assert_eq!(proof_secret.provenance, Provenance::ExcludedAtCapture);
    assert_eq!(proof_secret.reason, Some(CoverageReason::AbsenceUnknown));

    // A file under target (e.g. target/debug/build.log)
    let proof_target_file = trie.prove_path(Path::new("target/debug/build.log"));
    assert_eq!(proof_target_file.presence, Presence::Unknown);
    assert_eq!(proof_target_file.provenance, Provenance::ExcludedAtCapture);
    assert_eq!(proof_target_file.reason, Some(CoverageReason::AbsenceUnknown));
}

#[test]
fn test_uncertified_directory_absence() {
    let mut trie = AbsenceTrie::new();

    // Root is complete, but "build" directory was NOT certified (e.g. permission or truncation)
    trie.record_directory(
        Path::new(""),
        true,
        &[("build".to_string(), EntryKind::Dir, false)],
    );

    trie.record_directory(
        Path::new("build"),
        false, // children_complete = false
        &[("old.log".to_string(), EntryKind::File, false)],
    );

    // A missing file under "build": "build/new.log"
    // Since build was incomplete, we cannot prove absence!
    let proof = trie.prove_path(Path::new("build/new.log"));
    assert_eq!(proof.presence, Presence::Unknown);
    assert_eq!(proof.provenance, Provenance::Unproven);
    assert_eq!(proof.reason, Some(CoverageReason::AbsenceUnknown));
}

#[test]
fn test_blocked_node_proof() {
    let mut trie = AbsenceTrie::new();

    trie.record_directory(
        Path::new(""),
        true,
        &[("symlink_dir".to_string(), EntryKind::Symlink, false)],
    );

    let proof = trie.prove_path(Path::new("symlink_dir/child.txt"));
    assert_eq!(proof.presence, Presence::Unknown);
    assert_eq!(proof.provenance, Provenance::Unproven);
    assert_eq!(proof.reason, Some(CoverageReason::AbsenceUnknown));
}
