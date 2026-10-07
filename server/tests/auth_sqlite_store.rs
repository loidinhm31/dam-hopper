//! File-backed SQLite authentication store behavior. No MongoDB is involved, so
//! these never skip. CAS and throttle tests use two independent connections to
//! the same file, not clones sharing one connection lock.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Duration, TimeZone, Utc};
use dam_hopper_server::auth::model::*;
use dam_hopper_server::auth::policy::*;
use dam_hopper_server::auth::{AuthStore, StoreError};
use rusqlite::Connection;
use tempfile::{tempdir, TempDir};

fn t0() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 7, 12, 0, 0).unwrap()
}

fn user(name: &str) -> UserRecord {
    UserRecord {
        id: None,
        username: name.to_string(),
        password_hash: format!("hash-{name}"),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    }
}

fn mfa(step: i64) -> MfaConfirmed {
    MfaConfirmed {
        secret_ciphertext: "cipher".into(),
        nonce: "nonce".into(),
        key_id: "mfa-v1".into(),
        enrolled_at: chrono_to_bson(t0()),
        last_accepted_step: step,
    }
}

fn session(id: &str, name: &str, issued: DateTime<Utc>, expires: DateTime<Utc>) -> AuthSession {
    AuthSession {
        id: id.into(),
        username: name.into(),
        auth_version: 0,
        credential_version: 1,
        issued_at: chrono_to_bson(issued),
        expires_at: chrono_to_bson(expires),
        mfa_verified_at: chrono_to_bson(issued),
        revoked_at: None,
    }
}

fn challenge(
    id: &str,
    name: &str,
    purpose: ChallengePurpose,
    created: DateTime<Utc>,
) -> AuthChallenge {
    AuthChallenge {
        id: id.into(),
        username: name.into(),
        auth_version: 0,
        purpose,
        created_at: chrono_to_bson(created),
        expires_at: chrono_to_bson(created + Duration::seconds(CHALLENGE_LIFETIME_SECS)),
        attempts: 0,
        consumed_at: None,
        pending_secret_ciphertext: None,
        pending_secret_nonce: None,
        pending_secret_key_id: None,
        session_id: None,
        credential_version: None,
    }
}

/// Temp dir + auth file path (parent is the private temp dir itself).
fn db_path() -> (TempDir, PathBuf) {
    let dir = tempdir().unwrap();
    let path = dir.path().join("auth.db");
    (dir, path)
}

/// Two independent stores (separate connections) on the same file.
async fn pair(path: &Path) -> (AuthStore, AuthStore) {
    (
        AuthStore::open_sqlite(path).await.unwrap(),
        AuthStore::open_sqlite(path).await.unwrap(),
    )
}

#[tokio::test]
async fn records_round_trip_and_survive_reopen() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();

    let mut full = user("alice");
    full.role = UserRole::Admin;
    full.auth_version = 3;
    full.mfa = Some(mfa(41));
    full.mfa_attempt_window_started_at = Some(chrono_to_bson(t0()));
    full.mfa_attempt_count = 4;
    full.mfa_blocked_until = Some(chrono_to_bson(t0() + Duration::seconds(90)));
    store.create_user(full.clone()).await.unwrap();
    store.create_user(user("bob")).await.unwrap();

    let sess = session("s1", "alice", t0(), t0() + Duration::days(30));
    store.create_session(sess.clone()).await.unwrap();
    let mut chal = challenge("c1", "alice", ChallengePurpose::StepUp, t0());
    chal.attempts = 2;
    chal.session_id = Some("s1".into());
    chal.credential_version = Some(1);
    chal.pending_secret_ciphertext = Some("p-cipher".into());
    chal.pending_secret_nonce = Some("p-nonce".into());
    chal.pending_secret_key_id = Some("p-key".into());
    store.create_challenge(chal.clone()).await.unwrap();
    drop(store);

    let reopened = AuthStore::open_sqlite(&path).await.unwrap();
    let loaded = reopened.get_user("alice").await.unwrap().unwrap();
    assert!(loaded.id.is_some(), "id must be generated");
    assert_eq!(UserRecord { id: None, ..loaded }, full);
    let bob = reopened.get_user("bob").await.unwrap().unwrap();
    assert_eq!(bob.mfa, None);
    assert_eq!(bob.role, UserRole::User);
    assert_eq!(reopened.get_session("s1").await.unwrap(), Some(sess));
    assert_eq!(reopened.get_challenge("c1").await.unwrap(), Some(chal));
    assert!(
        reopened.get_user("ALICE").await.unwrap().is_none(),
        "username is exact"
    );
    assert!(reopened.get_session("nope").await.unwrap().is_none());
}

