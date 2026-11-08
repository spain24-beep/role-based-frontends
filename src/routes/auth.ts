/*
 * AUTHENTICATION ROUTES
 *
 * Purpose:
 * Define the HTTP endpoints for authentication.
 *
 * Routes are intentionally thin. They connect HTTP paths and
 * middleware to the authentication controller.
 *
 * HTTP handling belongs in the controller.
 * Authentication decisions belong in authService.
 * Database access belongs in repositories.
 */

import express from "express";

import authController from "../controllers/authController";
import requireAuth from "../middleware/requireAuth";

// Create a router for authentication endpoints.
const router = express.Router();

// ---------------------------------------------------------
// POST /api/auth/google
//
// The controller handles Google token verification,
// application authorisation, session creation, and response.
// ---------------------------------------------------------

router.post("/google", authController.googleLogin);

// ---------------------------------------------------------
// GET /api/auth/me
//
// requireAuth verifies the session and retrieves the current
// user from PostgreSQL before the controller runs.
// ---------------------------------------------------------

router.get("/me", requireAuth, authController.getCurrentSession);

// ---------------------------------------------------------
// POST /api/auth/logout
//
// The controller destroys the server-side session and clears
// the browser's session cookie.
// ---------------------------------------------------------

router.post("/logout", authController.logout);

// Export the router so app.ts can mount these endpoints.
export default router;
