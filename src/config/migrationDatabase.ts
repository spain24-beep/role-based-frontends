/*
 * MIGRATION DATABASE CONFIGURATION
 *
 * Purpose:
 * Create the dedicated PostgreSQL connection pool used only by migrations.
 * The running application must use the separate restricted application account.
 */

import { Pool, type PoolConfig } from "pg";
import { getDatabasePort } from "./databasePort";

// Require separate credentials for database migrations.
// These credentials must never be used by the running application.
const requiredSettings = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "MIGRATION_DB_USER",
  "MIGRATION_DB_PASSWORD",
] as const;

// Stop immediately if any required setting is missing.
for (const setting of requiredSettings) {
  if (!process.env[setting]) {
    throw new Error(`Missing required migration database setting: ${setting}`);
  }
}

// Define the migration database connection settings.
const migrationConfig: PoolConfig = {
  host: process.env.DB_HOST!,
  port: getDatabasePort(process.env.DB_PORT),
  database: process.env.DB_NAME!,
  user: process.env.MIGRATION_DB_USER!,
  password: process.env.MIGRATION_DB_PASSWORD!,

  // Migrations are sequential, so a small pool is sufficient.
  max: 2,

  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Create a dedicated connection pool for migration operations.
const migrationPool = new Pool(migrationConfig);

// Log unexpected connection errors without exposing credentials.
migrationPool.on("error", (error: Error) => {
  console.error("Unexpected migration database pool error:", error.message);
});

// Export the pool for the migration runner.
export default migrationPool;
