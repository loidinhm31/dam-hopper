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

#[tokio::test]
async fn auth_users_id_immutable_trigger_aborts_update() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();
    store.create_user(user("alice")).await.unwrap();
    let original = store.get_user("alice").await.unwrap().unwrap();
    let original_id = original.id.unwrap().to_hex();

    let conn = Connection::open(&path).unwrap();
    let err = conn
        .execute(
            "UPDATE auth_users SET id = '111111111111111111111111' WHERE username = 'alice'",
            [],
        )
        .unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("auth_users.id is immutable"),
        "trigger abort must explain id immutability: {msg}"
    );

    let reloaded = store.get_user("alice").await.unwrap().unwrap();
    assert_eq!(reloaded.id.unwrap().to_hex(), original_id);
}

#[tokio::test]
async fn operator_local_sql_recovery_and_role_management() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();
    let mut u = user("operator_user");
    u.is_enabled = false;
    store.create_user(u).await.unwrap();
    let created = store.get_user("operator_user").await.unwrap().unwrap();
    let user_id = created.id.unwrap().to_hex();
    assert!(!created.is_enabled);
    assert_eq!(created.role, UserRole::User);
    assert_eq!(created.auth_version, 0);

    let conn = Connection::open(&path).unwrap();

    // 1. Operator approval via checked SQL:
    let approved = conn
        .execute(
            "UPDATE auth_users SET is_enabled = 1 WHERE id = ?1 AND is_enabled = 0",
            [&user_id],
        )
        .unwrap();
    assert_eq!(approved, 1, "exactly one row approved");
    let repeat = conn
        .execute(
            "UPDATE auth_users SET is_enabled = 1 WHERE id = ?1 AND is_enabled = 0",
            [&user_id],
        )
        .unwrap();
    assert_eq!(repeat, 0, "idempotent predicate returns 0 rows");

    // 2. Operator role assignment via checked SQL:
    let promoted = conn
        .execute(
            "UPDATE auth_users SET role = 'admin' WHERE id = ?1",
            [&user_id],
        )
        .unwrap();
    assert_eq!(promoted, 1);

    // 3. User enrolls MFA
    assert!(store
        .confirm_enrollment("operator_user", 0, mfa(10))
        .await
        .unwrap());
    let enrolled = store.get_user("operator_user").await.unwrap().unwrap();
    assert!(enrolled.mfa.is_some());

    // 4. Operator recovery: atomic conditional reset using immutable ID and expected auth_version
    let reset = conn
        .execute(
            "UPDATE auth_users \
             SET auth_version = auth_version + 1, \
                 mfa_secret_ciphertext = NULL, \
                 mfa_nonce = NULL, \
                 mfa_key_id = NULL, \
                 mfa_enrolled_at_ms = NULL, \
                 mfa_last_accepted_step = NULL, \
                 mfa_attempt_window_started_at_ms = NULL, \
                 mfa_attempt_count = 0, \
                 mfa_blocked_until_ms = NULL \
             WHERE id = ?1 AND auth_version = ?2",
            rusqlite::params![&user_id, 0],
        )
        .unwrap();
    assert_eq!(reset, 1, "recovery reset successfully updated 1 row");

    // Verify user in store
    let after_reset = store.get_user("operator_user").await.unwrap().unwrap();
    assert!(after_reset.mfa.is_none());
    assert_eq!(after_reset.auth_version, 1);
    assert_eq!(after_reset.role, UserRole::Admin);
    assert!(after_reset.is_enabled);

    // 5. Stale reset predicate returns 0 rows (expected version was 0, now 1)
    let stale_reset = conn
        .execute(
            "UPDATE auth_users \
             SET auth_version = auth_version + 1 \
             WHERE id = ?1 AND auth_version = 0",
            [&user_id],
        )
        .unwrap();
    assert_eq!(stale_reset, 0);
}

#[tokio::test]
async fn schema_strict_constraints_reject_invalid_data() {
    let (_dir, path) = db_path();
    let _store = AuthStore::open_sqlite(&path).await.unwrap();
    let conn = Connection::open(&path).unwrap();

    // Invalid id length (23 chars instead of 24)
    let err = conn.execute(
        "INSERT INTO auth_users (id, username, password_hash, is_enabled, role, auth_version, mfa_attempt_count) \
         VALUES ('12345678901234567890123', 'bad_id', 'h', 1, 'user', 0, 0)",
        [],
    );
    assert!(err.is_err(), "invalid id length must be rejected");

    // Invalid id characters (non-hex uppercase or non-hex char)
    let err = conn.execute(
        "INSERT INTO auth_users (id, username, password_hash, is_enabled, role, auth_version, mfa_attempt_count) \
         VALUES ('12345678901234567890123Z', 'bad_id2', 'h', 1, 'user', 0, 0)",
        [],
    );
    assert!(err.is_err(), "non-hex id must be rejected");

    // Invalid is_enabled value
    let err = conn.execute(
        "INSERT INTO auth_users (id, username, password_hash, is_enabled, role, auth_version, mfa_attempt_count) \
         VALUES ('0123456789abcdef01234567', 'bad_bool', 'h', 2, 'user', 0, 0)",
        [],
    );
    assert!(err.is_err(), "invalid is_enabled must be rejected");

    // Invalid role
    let err = conn.execute(
        "INSERT INTO auth_users (id, username, password_hash, is_enabled, role, auth_version, mfa_attempt_count) \
         VALUES ('0123456789abcdef01234567', 'bad_role', 'h', 1, 'superuser', 0, 0)",
        [],
    );
    assert!(err.is_err(), "invalid role must be rejected");

    // Partial MFA (secret without nonce)
    let err = conn.execute(
        "INSERT INTO auth_users (id, username, password_hash, is_enabled, role, auth_version, mfa_secret_ciphertext, mfa_attempt_count) \
         VALUES ('0123456789abcdef01234567', 'bad_mfa', 'h', 1, 'user', 0, 'secret', 0)",
        [],
    );
    assert!(err.is_err(), "partial MFA factor must be rejected");

    // Invalid challenge purpose
    let err = conn.execute(
        "INSERT INTO auth_challenges (id, username, auth_version, purpose, created_at_ms, expires_at_ms, attempts) \
         VALUES ('ch1', 'alice', 0, 'invalidPurpose', 1000, 2000, 0)",
        [],
    );
    assert!(err.is_err(), "invalid challenge purpose must be rejected");
}