#[tokio::test]
async fn duplicate_username_never_overwrites_and_id_collision_is_not_a_username_conflict() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();
    let mut original = user("alice");
    original.role = UserRole::Admin;
    original.mfa = Some(mfa(7));
    store.create_user(original).await.unwrap();
    let alice = store.get_user("alice").await.unwrap().unwrap();

    let mut attacker = user("alice");
    attacker.password_hash = "attacker".into();
    let err = store.create_user(attacker).await.unwrap_err();
    assert!(matches!(err, StoreError::DuplicateUsername(_)), "{err:?}");
    assert_eq!(store.get_user("alice").await.unwrap().unwrap(), alice);

    let mut same_id = user("mallory");
    same_id.id = alice.id;
    let err = store.create_user(same_id).await.unwrap_err();
    assert!(!matches!(err, StoreError::DuplicateUsername(_)), "{err:?}");
    assert!(store.get_user("mallory").await.unwrap().is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn enrollment_has_exactly_one_winner_across_connections_and_rejects_stale_version() {
    let (_dir, path) = db_path();
    let (a, b) = pair(&path).await;
    a.create_user(user("alice")).await.unwrap();

    // Wrong auth version never enrolls.
    assert!(!a.confirm_enrollment("alice", 1, mfa(0)).await.unwrap());

    let mut tasks = Vec::new();
    for i in 0..8 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store.confirm_enrollment("alice", 0, mfa(i)).await.unwrap()
        }));
    }
    let mut wins = 0;
    for task in tasks {
        wins += usize::from(task.await.unwrap());
    }
    assert_eq!(wins, 1, "exactly one enrollment wins");
    let stored = a.get_user("alice").await.unwrap().unwrap().mfa.unwrap();
    assert!(!b.confirm_enrollment("alice", 0, mfa(99)).await.unwrap());
    assert_eq!(
        b.get_user("alice").await.unwrap().unwrap().mfa.unwrap(),
        stored
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn totp_step_is_single_use_monotonic_and_never_synthesizes_a_factor() {
    let (_dir, path) = db_path();
    let (a, b) = pair(&path).await;
    let mut enrolled = user("alice");
    enrolled.mfa = Some(mfa(10));
    a.create_user(enrolled).await.unwrap();
    a.create_user(user("bare")).await.unwrap();

    let mut tasks = Vec::new();
    for i in 0..8 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store.advance_totp_step("alice", 0, 11).await.unwrap()
        }));
    }
    let mut wins = 0;
    for task in tasks {
        wins += usize::from(task.await.unwrap());
    }
    assert_eq!(wins, 1, "equal step has exactly one winner");

    assert!(
        !b.advance_totp_step("alice", 0, 11).await.unwrap(),
        "replay"
    );
    assert!(
        !b.advance_totp_step("alice", 0, 5).await.unwrap(),
        "older step"
    );
    assert!(
        !b.advance_totp_step("alice", 7, 99).await.unwrap(),
        "stale authVersion"
    );
    assert!(b.advance_totp_step("alice", 0, 12).await.unwrap());
    assert!(!b.advance_totp_step("bare", 0, 1).await.unwrap());
    assert_eq!(a.get_user("bare").await.unwrap().unwrap().mfa, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn failed_attempts_are_not_lost_across_connections_and_window_boundaries_are_exact() {
    let (_dir, path) = db_path();
    let (a, b) = pair(&path).await;
    a.create_user(user("alice")).await.unwrap();
    a.record_failed_attempt("ghost", t0()).await.unwrap(); // missing user: no-op

    // First failure opens the window; 6 more race on two connections.
    a.record_failed_attempt("alice", t0()).await.unwrap();
    let mut tasks = Vec::new();
    for i in 0..6 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store
                .record_failed_attempt("alice", t0() + Duration::seconds(1))
                .await
                .unwrap();
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
    let state = b.get_user("alice").await.unwrap().unwrap();
    assert_eq!(state.mfa_attempt_count, 7, "no lost increments");
    assert_eq!(state.mfa_blocked_until, None);
    assert_eq!(
        state.mfa_attempt_window_started_at,
        Some(chrono_to_bson(t0()))
    );

    // Attempts 8 and 9 stay below the limit; attempt 10 sets the cooldown.
    let last = t0() + Duration::seconds(2);
    for _ in 0..2 {
        b.record_failed_attempt("alice", last).await.unwrap();
    }
    assert_eq!(
        a.get_user("alice")
            .await
            .unwrap()
            .unwrap()
            .mfa_blocked_until,
        None
    );
    b.record_failed_attempt("alice", last).await.unwrap();
    let blocked = a.get_user("alice").await.unwrap().unwrap();
    assert_eq!(blocked.mfa_attempt_count, ACCOUNT_MAX_FAILED_ATTEMPTS);
    assert_eq!(
        blocked.mfa_blocked_until,
        Some(chrono_to_bson(
            last + Duration::seconds(ACCOUNT_COOLDOWN_SECS)
        ))
    );

    // One millisecond before the window end still counts; the exact end resets.
    let edge = t0() + Duration::seconds(ACCOUNT_ATTEMPT_WINDOW_SECS);
    a.record_failed_attempt("alice", edge - Duration::milliseconds(1))
        .await
        .unwrap();
    assert_eq!(
        a.get_user("alice")
            .await
            .unwrap()
            .unwrap()
            .mfa_attempt_count,
        11
    );
    a.record_failed_attempt("alice", edge).await.unwrap();
    let reset = a.get_user("alice").await.unwrap().unwrap();
    assert_eq!(reset.mfa_attempt_count, 1);
    assert_eq!(reset.mfa_blocked_until, None);
    assert_eq!(
        reset.mfa_attempt_window_started_at,
        Some(chrono_to_bson(edge))
    );

    b.clear_failed_attempts("alice").await.unwrap();
    b.clear_failed_attempts("ghost").await.unwrap();
    let cleared = a.get_user("alice").await.unwrap().unwrap();
    assert_eq!(cleared.mfa_attempt_count, 0);
    assert_eq!(
        (
            cleared.mfa_attempt_window_started_at,
            cleared.mfa_blocked_until
        ),
        (None, None)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn challenge_consumes_once_honors_exact_expiry_and_counts_attempts_atomically() {
    let (_dir, path) = db_path();
    let (a, b) = pair(&path).await;
    a.create_challenge(challenge("c1", "alice", ChallengePurpose::LoginMfa, t0()))
        .await
        .unwrap();
    let expires = t0() + Duration::seconds(CHALLENGE_LIFETIME_SECS);

    assert!(
        !a.consume_challenge("c1", ChallengePurpose::Enroll, t0())
            .await
            .unwrap(),
        "purpose"
    );
    assert!(
        !a.consume_challenge("c1", ChallengePurpose::LoginMfa, expires)
            .await
            .unwrap(),
        "expires_at == now"
    );
    assert!(!a
        .consume_challenge("missing", ChallengePurpose::LoginMfa, t0())
        .await
        .unwrap());

    let mut tasks = Vec::new();
    for i in 0..8 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store
                .consume_challenge(
                    "c1",
                    ChallengePurpose::LoginMfa,
                    expires - Duration::milliseconds(1),
                )
                .await
                .unwrap()
        }));
    }
    let mut wins = 0;
    for task in tasks {
        wins += usize::from(task.await.unwrap());
    }
    assert_eq!(wins, 1, "exactly one consume wins");
    let consumed = b.get_challenge("c1").await.unwrap().unwrap().consumed_at;
    assert_eq!(
        consumed,
        Some(chrono_to_bson(expires - Duration::milliseconds(1)))
    );

    assert_eq!(a.increment_challenge_attempt("absent").await.unwrap(), 0);
    let mut tasks = Vec::new();
    for i in 0..8 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store.increment_challenge_attempt("c1").await.unwrap()
        }));
    }
    let mut seen = Vec::new();
    for task in tasks {
        seen.push(task.await.unwrap());
    }
    seen.sort_unstable();
    assert_eq!(
        seen,
        (1..=8).collect::<Vec<u32>>(),
        "each increment observed once"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn session_step_up_revocation_and_expiry_are_exact_and_single_winner() {
    let (_dir, path) = db_path();
    let (a, b) = pair(&path).await;
    let expires = t0() + Duration::days(30);
    a.create_session(session("s1", "alice", t0(), expires))
        .await
        .unwrap();
    a.create_session(session("s2", "alice", t0(), expires))
        .await
        .unwrap();
    a.create_session(session("s3", "bob", t0(), expires))
        .await
        .unwrap();

    let step_up = t0() + Duration::days(11);
    let mut tasks = Vec::new();
    for i in 0..8 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store.advance_session_mfa("s1", 1, step_up).await.unwrap()
        }));
    }
    let mut winners = Vec::new();
    for task in tasks {
        winners.extend(task.await.unwrap());
    }
    assert_eq!(winners.len(), 1, "exactly one step-up wins");
    assert_eq!(winners[0].credential_version, 2);
    assert_eq!(winners[0].mfa_verified_at, chrono_to_bson(step_up));
    assert_eq!(
        winners[0].expires_at,
        chrono_to_bson(expires),
        "absolute expiry unchanged"
    );
    assert!(
        a.advance_session_mfa("s1", 1, step_up)
            .await
            .unwrap()
            .is_none(),
        "stale version"
    );
    assert!(
        a.advance_session_mfa("s2", 1, expires)
            .await
            .unwrap()
            .is_none(),
        "expires_at == now"
    );
    assert!(a
        .advance_session_mfa("gone", 1, step_up)
        .await
        .unwrap()
        .is_none());

    assert_eq!(b.revoke_user_sessions("alice", step_up).await.unwrap(), 2);
    assert_eq!(b.revoke_user_sessions("alice", step_up).await.unwrap(), 0);
    assert!(!a
        .revoke_session("s1", step_up + Duration::seconds(5))
        .await
        .unwrap());
    assert!(
        a.advance_session_mfa("s2", 1, step_up)
            .await
            .unwrap()
            .is_none(),
        "revoked"
    );
    assert_eq!(
        a.get_session("s1").await.unwrap().unwrap().revoked_at,
        Some(chrono_to_bson(step_up)),
        "first revocation time is kept"
    );
    assert!(a.revoke_session("s3", step_up).await.unwrap());
    assert!(!a.revoke_session("nope", step_up).await.unwrap());
}

