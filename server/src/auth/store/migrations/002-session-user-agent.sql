-- Existing sessions remain intact and have unknown browser/client metadata.
ALTER TABLE auth_sessions ADD COLUMN user_agent TEXT
    CHECK (user_agent IS NULL OR
        (length(CAST(user_agent AS BLOB)) BETWEEN 1 AND 512));

CREATE INDEX auth_sessions_inventory
    ON auth_sessions (username, auth_version, issued_at_ms DESC, id DESC)
    WHERE revoked_at_ms IS NULL;
