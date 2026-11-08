// Load environment variables before importing the database pool.
// This ensures the migration database credentials are available.
import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";

// Use the dedicated database account for schema migrations.
import pool from "./migrationDatabase";

// Advisory lock identifiers.
// These prevent two migration processes from running simultaneously.
const LOCK_ID_1 = 20261107;
const LOCK_ID_2 = 1;

// Find SQL migration files and sort them by filename.
// Numeric prefixes determine the execution order.
function getMigrationFiles(): string[] {
  return fs
    .readdirSync(__dirname)
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
}

// Create the migration history table if it doesn't exist.
// This table records which migrations have completed.
async function createMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

// Check whether a migration has already been applied.
async function hasMigrationRun(
  client: PoolClient,
  filename: string,
): Promise<boolean> {
  const result = await client.query(
    "SELECT 1 FROM schema_migrations WHERE filename = $1",
    [filename],
  );

  return (result.rowCount ?? 0) > 0;
}

// Execute one migration and record it in the same transaction.
// If execution fails, the transaction is rolled back.
async function applyMigration(
  client: PoolClient,
  filename: string,
): Promise<void> {
  const migrationPath = path.join(__dirname, filename);
  const sql = fs.readFileSync(migrationPath, "utf8");

  await client.query("BEGIN");

  try {
    await client.query(sql);

    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
      filename,
    ]);

    await client.query("COMMIT");

    console.log(`[MIGRATION] Applied: ${filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Main migration process.
async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // Prevent concurrent migration processes.
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      LOCK_ID_1,
      LOCK_ID_2,
    ]);

    lockAcquired = true;

    await createMigrationTable(client);

    const migrationFiles = getMigrationFiles();

    console.log(`[MIGRATION] Found ${migrationFiles.length} migration files`);

    for (const filename of migrationFiles) {
      if (await hasMigrationRun(client, filename)) {
        console.log(`[MIGRATION] Already applied: ${filename}`);
        continue;
      }

      await applyMigration(client, filename);
    }

    console.log("[MIGRATION] All migrations completed successfully");
  } finally {
    // Release the lock even if a migration fails.
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        LOCK_ID_1,
        LOCK_ID_2,
      ]);
    }

    client.release();
    await pool.end();
  }
}

// Report failures without exposing database credentials.
runMigrations().catch((error: unknown) => {
  if (error instanceof Error) {
    const databaseError = error as Error & { code?: string };

    console.error("[MIGRATION] Failed:", {
      name: error.name,
      code: databaseError.code || "NO_ERROR_CODE",
    });
  } else {
    console.error("[MIGRATION] Failed:", {
      name: "UnknownError",
      code: "NO_ERROR_CODE",
    });
  }

  process.exitCode = 1;
});