#[tokio::test]
async fn expired_rows_are_pruned_in_bounded_batches_on_create_only() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();
    let old_issued = t0() - Duration::days(40);
    for i in 0..300 {
        let id = format!("old{i:03}");
        store
            .create_session(session(
                &id,
                "alice",
                old_issued,
                old_issued + Duration::days(30),
            ))
            .await
            .unwrap();
    }
    let raw = Connection::open(&path).unwrap();
    let count = |table: &str| -> i64 {
        raw.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    };
    // Nothing was expired relative to the issue time of any creator yet.
    assert_eq!(count("auth_sessions"), 300);

    // One create removes at most one batch (256) of expired rows, then inserts.
    store
        .create_session(session("new1", "alice", t0(), t0() + Duration::days(30)))
        .await
        .unwrap();
    assert_eq!(count("auth_sessions"), 300 - 256 + 1);
    store
        .create_session(session("new2", "alice", t0(), t0() + Duration::days(30)))
        .await
        .unwrap();
    assert_eq!(
        count("auth_sessions"),
        2,
        "remaining expired rows go; live rows stay"
    );
    assert!(store.get_session("new1").await.unwrap().is_some());

    let stale = challenge(
        "stale",
        "alice",
        ChallengePurpose::Enroll,
        t0() - Duration::hours(1),
    );
    store.create_challenge(stale).await.unwrap();
    store
        .create_challenge(challenge("fresh", "alice", ChallengePurpose::Enroll, t0()))
        .await
        .unwrap();
    assert!(store.get_challenge("stale").await.unwrap().is_none());
    assert!(store.get_challenge("fresh").await.unwrap().is_some());
}

