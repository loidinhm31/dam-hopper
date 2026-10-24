//! The same observable store contract runs on real SQLite and, when configured, MongoDB.
use chrono::{Duration, Utc};
use dam_hopper_server::auth::model::{chrono_to_bson, AuthSession};
use dam_hopper_server::auth::session_inventory::{SessionCursor, SESSION_FETCH_LIMIT, SESSION_PAGE_SIZE};
use dam_hopper_server::auth::AuthStore;

fn row(id: &str, username: &str, now: chrono::DateTime<Utc>) -> AuthSession {
    AuthSession {
        id: id.into(), username: username.into(), auth_version: 3, credential_version: 1,
        issued_at: chrono_to_bson(now - Duration::days(12)),
        expires_at: chrono_to_bson(now + Duration::days(18)),
        mfa_verified_at: chrono_to_bson(now - Duration::days(12)),
        revoked_at: None, user_agent: Some("Test client".into()),
    }
}

async fn inventory_contract(store: &AuthStore, independent: &AuthStore) {
    let now = Utc::now();
    // Every row shares a millisecond timestamp: the ID must carry pagination.
    for index in 0..113 {
        store.create_session(row(&format!("own-{index:03}"), "alice", now)).await.unwrap();
    }
    let foreign = row("foreign", "bob", now);
    store.create_session(foreign.clone()).await.unwrap();
    let mut obsolete = row("obsolete", "alice", now);
    obsolete.auth_version = 2;
    store.create_session(obsolete).await.unwrap();
    let mut revoked = row("revoked", "alice", now);
    revoked.revoked_at = Some(chrono_to_bson(now - Duration::minutes(2)));
    store.create_session(revoked).await.unwrap();
    let mut expired = row("expired", "alice", now);
    expired.expires_at = chrono_to_bson(now);
    store.create_session(expired).await.unwrap();

    let mut seen = Vec::new();
    let mut cursor = None;
    loop {
        let mut page = store.list_active_sessions("alice", 3, now, cursor.as_ref()).await.unwrap();
        assert!(page.len() <= SESSION_FETCH_LIMIT);
        let more = page.len() > SESSION_PAGE_SIZE;
        page.truncate(SESSION_PAGE_SIZE);
        for item in &page {
            assert_eq!(item.username, "alice");
            assert_eq!(item.auth_version, 3);
            assert!(item.revoked_at.is_none());
            assert_eq!(item.user_agent.as_deref(), Some("Test client"));
        }
        cursor = page.last().map(SessionCursor::from_session);
        seen.extend(page.into_iter().map(|item| item.id));
        if !more { break; }
    }
    let expected: Vec<_> = (0..113).rev().map(|index| format!("own-{index:03}")).collect();
    assert_eq!(seen, expected, "MFA-due rows remain visible, ties neither skip nor duplicate");
    assert!(store.list_active_sessions("alice", 99, now, None).await.unwrap().is_empty());

    assert!(!store.revoke_owned_session("alice", "foreign", now).await.unwrap());
    assert!(!store.revoke_owned_session("alice", "missing", now).await.unwrap());
    assert_eq!(store.get_session("foreign").await.unwrap(), Some(foreign));
    let (first, second) = tokio::join!(
        store.revoke_owned_session("alice", "own-100", now),
        independent.revoke_owned_session("alice", "own-100", now + Duration::seconds(1)),
    );
    assert!(first.unwrap());
    assert!(second.unwrap());
    let initial = store.get_session("own-100").await.unwrap().unwrap().revoked_at;
    assert!(initial == Some(chrono_to_bson(now)) || initial == Some(chrono_to_bson(now + Duration::seconds(1))));
    assert!(independent.revoke_owned_session("alice", "own-100", now + Duration::hours(1)).await.unwrap());
    assert_eq!(store.get_session("own-100").await.unwrap().unwrap().revoked_at, initial);
    assert!(store.get_session("own-099").await.unwrap().unwrap().revoked_at.is_none());

    // A revoke after page one must be excluded from the next keyset query.
    let mut first = store.list_active_sessions("alice", 3, now, None).await.unwrap();
    first.truncate(SESSION_PAGE_SIZE);
    let cursor = SessionCursor::from_session(first.last().unwrap());
    let before = store.list_active_sessions("alice", 3, now, Some(&cursor)).await.unwrap();
    assert!(before.iter().any(|item| item.id == "own-050"));
    let (listed, revoked) = tokio::join!(
        store.list_active_sessions("alice", 3, now, Some(&cursor)),
        independent.revoke_owned_session("alice", "own-050", now),
    );
    assert!(listed.is_ok());
    let first_revoked_at = store.get_session("revoked").await.unwrap().unwrap().revoked_at;
    assert!(store.revoke_owned_session("alice", "revoked", now).await.unwrap());
    assert_eq!(store.get_session("revoked").await.unwrap().unwrap().revoked_at, first_revoked_at);
    assert!(store.revoke_owned_session("alice", "obsolete", now).await.unwrap());
    assert!(revoked.unwrap());
    let after = store.list_active_sessions("alice", 3, now, Some(&cursor)).await.unwrap();
    assert!(!after.iter().any(|item| item.id == "own-050"));
    assert!(after.iter().all(|item| item.id < cursor.id));
}

#[tokio::test]
async fn sqlite_inventory_and_concurrent_owner_revocation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("auth.db");
    let first = AuthStore::open_sqlite(&path).await.unwrap();
    let second = AuthStore::open_sqlite(&path).await.unwrap();
    inventory_contract(&first, &second).await;
}

#[tokio::test]
async fn mongodb_inventory_and_concurrent_owner_revocation() {
    let Ok(uri) = std::env::var("TEST_MONGODB_URI") else {
        eprintln!("Mongo device inventory not exercised: TEST_MONGODB_URI unset");
        return;
    };
    // A configured qualification backend is mandatory; connection failure is a failure.
    let client = mongodb::Client::with_uri_str(uri).await.unwrap();
    let db = client.database(&format!("test_device_inventory_{}", uuid::Uuid::new_v4().simple()));
    db.run_command(mongodb::bson::doc! { "ping": 1 }).await.unwrap();
    let first = AuthStore::from_mongo(db.clone());
    first.init_indexes().await.unwrap();
    inventory_contract(&first, &AuthStore::from_mongo(db.clone())).await;
    db.drop().await.unwrap();
}
