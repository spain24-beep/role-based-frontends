/*
 * REQUIRE ROLE MIDDLEWARE
 *
 * Purpose:
 * Restrict access to routes based on the user's database role.
 *
 * IMPORTANT:
 * This middleware must run AFTER requireAuth.
 * requireAuth retrieves the current user from PostgreSQL
 * and attaches that record to req.user.
 *
 * API contract:
 * Errors use { success: false, error: { code, message } }.
 */

import type { RequestHandler } from "express";
import type { UserRole } from "../repositories/usersRepository";

// Middleware factory: the route specifies which role is required.
function requireRole(requiredRole: UserRole): RequestHandler {
  // Return an Express middleware function.
  return (req, res, next) => {
    // Check that authentication middleware has already
    // retrieved the user record.
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: "NOT_AUTHENTICATED",
          message: "Not authenticated",
        },
      });
      return;
    }

    // Compare the user's current database role
    // with the role required by this route.
    if (req.user.role !== requiredRole) {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to access this resource",
        },
      });
      return;
    }

    // The user has the required role.
    next();
  };
}

// Export the middleware factory.
export default requireRole;
