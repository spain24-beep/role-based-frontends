/*
 * AUTHENTICATION ROUTES
 *
 * Purpose:
 * Provide the HTTP endpoints for Google authentication,
 * checking the current session, and logging out.
 *
 * Google verifies the identity. The authentication service
 * checks application authorisation. The session stores only
 * the internal database user ID.
 */

import express, {
    type Request,
    type Response
} from "express";

import { OAuth2Client } from "google-auth-library";

import authService from "../services/authService";
import requireAuth from "../middleware/requireAuth";


// Create a router for authentication endpoints.
const router = express.Router();


// Configure Google's client using our application client ID.
const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
);

// Convert a database role into its corresponding frontend URL.
//
// Role names must be lowercase URL-friendly identifiers.
// This prevents a role value from being used for path traversal.
function getFrontendUrl(role: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(role)) {
        throw new Error("Invalid role format for frontend routing");
    }

    return `/frontends/${role}/`;
}


// ---------------------------------------------------------
// POST /api/auth/google
//
// Receives a Google ID token, verifies it, checks whether
// the account is authorised, and creates a server session.
// ---------------------------------------------------------

router.post("/google", async (req: Request, res: Response) => {
    try {

        // Read the Google credential sent by the browser.
        const { credential } = req.body;

        // Reject missing or incorrectly formatted credentials.
        if (!credential || typeof credential !== "string") {
            return res.status(400).json({
                error: "Google ID token is required"
            });
        }

        // Verify the Google ID token.
        // The audience check ensures it was issued specifically for our app.
        //
        // Keep this verification in its own try/catch.
        // If Google rejects the token, the correct response is HTTP 401.
        let ticket;

        try {
            ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID
            });
        } catch (error: unknown) {

            // Log only safe error metadata.
            // Never log the submitted token or the full error message.
            const verificationError = error as {
                name?: string;
                code?: string;
            };

            console.error(
                "Google token verification failed:",
                {
                    name: verificationError.name,
                    code: verificationError.code || "NO_ERROR_CODE"
                }
            );

            return res.status(401).json({
                error: "Google authentication failed"
            });
        }

        // Extract the verified identity information.
        const payload = ticket.getPayload();

        // Require a valid Google subject and email.
        if (
            !payload ||
            typeof payload.sub !== "string" ||
            !payload.sub ||
            typeof payload.email !== "string" ||
            !payload.email
        ) {
            return res.status(401).json({
                error: "Google identity information is incomplete"
            });
        }

        // Only accept accounts whose email Google has verified.
        if (payload.email_verified !== true) {
            return res.status(401).json({
                error: "Google account email is not verified"
            });
        }

        // Ask the authentication service to check whether
        // this Google account is allowed to use the application.
        const result = await authService.authenticateGoogleUser({
            googleSub: payload.sub,
            email: payload.email
        });

        // Regenerate the session after authentication.
        // This prevents an existing session identifier from
        // being reused across the login boundary.
        await new Promise<void>((resolve, reject) => {
            req.session.regenerate((error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        // Store only the internal user ID in the session.
        // The browser never gets to choose its own user ID or role.
        req.session.userId = result.user.id;

        // Explicitly save the session before responding.
        await new Promise<void>((resolve, reject) => {
            req.session.save((error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        // Log successful authentication on the server.
        // Never log the session cookie or Google ID token.
        console.log(
            `[AUTH] Login successful | User ID: ${result.user.id} | Role: ${result.user.role}`
        );

        // Return the verified identity and database permissions.
        return res.status(200).json({
            status: "authenticated",
            role: result.user.role,
            redirectTo: getFrontendUrl(result.user.role),
            isAdmin: result.isAdmin,
            isNewUser: result.isNewUser,

            user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
                multiplier: result.user.multiplier,
                name: payload.name || null,
                picture: payload.picture || null
            }
        });

    } catch (error: unknown) {

        // Extract only the properties needed for safe logging
        // and mapping known authentication errors to HTTP responses.
        const authError = error as {
            name?: string;
            code?: string;
            message?: string;
        };

        // Never expose internal error messages or sensitive information.
        console.error(
            "Google authentication failed:",
            {
                name: authError.name,
                code: authError.code || "NO_ERROR_CODE"
            }
        );

        // An account not listed in the Sheet is forbidden.
        if (authError.message === "Your Google account is not authorised") {
            return res.status(403).json({
                error: "Your Google account is not authorised"
            });
        }

        // An email linked to another Google account is a conflict.
        if (authError.message === "Email address is linked to another account") {
            return res.status(409).json({
                error: "This email address is already linked to another account"
            });
        }

        // Any other error is treated as an internal failure.
        return res.status(500).json({
            error: "An internal authentication error occurred"
        });
    }
});


// ---------------------------------------------------------
// GET /api/auth/me
//
// requireAuth verifies the session and retrieves the latest
// user record from PostgreSQL before this handler runs.
// ---------------------------------------------------------

router.get("/me", requireAuth, (req: Request, res: Response) => {

    // The authenticated user was attached to req.user
    // by requireAuth. Its role comes directly from PostgreSQL.
    const user = req.user;

    // Return an unauthenticated response if middleware
    // did not attach a user for any reason.
    if (!user) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    // Return the user's current database details.
    return res.status(200).json({
        status: "authenticated",
        role: user.role,
        isAdmin: user.role === "admin",

        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            multiplier: user.multiplier
        }
    });
});


// ---------------------------------------------------------
// POST /api/auth/logout
//
// Destroys the current server-side session and clears
// the corresponding browser cookie.
// ---------------------------------------------------------

router.post("/logout", (req: Request, res: Response) => {

    // Destroy the session stored in PostgreSQL.
    req.session.destroy((error) => {

        // If session destruction fails, report an internal error.
        if (error) {
            console.error(
                "Logout failed:",
                error.message
            );

            return res.status(500).json({
                error: "Could not log out"
            });
        }

        // Clear the browser's session cookie.
        // These attributes match our session configuration.
        res.clearCookie("google_auth_starter.sid", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/"
        });

        // Confirm that logout succeeded.
        return res.status(200).json({
            status: "logged_out"
        });
    });
});


// Export the router so app.ts can mount these endpoints.
export default router;
