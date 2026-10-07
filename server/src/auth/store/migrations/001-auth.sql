-- Authentication store schema, version 1.
-- Applied once inside an IMMEDIATE transaction by `sqlite.rs`; the caller
-- stamps `application_id` and `user_version`. STRICT tables reject values of
-- the wrong storage class, so a hand-edited or corrupt row cannot decode into
-- a plausible-looking record.

CREATE TABLE auth_users (
    -- Immutable 24-hex lowercase ObjectId (also the operator recovery handle).
    id TEXT PRIMARY KEY
        CHECK (length(id) = 24 AND id NOT GLOB '*[^0-9a-f]*'),
    username TEXT NOT NULL UNIQUE COLLATE BINARY,
    password_hash TEXT NOT NULL,
    is_enabled INTEGER NOT NULL CHECK (is_enabled IN (0, 1)),
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    auth_version INTEGER NOT NULL DEFAULT 0 CHECK (auth_version >= 0),
    -- Confirmed MFA factor: all five columns NULL (not enrolled) or all present.
    mfa_secret_ciphertext TEXT,
    mfa_nonce TEXT,
    mfa_key_id TEXT,
    mfa_enrolled_at_ms INTEGER,
    mfa_last_accepted_step INTEGER,
    mfa_attempt_window_started_at_ms INTEGER,
    mfa_attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (mfa_attempt_count BETWEEN 0 AND 4294967295),
    mfa_blocked_until_ms INTEGER,
    CHECK (
        (mfa_secret_ciphertext IS NULL AND mfa_nonce IS NULL AND mfa_key_id IS NULL
            AND mfa_enrolled_at_ms IS NULL AND mfa_last_accepted_step IS NULL)
        OR
        (mfa_secret_ciphertext IS NOT NULL AND mfa_nonce IS NOT NULL AND mfa_key_id IS NOT NULL
            AND mfa_enrolled_at_ms IS NOT NULL AND mfa_last_accepted_step IS NOT NULL)
    )
) STRICT;

-- The id is the stable handle operators use for recovery; it never changes.
CREATE TRIGGER auth_users_id_immutable
BEFORE UPDATE OF id ON auth_users
BEGIN
    SELECT RAISE(ABORT, 'auth_users.id is immutable');
END;

CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    auth_version INTEGER NOT NULL CHECK (auth_version >= 0),
    credential_version INTEGER NOT NULL CHECK (credential_version >= 0),
    issued_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    mfa_verified_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER
) STRICT;

CREATE INDEX auth_sessions_username ON auth_sessions (username);
CREATE INDEX auth_sessions_expires_at ON auth_sessions (expires_at_ms);

CREATE TABLE auth_challenges (
    -- Hex SHA-256 digest of the client-facing opaque challenge token.
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    auth_version INTEGER NOT NULL CHECK (auth_version >= 0),
    purpose TEXT NOT NULL CHECK (purpose IN ('enroll', 'loginMfa', 'stepUp')),
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4294967295),
    consumed_at_ms INTEGER,
    -- Purpose-specific bindings, retained exactly as the issuing handler wrote them.
    pending_secret_ciphertext TEXT,
    pending_secret_nonce TEXT,
    pending_secret_key_id TEXT,
    session_id TEXT,
    credential_version INTEGER
) STRICT;

CREATE INDEX auth_challenges_username ON auth_challenges (username);
CREATE INDEX auth_challenges_expires_at ON auth_challenges (expires_at_ms);
