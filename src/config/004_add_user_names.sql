-- Store the name supplied by Google's verified identity profile.
-- Both fields are nullable because Google may not provide either value,
-- and existing accounts will be populated gradually on subsequent logins.

ALTER TABLE users
  ADD COLUMN first_name TEXT,
  ADD COLUMN last_name TEXT;
