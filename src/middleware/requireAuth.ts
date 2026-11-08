/*
 * REQUIRE AUTHENTICATION MIDDLEWARE
 *
 * Purpose:
 * Protect routes so only authenticated users can access them.
 *
 * How it works:
 * 1. Check whether the session contains a user ID.
 * 2. Retrieve that user from PostgreSQL.
 * 3. Attach the current user record to req.user.
 * 4. Allow the request to continue.
 *
 * Important security decision:
 * We retrieve the user and their role from PostgreSQL rather
 * than trusting information stored in the browser or relying
 * on a role saved in the session.
 *
 * API contract:
 * Errors use { success: false, error: { code, message } }.
 */

import type { Request, RequestHandler } from "express";
import usersRepository from "../repositories/usersRepository";
import { getFrontendRoles } from "../utils/frontendRoles";

// Discover the available frontend roles.
// These are also the routes on which unauthenticated browser
// document requests should be redirected to the login page.
const frontendRoles = new Set(getFrontendRoles());

// Determine whether the request is asking for an HTML page.
//
// Browser document navigations normally identify themselves through
// Sec-Fetch-Dest: document. The Accept header provides a fallback
// for browsers or clients that do not send the Fetch Metadata header.
//
// Static assets such as JavaScript, CSS and images are not documents,
// so they must receive an authentication error rather than login HTML.
function isDocumentRequest(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const fetchDestination = headers["sec-fetch-dest"];

  if (typeof fetchDestination === "string") {
    return fetchDestination.toLowerCase() === "document";
  }

  const accept = headers.accept || "";

  return typeof accept === "string" && accept.includes("text/html");
}

// Determine whether this middleware is running inside a deployed
// role-specific frontend route.
//
// Express sets req.baseUrl to the path on which this middleware
// was mounted. We compare its first path segment with the dynamically
// discovered frontend roles rather than hardcoding any role names.
//
// This prevents API requests from being redirected to the login page.
function isFrontendRoute(req: Request): boolean {
  // Express supplies baseUrl for mounted routes.
  // The fallback also supports isolated middleware tests where
  // the request is simulated rather than created by Express.
  const baseUrl = typeof req.baseUrl === "string"
    ? req.baseUrl
    : "";

  const firstPathSegment = baseUrl
    .split("/")
    .filter(Boolean)[0];

  return typeof firstPathSegment === "string" &&
    frontendRoles.has(firstPathSegment);
}

// Define the middleware using Express's RequestHandler type.
// The shared Express declarations provide req.user and req.session.userId.
const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    // Check whether the request has an authenticated user session.
    if (!req.session.userId) {
      // Redirect only browser document requests on a deployed
      // frontend route. API and asset requests receive JSON errors.
      if (isFrontendRoute(req) && isDocumentRequest(req.headers)) {
        res.redirect(302, "/");
        return;
      }

      res.status(401).json({
        success: false,
        error: {
          code: "NOT_AUTHENTICATED",
          message: "Not authenticated",
        },
      });
      return;
    }

    // Retrieve the latest user record from PostgreSQL.
    // This also ensures that the account still exists.
    const user = await usersRepository.findById(req.session.userId);

    // If the user no longer exists, the session is invalid.
    if (!user) {
      // Destroy the invalid server-side session.
      req.session.destroy((error) => {
        if (error) {
          console.error("Invalid session cleanup failed:", error.name);

          res.status(500).json({
            success: false,
            error: {
              code: "AUTHENTICATION_VERIFICATION_FAILED",
              message: "Could not verify authentication",
            },
          });
          return;
        }

        // Clear the corresponding browser cookie.
        res.clearCookie("google_auth_starter.sid", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });

        // Apply the same document-versus-asset distinction
        // when the session exists but its user no longer does.
        if (isFrontendRoute(req) && isDocumentRequest(req.headers)) {
          res.redirect(302, "/");
          return;
        }

        res.status(401).json({
          success: false,
          error: {
            code: "NOT_AUTHENTICATED",
            message: "Not authenticated",
          },
        });
      });

      return;
    }

    // Attach the current database record to the request.
    // Subsequent middleware and route handlers can now use
    // req.user.id, req.user.email and req.user.role.
    req.user = user;

    // Authentication succeeded.
    // Continue to the next middleware or route handler.
    next();
  } catch (error: unknown) {
    // Log only safe diagnostic information.
    // Do not expose database details to the browser.
    const databaseError =
      error instanceof Error ? (error as Error & { code?: string }) : null;

    console.error("Authentication middleware failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: databaseError?.code || "NO_ERROR_CODE",
    });

    res.status(500).json({
      success: false,
      error: {
        code: "AUTHENTICATION_VERIFICATION_FAILED",
        message: "Could not verify authentication",
      },
    });
  }
};

// Export the middleware for use by protected routes.
export default requireAuth;
