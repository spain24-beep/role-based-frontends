-- Add a role to every application user if the column does not exist.
--
-- Existing users become ordinary users by default.
-- The role is stored as text so each deployment can define its own roles.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
