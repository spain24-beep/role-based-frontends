/*
 * Express application setup.
 *
 * This file configures the application, middleware, API routes,
 * role-protected frontend delivery and central error handling.
 * It does not start the HTTP server.
 */

import path from "node:path";
import express, { type Request, type Response } from "express";

import sessionMiddleware from "./config/session";
import requireSameOrigin from "./middleware/requireSameOrigin";
import requireAuth from "./middleware/requireAuth";
import usersRepository from "./repositories/usersRepository";
import authRoutes from "./routes/auth";
import configRoutes from "./routes/config";
import requireRole from "./middleware/requireRole";
import adminUsersRoutes from "./routes/adminUsers";
import notFound from "./middleware/notFound";
import errorHandler from "./middleware/errorHandler";
import { createReadinessRouter } from "./routes/health";
import pool from "./config/database";
import {
  getFrontendRoles,
  hasFrontendRole,
} from "./utils/frontendRoles";

const app = express();

const publicDirectory = path.join(__dirname, "../public");
const frontendsDirectory = path.join(publicDirectory, "frontends");

// Discover the deployed frontend roles when the application starts.
// Each discovered role receives a public route at /{role}/.
// The physical frontend files remain in public/frontends/{role}/.
const frontendRoles = getFrontendRoles();

// Recognise secure requests when running behind the production proxy.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Parse JSON request bodies.
app.use(express.json());

// Public configuration does not require a login session.
app.use("/api/config", configRoutes);

// Attach session handling before authentication routes.
app.use(sessionMiddleware);

// Protect state-changing requests against cross-origin requests.
app.use(requireSameOrigin);

// Mount authentication endpoints.
app.use("/api/auth", authRoutes);

// Administrator-only user-management endpoints.
// Authentication must run before the role check.
app.use(
  "/api/admin/users",
  requireAuth,
  requireRole("admin"),
  adminUsersRoutes,
);

// Basic health-check endpoint.
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      message: "Disbursements API is running",
    },
  });
});

// Readiness endpoint checks whether required infrastructure is available.
app.use("/health/ready", createReadinessRouter(pool));

// ---------------------------------------------------------
// ROOT ENTRY ROUTE
//
// The root URL is the application's entry point.
//
// Unauthenticated visitors continue to the public login page.
// Authenticated visitors are redirected to their assigned
// frontend, using the latest role retrieved from PostgreSQL.
// ---------------------------------------------------------

app.get("/", async (req, res, next) => {
  // No session means this is a normal visitor.
  // Continue to the public static login page below.
  if (!req.session.userId) {
    next();
    return;
  }

  try {
    // Retrieve the current database record.
    // Never trust a role stored in the browser or session.
    const user = await usersRepository.findById(req.session.userId);

    // A session whose user no longer exists is invalid.
    if (!user) {
      req.session.destroy((error) => {
        if (error) {
          next(error);
          return;
        }

        // Remove the invalid session cookie.
        res.clearCookie("google_auth_starter.sid", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
        });

        // Continue to the public login page.
        next();
      });

      return;
    }

    // Only redirect to a role that has a deployed frontend.
    // hasFrontendRole also validates the role name.
    if (!hasFrontendRole(user.role)) {
      res.status(403).send(
        "Your account does not currently have an available workspace.",
      );
      return;
    }

    // Redirect using the current database-assigned role.
    res.redirect(302, `/${user.role}/`);
  } catch (error) {
    // Let the central error handler process unexpected failures.
    next(error);
  }
});

// ---------------------------------------------------------
// ROLE-PROTECTED FRONTEND DELIVERY
//
// Public URLs:
// /admin/
// /user/
// /dummy1/
//
// Physical directories:
// public/frontends/admin/
// public/frontends/user/
// public/frontends/dummy1/
//
// The directory structure is the source of truth for available
// frontend roles. Authentication and role checks apply to both
// HTML pages and their associated static assets.
// ---------------------------------------------------------

for (const role of frontendRoles) {
  app.use(
    `/${role}`,

    // Retrieve the current user and role from PostgreSQL.
    requireAuth,

    // Verify that the requested frontend belongs to this user.
    (req, res, next) => {
      if (!req.user) {
        res.status(401).send("Not authenticated");
        return;
      }

      if (req.user.role !== role) {
        // A changed database role should take effect on the
        // next page navigation. Only browser document requests
        // are redirected; asset requests remain forbidden.
        const assignedRole = req.user.role;

        // Accept only a safe role segment, then verify that its
        // frontend entry page actually exists before redirecting.
        const assignedRoleIsSafe =
          typeof assignedRole === "string" &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignedRole);

        const fetchDestination = req.get("sec-fetch-dest");

        const isDocumentRequest = fetchDestination
          ? fetchDestination.toLowerCase() === "document"
          : (req.get("accept") || "").includes("text/html");

        if (
          isDocumentRequest &&
          assignedRoleIsSafe &&
          hasFrontendRole(assignedRole)
        ) {
          // The destination comes only from the current database
          // user record, never from a browser-supplied redirect URL.
          res.redirect(302, `/${assignedRole}/`);
          return;
        }

        // Fail closed for assets, invalid roles and roles without
        // a deployed frontend.
        res.status(403).send("Access denied");
        return;
      }

      next();
    },

    // Serve files from the physical directory belonging to this role.
    // index:false allows the SPA fallback below to handle index.html.
    express.static(path.join(frontendsDirectory, role), {
      index: false,
    }),

    // Serve the role's SPA entry page when no static file matched.
    // This also preserves nested client-side routes on browser refresh.
    (req, res, next) => {
      const indexFile = path.join(
        frontendsDirectory,
        role,
        "index.html",
      );

      res.sendFile(indexFile, (error) => {
        if (error) {
          next(error);
        }
      });
    },
  );
}

// The physical directory name is not a public route.
// Explicitly block requests using the old /frontends/... URL.
app.use("/frontends", (req, res) => {
  res.status(404).send("Not found");
});

// Serve the public login page and its public assets.
// This comes after the protected frontend routes and old-path block.
app.use(express.static(publicDirectory));

// ---------------------------------------------------------
// CENTRAL ERROR HANDLING
//
// These handlers must remain after all routes and static
// file middleware so that unmatched requests and forwarded
// errors reach the correct handler.
// ---------------------------------------------------------

// Handle requests that did not match any route or static file.
app.use(notFound);

// Handle errors forwarded by middleware and route handlers.
// This must always be the final middleware.
app.use(errorHandler);

// Export the application for the server and automated tests.
export default app;
