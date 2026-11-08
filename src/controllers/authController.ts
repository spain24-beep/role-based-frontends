/*
 * AUTHENTICATION CONTROLLER
 *
 * Purpose:
 * Handle the HTTP layer for Google authentication, checking the
 * current session, and logging out.
 *
 * The controller is responsible for:
 * - Reading and validating HTTP request data.
 * - Verifying Google ID tokens.
 * - Managing the server-side session.
 * - Returning the API response format.
 *
 * Application authorisation decisions belong in authService.
 * Database queries belong in the user repository.
 *
 * The route layer should only connect HTTP routes to these handlers.
 */

import { type Request, type Response } from "express";

import { OAuth2Client } from "google-auth-library";

import authService from "../services/authService";

// Configure Google's client using the application client ID.
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Validate the complete body of a Google login request.
//
// The browser must send exactly one property: credential.
// It must not be allowed to supply its own user ID, role,
// admin status, or any other authentication-related information.
//
// Using unknown forces us to validate the incoming data before
// treating it as a trusted TypeScript object.
function isGoogleLoginRequest(body: unknown): body is { credential: string } {
  // Reject null, undefined, primitive values, and arrays.
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  // Treat the object as untrusted data until its properties
  // have been checked.
  const record = body as Record<string, unknown>;

  // Require exactly one own property, named credential.
  // This rejects additional fields such as role or userId.
  if (
    Object.keys(record).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(record, "credential")
  ) {
    return false;
  }

  // The credential must be a string containing non-whitespace
  // characters. The original value is retained for Google
  // token verification.
  return (
    typeof record.credential === "string" && record.credential.trim().length > 0
  );
}

// Convert a database role into its corresponding public frontend URL.
//
// Role names must be lowercase URL-friendly identifiers.
// This prevents a role value from being used for path traversal.
//
// The public route is derived directly from the role.
// The physical frontend directory is an internal implementation detail.
function getFrontendUrl(role: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(role)) {
    throw new Error("Invalid role format for frontend routing");
  }

  return `/${role}/`;
}

// Convert express-session's callback API into a Promise.
//
// Authentication must not send its response until the new
// session has actually been created.
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

// Convert express-session's callback API into a Promise.
//
// Saving the session explicitly before responding ensures the
// authenticated session is persisted before the browser continues.
function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

// ---------------------------------------------------------
// POST /api/auth/google
//
// Verify a Google ID token, ask the authentication service
// whether the identity is authorised, create a server-side
// session, and return the authenticated user information.
// ---------------------------------------------------------

