
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
 */

import type { RequestHandler } from "express";
import usersRepository from "../repositories/usersRepository";

// Determine whether the request is asking for an HTML page.
//
// Browser document navigations normally identify themselves through
// Sec-Fetch-Dest: document. The Accept header provides a fallback
// for browsers or clients that do not send the Fetch Metadata header.
//
// Static assets such as JavaScript, CSS and images are not documents,
// so they must receive an authentication error rather than login HTML.
function isDocumentRequest(
    headers: Record<string, string | string[] | undefined>
): boolean {
    const fetchDestination = headers["sec-fetch-dest"];

    if (typeof fetchDestination === "string") {
        return fetchDestination.toLowerCase() === "document";
    }

    const accept = headers.accept || "";

    return (
        typeof accept === "string" &&
        accept.includes("text/html")
    );
}

// Define the middleware using Express's RequestHandler type.
// The shared Express declarations provide req.user and req.session.userId.
const requireAuth: RequestHandler = async (req, res, next) => {
    try {

        // Check whether the request has an authenticated user session.
        if (!req.session.userId) {

            // Redirect only browser requests for HTML documents.
            // This sends unauthenticated visitors to the public login page
            // without returning login HTML to JavaScript or CSS requests.
            if (
                req.originalUrl.startsWith("/frontends/") &&
                isDocumentRequest(req.headers)
            ) {
                res.redirect(302, "/");
                return;
            }

            // API requests and frontend asset requests need a
            // machine-readable authentication error.
            res.status(401).json({
                error: "Not authenticated"
            });
            return;
        }

        // Retrieve the latest user record from PostgreSQL.
        // This also ensures that the account still exists.
        const user = await usersRepository.findById(
            req.session.userId
        );

        // If the user no longer exists, the session is invalid.
        if (!user) {

            // Destroy the invalid server-side session.
            req.session.destroy((error) => {

                if (error) {
                    console.error(
                        "Invalid session cleanup failed:",
                        error.message
                    );

                    res.status(500).json({
                        error: "Could not verify authentication"
                    });
                    return;
                }

                // Clear the corresponding browser cookie.
                res.clearCookie("google_auth_starter.sid", {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production",
                    sameSite: "lax",
                    path: "/"
                });

                // Apply the same document-versus-asset distinction
                // when the session exists but its user no longer does.
                if (
                    req.originalUrl.startsWith("/frontends/") &&
                    isDocumentRequest(req.headers)
                ) {
                    res.redirect(302, "/");
                    return;
                }

                res.status(401).json({
                    error: "Not authenticated"
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
        const databaseError = error instanceof Error
            ? error as Error & { code?: string }
            : null;

        console.error(
            "Authentication middleware failed:",
            {
                name: error instanceof Error ? error.name : "UnknownError",
                code: databaseError?.code || "NO_ERROR_CODE"
            }
        );

        res.status(500).json({
            error: "Could not verify authentication"
        });
    }
};

// Export the middleware for use by protected routes.
export default requireAuth;
