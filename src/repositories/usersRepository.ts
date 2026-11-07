/*
 * USER REPOSITORY
 *
 * Purpose:
 * Centralise all database queries relating to application users.
 *
 * This layer handles database access only. Authentication decisions
 * belong in the authentication service and route middleware.
 */

import pool from "../config/database";


// A user has exactly one role.
//
// Roles are deliberately represented as strings rather than a fixed
// TypeScript union because the application may define any number of roles.
// The database remains the authoritative source of the user's role.
export type UserRole = string;

// Type representing a user record returned by PostgreSQL.
//
// BIGINT and NUMERIC values are represented as strings by node-postgres
// by default. This avoids losing precision when handling large numbers.
export interface User {
    id: string;
    google_sub: string;
    email: string;
    role: UserRole;
    multiplier: string | null;
    created_at: Date;
    updated_at: Date;
    last_login_at: Date | null;
}


// Find an existing user using Google's stable account identifier.
async function findByGoogleSub(googleSub: string): Promise<User | null> {
    const result = await pool.query<User>(
        `SELECT id, google_sub, email, role, multiplier,
                created_at, updated_at, last_login_at
         FROM users
         WHERE google_sub = $1`,
        [googleSub]
    );

    return result.rows[0] ?? null;
}


// Find an existing user using their email address.
// Normalising the email prevents case differences from causing
// duplicate-account or account-linking problems.
async function findByEmail(email: string): Promise<User | null> {
    const normalisedEmail = email.trim().toLowerCase();

    const result = await pool.query<User>(
        `SELECT id, google_sub, email, role, multiplier,
                created_at, updated_at, last_login_at
         FROM users
         WHERE email = $1`,
        [normalisedEmail]
    );

    return result.rows[0] ?? null;
}


// Find a user using the internal database ID.
// This is used to retrieve the logged-in user from their session.
async function findById(userId: string): Promise<User | null> {
    const result = await pool.query<User>(
        `SELECT id, google_sub, email, role, multiplier,
                created_at, updated_at, last_login_at
         FROM users
         WHERE id = $1`,
        [userId]
    );

    return result.rows[0] ?? null;
}


// Input required when creating a user.
interface CreateUserInput {
    googleSub: string;
    email: string;

    // Accept numbers from the Google Sheet integration,
    // or strings when supplied by another application layer.
    // PostgreSQL stores NUMERIC values and returns them as strings.
    multiplier: string | number | null;

    role?: UserRole;
}


// Create a user after the authentication service has authorised them.
//
// Ordinary users receive the database default role of "user".
// The authentication service can explicitly supply "admin"
// when creating the failsafe administrator.
async function createUser({
    googleSub,
    email,
    multiplier,
    role = "user"
}: CreateUserInput): Promise<User> {
    const normalisedEmail = email.trim().toLowerCase();

    const result = await pool.query<User>(
        `INSERT INTO users (google_sub, email, multiplier, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, google_sub, email, role, multiplier,
                   created_at, updated_at, last_login_at`,
        [googleSub, normalisedEmail, multiplier, role]
    );

    return result.rows[0];
}


// Record a successful login for an existing user.
// Return the current role as well, so authentication can use
// the database's latest permissions.
async function updateLastLogin(userId: string): Promise<User | null> {
    const result = await pool.query<User>(
        `UPDATE users
         SET last_login_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, google_sub, email, role, multiplier,
                   created_at, updated_at, last_login_at`,
        [userId]
    );

    return result.rows[0] ?? null;
}


// Export the repository functions for use by services and routes.
const usersRepository = {
    findByGoogleSub,
    findByEmail,
    findById,
    createUser,
    updateLastLogin
};

export default usersRepository;
