
-- Google Auth Starter application users.
--
-- Each user is identified by Google's stable "sub" identifier.
-- Email is stored in lowercase for consistent comparisons.
-- Multiplier is nullable because a blank spreadsheet value
-- must remain NULL rather than defaulting to 1.00.
--
-- Roles are managed in the database:
-- - admin: application administrator
-- - user: ordinary authorised application user
--
-- The failsafe administrator is initially promoted separately
-- using the ADMIN_EMAIL setting during authentication.

CREATE TABLE IF NOT EXISTS users (

    -- Internal database identifier.
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Google's permanent identifier for this account.
    google_sub TEXT NOT NULL UNIQUE,

    -- Verified Google email address, stored in lowercase.
    email TEXT NOT NULL UNIQUE,

    -- Application role.
    -- New users are ordinary users unless explicitly promoted.
    role TEXT NOT NULL DEFAULT 'user',

    -- User multiplier obtained from the public spreadsheet.
    -- NULL means the spreadsheet has no multiplier value.
    multiplier NUMERIC,

    -- Record creation and modification timestamps.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Most recent successful authentication.
    last_login_at TIMESTAMPTZ
);
