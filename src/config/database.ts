/*
 * APPLICATION DATABASE CONFIGURATION
 *
 * Purpose:
 * Create the PostgreSQL connection pool used by the running application.
 * This pool uses the restricted application database account, not the
 * separate account reserved for schema migrations.
 */

import { Pool, type PoolConfig } from "pg";
import { getDatabasePort } from "./databasePort";

// Check that all required database settings are present.
const requiredSettings = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
] as const;

for (const setting of requiredSettings) {
  if (!process.env[setting]) {
    throw new Error(`Missing required database setting: ${setting}`);
  }
}

// Build a typed configuration object.
// The port is validated before PostgreSQL receives the configuration.
const databaseConfig: PoolConfig = {
  host: process.env.DB_HOST!,
  port: getDatabasePort(process.env.DB_PORT),
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

// Create the shared PostgreSQL connection pool.
const pool = new Pool(databaseConfig);

// Log unexpected errors without exposing connection details.
pool.on("error", (error: Error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

// Export the pool for use by repositories and services.
export default pool;
