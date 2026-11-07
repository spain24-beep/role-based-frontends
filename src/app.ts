/*
 * Express application setup.
 *
 * This file configures the application, middleware, API routes
 * and role-protected frontend delivery. It does not start the
 * HTTP server.
 */

import path from "node:path";
import express, { type Request, type Response } from "express";

import sessionMiddleware from "./config/session";
import requireSameOrigin from "./middleware/requireSameOrigin";
import requireAuth from "./middleware/requireAuth";
import authRoutes from "./routes/auth";

const app = express();

const publicDirectory = path.join(__dirname, "../public");
const frontendsDirectory = path.join(publicDirectory, "frontends");

// Extract and validate the role URL parameter.
// Express types allow route parameters to be strings or arrays,
// so this helper ensures that callers receive one safe string.
function getFrontendRole(req: Request): string | null {
    const parameter = req.params.role;

    const role = Array.isArray(parameter)
        ? parameter[0]
        : parameter;

    if (
        typeof role !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(role)
    ) {
        return null;
    }

    return role;
}

// Recognise secure requests when running behind the production proxy.
if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
}

// Parse JSON request bodies.
app.use(express.json());

// Attach session handling before authentication routes.
app.use(sessionMiddleware);

// Protect state-changing requests against cross-origin requests.
app.use(requireSameOrigin);

// Mount authentication endpoints.
app.use("/api/auth", authRoutes);

// Basic health-check endpoint.
app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({
        status: "ok",
        message: "Google Auth Starter API is running"
    });
});

// ---------------------------------------------------------
// ROLE-PROTECTED FRONTEND DELIVERY
//
// Each role has its own frontend directory:
//
// public/frontends/{role}/
//
// Authentication and role checks apply to HTML and assets.
// ---------------------------------------------------------

app.use(
    "/frontends/:role",

    // Retrieve the current user from PostgreSQL.
    requireAuth,

    // Verify that the requested frontend belongs to this user.
    (req, res, next) => {
        const role = getFrontendRole(req);

        if (!role) {
            res.status(404).send("Frontend not found");
            return;
        }

        if (!req.user || req.user.role !== role) {
            res.status(403).send("Access denied");
            return;
        }

        next();
    },

    // Serve files from the directory belonging to the role.
    // index:false allows the SPA fallback below to handle index.html.
    (req, res, next) => {
        const role = getFrontendRole(req);

        if (!role) {
            res.status(404).send("Frontend not found");
            return;
        }

        const frontendDirectory = path.join(
            frontendsDirectory,
            role
        );

        express.static(frontendDirectory, {
            index: false
        })(req, res, next);
    },

    // Serve the role's SPA entry page when no static file matched.
    // This preserves nested client-side routes on browser refresh.
    (req, res, next) => {
        const role = getFrontendRole(req);

        if (!role) {
            res.status(404).send("Frontend not found");
            return;
        }

        const indexFile = path.join(
            frontendsDirectory,
            role,
            "index.html"
        );

        res.sendFile(indexFile, (error) => {
            if (error) {
                next(error);
            }
        });
    }
);

// Serve the public login page and its public assets.
app.use(express.static(publicDirectory));

// Export the application for the server and automated tests.
export default app;
