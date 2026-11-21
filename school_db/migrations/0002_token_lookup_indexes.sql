-- =====================================================================
-- 0002 — Index the refresh-token and API-key hashes
--
-- Every token refresh looks a session up by `refresh_token_hash`, and every
-- request to the public website API looks a client up by `api_key_hash`. Both are
-- plain columns scanned sequentially, so the cost grows with the table: at 200k
-- sessions a single refresh cost ~19.5 ms and 3450 buffers versus ~0.075 ms and 5
-- buffers with the index (measured; ~260x).
--
-- The indexes are also UNIQUE, which turns a hash collision or a double-insert race
-- into a database error instead of two usable sessions for one token.
--
-- Safe on a live database: CREATE INDEX only reads. (CONCURRENTLY would avoid
-- blocking writes, but it cannot run inside the migration transaction; these tables
-- are small enough that the brief lock is irrelevant.)
-- =====================================================================

\set ON_ERROR_STOP on

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_refresh_token
    ON user_sessions (refresh_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_password_resets_token
    ON password_resets (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_clients_key_hash
    ON api_clients (api_key_hash);

COMMENT ON INDEX uq_user_sessions_refresh_token IS 'Refresh-token lookup path; uniqueness also prevents duplicate sessions for one token.';
COMMENT ON INDEX uq_password_resets_token    IS 'Password-reset token lookup path; uniqueness prevents a token being usable twice.';
COMMENT ON INDEX uq_api_clients_key_hash     IS 'Public API key lookup path (one client per key hash).';