#[tokio::test]
async fn corrupt_rows_deny_lookup_instead_of_fabricating_records() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();
    for name in ["badrole", "partial", "badcount", "badid"] {
        store.create_user(user(name)).await.unwrap();
    }
    store
        .create_challenge(challenge(
            "badpurpose",
            "alice",
            ChallengePurpose::Enroll,
            t0(),
        ))
        .await
        .unwrap();

    // Simulate hand-edited/corrupt data that bypasses CHECK constraints.
    let raw = Connection::open(&path).unwrap();
    raw.execute_batch(
        "PRAGMA ignore_check_constraints = ON;
         UPDATE auth_users SET role = 'root' WHERE username = 'badrole';
         UPDATE auth_users SET mfa_nonce = 'only-nonce' WHERE username = 'partial';
         UPDATE auth_users SET mfa_attempt_count = -1 WHERE username = 'badcount';
         DROP TRIGGER auth_users_id_immutable;
         UPDATE auth_users SET id = 'zzzzzzzzzzzzzzzzzzzzzzzz' WHERE username = 'badid';
         UPDATE auth_challenges SET purpose = 'admin' WHERE id = 'badpurpose';",
    )
    .unwrap();
    drop(raw);

    for name in ["badrole", "partial", "badcount", "badid"] {
        let err = store.get_user(name).await.unwrap_err();
        assert!(
            matches!(err, StoreError::InconsistentState(_)),
            "{name}: {err:?}"
        );
    }
    let err = store.get_challenge("badpurpose").await.unwrap_err();
    assert!(matches!(err, StoreError::InconsistentState(_)), "{err:?}");
}

