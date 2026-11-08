/*
 * DATABASE READINESS ROUTE
 *
 * Purpose:
 * Check whether the application can successfully communicate with PostgreSQL.
 *
 * The database pool is injected by the application rather than imported here.
 * This keeps the route independently testable without database credentials.
 */

import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";

export function createReadinessRouter(database: Pick<Pool, "query">) {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      // A minimal query confirms that PostgreSQL is reachable
      // and can execute a statement.
      await database.query("SELECT 1");

      return res.status(200).json({
        success: true,
        data: {
          status: "ready",
          database: "connected",
        },
      });
    } catch (error) {
      // Log only safe diagnostic information.
      // Never return database credentials or connection details.
      const databaseError = error as Error & { code?: string };

      console.error("[READINESS] Database check failed:", {
        name: error instanceof Error ? error.name : "UnknownError",
        code: databaseError.code || "NO_ERROR_CODE",
      });

      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Service is not ready",
        },
      });
    }
  });

  return router;
}