async function googleLogin(req: Request, res: Response): Promise<void> {
  try {
    // Validate the entire request body before using any
    // values supplied by the browser.
    if (!isGoogleLoginRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message:
            "Request must contain only a non-empty Google ID token credential",
        },
      });
      return;
    }

    // Only after validation can we safely read the credential.
    const { credential } = req.body;

    // Verify the Google ID token.
    // The audience check ensures the token was issued
    // specifically for this application.
    let ticket;

    try {
      ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (error: unknown) {
      // Log only safe error metadata.
      // Never log the submitted Google token or full
      // verification error details.
      const verificationError = error as {
        name?: string;
        code?: string;
      };

      console.error("Google token verification failed:", {
        name: verificationError.name,
        code: verificationError.code || "NO_ERROR_CODE",
      });

      res.status(401).json({
        success: false,
        error: {
          code: "GOOGLE_AUTHENTICATION_FAILED",
          message: "Google authentication failed",
        },
      });
      return;
    }

    // Extract the identity information verified by Google.
    const payload = ticket.getPayload();

    // Require a valid Google subject and email.
    if (
      !payload ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !payload.email
    ) {
      res.status(401).json({
        success: false,
        error: {
          code: "INVALID_GOOGLE_IDENTITY",
          message: "Google identity information is incomplete",
        },
      });
      return;
    }

    // Only accept accounts whose email Google has verified.
    if (payload.email_verified !== true) {
      res.status(401).json({
        success: false,
        error: {
          code: "UNVERIFIED_EMAIL",
          message: "Google account email is not verified",
        },
      });
      return;
    }

    // The service receives only verified Google identity data.
    // Names are taken from Google's verified token, never from
    // additional fields submitted independently by the browser.
    const result = await authService.authenticateGoogleUser({
      googleSub: payload.sub,
      email: payload.email,
      givenName:
        typeof payload.given_name === "string" ? payload.given_name : null,
      familyName:
        typeof payload.family_name === "string" ? payload.family_name : null,
    });

    // Regenerate the session after successful authentication.
    // This prevents an existing session identifier from being
    // reused across the login boundary.
    await regenerateSession(req);

    // Store only the internal database user ID in the session.
    // The browser never gets to choose its own user ID or role.
    req.session.userId = result.user.id;

    // Persist the session before sending the response.
    await saveSession(req);

    // Log successful authentication without exposing
    // credentials, tokens, or session identifiers.
    console.log(
      `[AUTH] Login successful | User ID: ${result.user.id} | Role: ${result.user.role}`,
    );

    // Return the standard API success envelope.
    return void res.status(200).json({
      success: true,
      data: {
        status: "authenticated",
        role: result.user.role,
        redirectTo: getFrontendUrl(result.user.role),
        isAdmin: result.isAdmin,
        isNewUser: result.isNewUser,

        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.first_name,
          lastName: result.user.last_name,
          role: result.user.role,
          multiplier: result.user.multiplier,
          name: payload.name || null,
          picture: payload.picture || null,
        },
      },
    });
  } catch (error: unknown) {
    // Extract only the properties required for safe logging
    // and mapping known authentication errors.
    const authError = error as {
      name?: string;
      code?: string;
      message?: string;
    };

    // Never expose internal exception messages to the client.
    console.error("Google authentication failed:", {
      name: authError.name,
      code: authError.code || "NO_ERROR_CODE",
    });

    // An account not listed in the Sheet is forbidden.
    if (authError.message === "Your Google account is not authorised") {
      res.status(403).json({
        success: false,
        error: {
          code: "ACCOUNT_NOT_AUTHORISED",
          message: "Your Google account is not authorised",
        },
      });
      return;
    }

    // An email linked to another Google account is a conflict.
    if (authError.message === "Email address is linked to another account") {
      res.status(409).json({
        success: false,
        error: {
          code: "EMAIL_ALREADY_LINKED",
          message: "This email address is already linked to another account",
        },
      });
      return;
    }

    // Any other unexpected authentication failure is treated
    // as an internal server error.
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An internal authentication error occurred",
      },
    });
  }
}

// ---------------------------------------------------------
// GET /api/auth/me
//
// requireAuth retrieves the current user from PostgreSQL and
// attaches it to req.user before this handler runs.
// ---------------------------------------------------------

function getCurrentSession(req: Request, res: Response): void {
  // The authenticated user was attached by requireAuth.
  // The role therefore comes from the current database record.
  const user = req.user;

  // This is a defensive check. Normally requireAuth has
  // already returned 401 before this handler is reached.
  if (!user) {
    res.status(401).json({
      success: false,
      error: {
        code: "NOT_AUTHENTICATED",
        message: "Authentication required",
      },
    });
    return;
  }

  // Return the user's current database-backed details.
  // Names are read from PostgreSQL rather than relying on
  // the Google profile being available on every session check.
  res.status(200).json({
    success: true,
    data: {
      status: "authenticated",
      role: user.role,
      isAdmin: user.role === "admin",

      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        multiplier: user.multiplier,
      },
    },
  });
}

// ---------------------------------------------------------
// POST /api/auth/logout
//
// Destroy the current server-side session and clear the
// corresponding browser cookie.
// ---------------------------------------------------------

function logout(req: Request, res: Response): void {
  // Destroy the PostgreSQL-backed session.
  req.session.destroy((error) => {
    // If session destruction fails, do not report success.
    if (error) {
      console.error("Logout failed:", error.name);

      res.status(500).json({
        success: false,
        error: {
          code: "LOGOUT_FAILED",
          message: "Could not log out",
        },
      });
      return;
    }

    // Clear the browser's session cookie.
    // These attributes match the session configuration.
    res.clearCookie("google_auth_starter.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    // Confirm successful logout using the standard
    // API response envelope.
    res.status(200).json({
      success: true,
      data: {
        status: "logged_out",
      },
    });
  });
}

// Export the HTTP handlers for use by the authentication routes.
const authController = {
  googleLogin,
  getCurrentSession,
  logout,
};

export default authController;
