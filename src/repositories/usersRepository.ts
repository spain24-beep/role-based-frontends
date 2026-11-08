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

// Roles are strings because deployed frontend directories define
// which roles are available to the application.
export type UserRole = string;

// PostgreSQL BIGINT and NUMERIC values are returned as strings
// by node-postgres to avoid JavaScript precision loss.
export interface User {
  id: string;
  google_sub: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: UserRole;
  multiplier: string | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

// Shared list of database columns returned by user queries.
const USER_COLUMNS = `
  id, google_sub, email, first_name, last_name, role, multiplier,
  created_at, updated_at, last_login_at
`;

// Find a user using Google's stable account identifier.
async function findByGoogleSub(googleSub: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE google_sub = $1`,
    [googleSub],
  );

  return result.rows[0] ?? null;
}

// Find a user using their normalised email address.
async function findByEmail(email: string): Promise<User | null> {
  const normalisedEmail = email.trim().toLowerCase();

  const result = await pool.query<User>(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE email = $1`,
    [normalisedEmail],
  );

  return result.rows[0] ?? null;
}

// Find a user using their internal database ID.
async function findById(userId: string): Promise<User | null> {
  const result = await pool.query<User>(
    `SELECT ${USER_COLUMNS}
     FROM users
     WHERE id = $1`,
    [userId],
  );

  return result.rows[0] ?? null;
}

// Input required when creating a user.
interface CreateUserInput {
  googleSub: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  multiplier: string | number | null;
  role?: UserRole;
}

// Create a user after the authentication service has authorised them.
//
// Google names are saved only during account creation. Subsequent
// Google logins do not overwrite administrator-edited names.
async function createUser({
  googleSub,
  email,
  firstName,
  lastName,
  multiplier,
  role = "user",
}: CreateUserInput): Promise<User> {
  const normalisedEmail = email.trim().toLowerCase();
  const normalisedFirstName = firstName?.trim() || null;
  const normalisedLastName = lastName?.trim() || null;

  const result = await pool.query<User>(
    `INSERT INTO users (
       google_sub, email, first_name, last_name, multiplier, role
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${USER_COLUMNS}`,
    [
      googleSub,
      normalisedEmail,
      normalisedFirstName,
      normalisedLastName,
      multiplier,
      role,
    ],
  );

  return result.rows[0];
}

// Record a successful login without changing names or multiplier.
async function updateLastLogin(userId: string): Promise<User | null> {
  const result = await pool.query<User>(
    `UPDATE users
     SET last_login_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId],
  );

  return result.rows[0] ?? null;
}

// Change the database role of an existing user.
// Permission checks belong in the administrator route.
async function updateRole(
  userId: string,
  role: UserRole,
): Promise<User | null> {
  const result = await pool.query<User>(
    `UPDATE users
     SET role = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, role],
  );

  return result.rows[0] ?? null;
}

// Input required when an administrator edits a user's names.
interface UpdateNamesInput {
  firstName: string;
  lastName: string;
}

// Update both names as one database operation.
// Blank values are stored as NULL rather than empty strings.
async function updateNames(
  userId: string,
  { firstName, lastName }: UpdateNamesInput,
): Promise<User | null> {
  const normalisedFirstName = firstName.trim() || null;
  const normalisedLastName = lastName.trim() || null;

  const result = await pool.query<User>(
    `UPDATE users
     SET first_name = $2,
         last_name = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, normalisedFirstName, normalisedLastName],
  );

  return result.rows[0] ?? null;
}

// Update the multiplier independently of the user's other details.
// A null value means that no multiplier is assigned.
async function updateMultiplier(
  userId: string,
  multiplier: string | null,
): Promise<User | null> {
  const result = await pool.query<User>(
    `UPDATE users
     SET multiplier = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [userId, multiplier],
  );

  return result.rows[0] ?? null;
}

// Options for listing users.
interface ListUsersOptions {
  limit: number;
  offset: number;
  role?: UserRole;
  search?: string;
}

// Result of a paginated user listing.
interface ListUsersResult {
  users: User[];
  total: number;
  totalAccounts: number;
}

// Retrieve a filtered, paginated list of users.
async function listUsers({
  limit,
  offset,
  role,
  search,
}: ListUsersOptions): Promise<ListUsersResult> {
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  // Apply an exact role filter when requested.
  if (role) {
    values.push(role);
    conditions.push(`role = $${values.length}`);
  }

  // Search email addresses without case sensitivity.
  if (search && search.trim()) {
    values.push(`%${search.trim()}%`);
    conditions.push(`email ILIKE $${values.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count records matching the active filters.
  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM users
     ${whereClause}`,
    values,
  );

  // Count all registered accounts independently of the filters.
  const totalAccountsResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM users`,
  );

  // Add pagination values after any filter parameters.
  const paginationValues = [...values, limit, offset];

  const usersResult = await pool.query<User>(
    `SELECT ${USER_COLUMNS}
     FROM users
     ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    paginationValues,
  );

  return {
    users: usersResult.rows,
    total: Number(countResult.rows[0].total),
    totalAccounts: Number(totalAccountsResult.rows[0].total),
  };
}

// Export the repository functions for use by other application layers.
const usersRepository = {
  findByGoogleSub,
  findByEmail,
  findById,
  createUser,
  updateLastLogin,
  updateRole,
  updateNames,
  updateMultiplier,
  listUsers,
};

export default usersRepository;