#[tokio::test]
async fn newer_schema_and_foreign_databases_are_refused_untouched() {
    let (_dir, path) = db_path();
    drop(AuthStore::open_sqlite(&path).await.unwrap());
    Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 99)
        .unwrap();
    let err = AuthStore::open_sqlite(&path)
        .await
        .err()
        .expect("newer schema must fail");
    assert!(
        matches!(&err, StoreError::Unavailable(m) if m.contains("newer")),
        "{err:?}"
    );

    let foreign = path.with_file_name("other.db");
    Connection::open(&foreign)
        .unwrap()
        .execute_batch("CREATE TABLE notes (body TEXT)")
        .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&foreign, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let err = AuthStore::open_sqlite(&foreign)
        .await
        .err()
        .expect("foreign db must fail");
    assert!(matches!(err, StoreError::Unavailable(_)), "{err:?}");
    let raw = Connection::open(&foreign).unwrap();
    let mode: String = raw
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_ne!(
        mode, "wal",
        "refused foreign database must not be reconfigured"
    );
    let tables: i64 = raw
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
        .unwrap();
    assert_eq!(tables, 1);
}

#[tokio::test]
async fn garbage_file_fails_startup_and_runtime_errors_do_not_authorize() {
    let (_dir, path) = db_path();
    std::fs::write(
        &path,
        b"this is not a sqlite database, just text padding.....",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    assert!(AuthStore::open_sqlite(&path).await.is_err());

    // Dropping a table behind the store's back surfaces as an error, not "no session".
    let (_dir2, path2) = db_path();
    let store = AuthStore::open_sqlite(&path2).await.unwrap();
    Connection::open(&path2)
        .unwrap()
        .execute_batch("DROP TABLE auth_sessions")
        .unwrap();
    assert!(store.get_session("s1").await.is_err());
}

#[cfg(unix)]
mod unix_file_safety {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[tokio::test]
    async fn creates_private_directory_file_and_sidecars() {
        let root = tempdir().unwrap();
        let path = root.path().join("nested/config/auth.db");
        let store = AuthStore::open_sqlite(&path).await.unwrap();
        store.create_user(user("alice")).await.unwrap();

        assert_eq!(mode(path.parent().unwrap()), 0o700);
        assert_eq!(mode(path.parent().unwrap().parent().unwrap()), 0o700);
        assert_eq!(mode(&path), 0o600);
        for suffix in ["-wal", "-shm"] {
            let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
            assert!(sidecar.exists(), "WAL mode must create {suffix} while open");
            assert_eq!(mode(&sidecar), 0o600, "{suffix}");
        }
    }

    #[tokio::test]
    async fn rejects_symlink_open_file_and_unsafe_modes() {
        let (dir, path) = db_path();
        let real = dir.path().join("real.db");
        drop(AuthStore::open_sqlite(&real).await.unwrap());
        symlink(&real, &path).unwrap();
        assert!(
            AuthStore::open_sqlite(&path).await.is_err(),
            "symlink final target"
        );
        std::fs::remove_file(&path).unwrap();

        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o644)).unwrap();
        let err = AuthStore::open_sqlite(&real)
            .await
            .err()
            .expect("0644 must fail");
        assert!(matches!(err, StoreError::Unavailable(_)), "{err:?}");
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(AuthStore::open_sqlite(&real).await.is_ok());

        // A directory as the target is not a regular file.
        let as_dir = dir.path().join("dir.db");
        std::fs::create_dir(&as_dir).unwrap();
        assert!(AuthStore::open_sqlite(&as_dir).await.is_err());

        // A parent others can write could swap the file or its sidecars.
        let open_dir = dir.path().join("open");
        std::fs::create_dir(&open_dir).unwrap();
        std::fs::set_permissions(&open_dir, std::fs::Permissions::from_mode(0o777)).unwrap();
        let err = AuthStore::open_sqlite(open_dir.join("auth.db"))
            .await
            .err()
            .expect("0777 parent");
        assert!(matches!(err, StoreError::Unavailable(_)), "{err:?}");
    }
}