#[tokio::test]
async fn exact_case_sensitive_usernames_are_distinct() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();
    store.create_user(user("UserBob")).await.unwrap();
    store.create_user(user("userbob")).await.unwrap();
    store.create_user(user("USERBOB")).await.unwrap();

    let u1 = store.get_user("UserBob").await.unwrap().unwrap();
    let u2 = store.get_user("userbob").await.unwrap().unwrap();
    let u3 = store.get_user("USERBOB").await.unwrap().unwrap();

    assert_eq!(u1.username, "UserBob");
    assert_eq!(u2.username, "userbob");
    assert_eq!(u3.username, "USERBOB");
    assert_ne!(u1.id, u2.id);
    assert_ne!(u2.id, u3.id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_user_creation_with_same_username_has_one_winner() {
    let (_dir, path) = db_path();
    let (a, b) = pair(&path).await;

    let mut tasks = Vec::new();
    for i in 0..8 {
        let store = if i % 2 == 0 { a.clone() } else { b.clone() };
        tasks.push(tokio::spawn(async move {
            store.create_user(user("concurrent_user")).await
        }));
    }
    let mut wins = 0;
    let mut dups = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(()) => wins += 1,
            Err(StoreError::DuplicateUsername(_)) => dups += 1,
            Err(e) => panic!("unexpected error: {e:?}"),
        }
    }
    assert_eq!(wins, 1, "exactly one creator wins");
    assert_eq!(dups, 7, "all other creators receive DuplicateUsername");
}

#[tokio::test]
async fn injected_clock_exact_deadline_boundary_denials() {
    let (_dir, path) = db_path();
    let store = AuthStore::open_sqlite(&path).await.unwrap();

    // 1. Challenge lifetime boundary (CHALLENGE_LIFETIME_SECS = 300)
    let c_issued = t0();
    let c_expires = c_issued + Duration::seconds(CHALLENGE_LIFETIME_SECS);
    store
        .create_challenge(challenge(
            "c_boundary",
            "alice",
            ChallengePurpose::Enroll,
            c_issued,
        ))
        .await
        .unwrap();

    // 1 ms before deadline: consume succeeds
    assert!(
        store
            .consume_challenge(
                "c_boundary",
                ChallengePurpose::Enroll,
                c_expires - Duration::milliseconds(1),
            )
            .await
            .unwrap(),
        "consume 1ms before deadline must succeed"
    );

    // Fresh challenge for exact deadline check
    store
        .create_challenge(challenge(
            "c_exact",
            "alice",
            ChallengePurpose::Enroll,
            c_issued,
        ))
        .await
        .unwrap();

    // At exact deadline (now == expires_at): consume fails (expires_at > now required)
    assert!(
        !store
            .consume_challenge("c_exact", ChallengePurpose::Enroll, c_expires,)
            .await
            .unwrap(),
        "consume at exact deadline must fail"
    );

    // 2. Session 30-day absolute expiry boundary
    let s_issued = t0();
    let s_expires = s_issued + Duration::days(30);
    store
        .create_session(session("s_boundary", "alice", s_issued, s_expires))
        .await
        .unwrap();

    // 1 ms before 30-day expiry: advance_session_mfa succeeds
    let advanced = store
        .advance_session_mfa("s_boundary", 1, s_expires - Duration::milliseconds(1))
        .await
        .unwrap();
    assert!(advanced.is_some(), "step-up 1ms before expiry must succeed");

    // Fresh session for exact deadline check
    store
        .create_session(session("s_exact", "alice", s_issued, s_expires))
        .await
        .unwrap();

    // At exact expiry (now == expires_at): advance_session_mfa fails
    let advanced_exact = store
        .advance_session_mfa("s_exact", 1, s_expires)
        .await
        .unwrap();
    assert!(
        advanced_exact.is_none(),
        "step-up at exact session expiry must fail"
    );
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
