//! Application E2E preauthenticated admin seed runner.
//!
//! Connects to an isolated test MongoDB, initializes auth collections/indexes,
//! seeds an enabled admin user and valid active session, and signs a V2 JWT
//! bearer token using the fixture server token.
//!
//! Outputs the generated credentials and token as JSON to stdout.

use std::io::{self, Read};
use chrono::Utc;
use clap::Parser;
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::{AUTH_PROTOCOL_VERSION, SESSION_LIFETIME_SECS};
use dam_hopper_server::auth::store::AuthStore;
use serde::{Deserialize, Serialize};

#[derive(Parser, Debug)]
#[command(name = "application_e2e_seed", about = "E2E MongoDB and session seeder")]
struct Args {
    /// MongoDB connection URI (e.g. mongodb://mongo:27017)
    #[arg(long, env = "MONGODB_URI")]
    mongodb_uri: Option<String>,

    /// MongoDB database name
    #[arg(long, env = "MONGODB_DATABASE")]
    database: Option<String>,

    /// Server token / JWT secret
    #[arg(long, env = "SERVER_TOKEN")]
    server_token: Option<String>,

    /// Admin username to seed
    #[arg(long, default_value = "admin")]
    username: String,

    /// Explicit session ID (UUID v4 generated if omitted)
    #[arg(long)]
    session_id: Option<String>,

    /// Read configuration from JSON via stdin
    #[arg(long)]
    stdin: bool,
}

#[derive(Debug, Deserialize)]
struct StdinConfig {
    mongodb_uri: String,
    database: String,
    server_token: String,
    username: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SeedOutput {
    token: String,
    username: String,
    session_id: String,
    database: String,
    expires_at: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let (mongodb_uri, database, server_token, username, session_id) = if args.stdin {
        let mut input = String::new();
        io::stdin().read_to_string(&mut input)?;
        let parsed: StdinConfig = serde_json::from_str(&input)?;
        (
            parsed.mongodb_uri,
            parsed.database,
            parsed.server_token,
            parsed.username.unwrap_or(args.username),
            parsed.session_id.or(args.session_id),
        )
    } else {
        let uri = args
            .mongodb_uri
            .ok_or_else(|| anyhow::anyhow!("Missing --mongodb-uri or MONGODB_URI"))?;
        let db = args
            .database
            .ok_or_else(|| anyhow::anyhow!("Missing --database or MONGODB_DATABASE"))?;
        let token = args
            .server_token
            .ok_or_else(|| anyhow::anyhow!("Missing --server-token or SERVER_TOKEN"))?;
        (uri, db, token, args.username, args.session_id)
    };

    let session_id = session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let server_token = server_token.trim().to_string();

    let client_options = mongodb::options::ClientOptions::parse(&mongodb_uri).await?;
    let client = mongodb::Client::with_options(client_options)?;
    let db = client.database(&database);

    let auth_store = AuthStore::new(db.clone());
    auth_store.init_indexes().await?;

    let now = Utc::now();
    let expires_at = now + chrono::Duration::seconds(SESSION_LIFETIME_SECS);
    let issued_at_bson = chrono_to_bson(now);
    let expires_at_bson = chrono_to_bson(expires_at);
    let mfa_verified_at_bson = chrono_to_bson(now);

    let user = UserRecord {
        id: None,
        username: username.clone(),
        password_hash: "$2b$12$e2e_seeded_admin_hash_placeholder".to_string(),
        is_enabled: true,
        role: UserRole::Admin,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };

    let users_col = db.collection::<UserRecord>("users");
    let _ = users_col
        .delete_many(mongodb::bson::doc! { "username": &username })
        .await;
    users_col.insert_one(user).await?;

    let session = AuthSession {
        id: session_id.clone(),
        username: username.clone(),
        auth_version: 0,
        credential_version: 0,
        issued_at: issued_at_bson,
        expires_at: expires_at_bson,
        mfa_verified_at: mfa_verified_at_bson,
        revoked_at: None,
    };

    let sessions_col = db.collection::<AuthSession>("authSessions");
    let _ = sessions_col
        .delete_many(mongodb::bson::doc! { "_id": &session_id })
        .await;
    sessions_col.insert_one(session).await?;

    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: username.clone(),
        sid: session_id.clone(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    };

    let token = claims.encode(&server_token)?;

    let output = SeedOutput {
        token,
        username,
        session_id,
        database,
        expires_at: expires_at.timestamp() as usize,
    };

    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}
