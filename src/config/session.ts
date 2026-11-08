// Import Express session middleware and its type.
import session from "express-session";
import type { RequestHandler } from "express";

// Import the PostgreSQL session store.
// This stores sessions in PostgreSQL instead of server memory.
import connectPgSimple from "connect-pg-simple";

// Import our shared PostgreSQL connection pool.
import pool from "./database";

// Create the PostgreSQL session store constructor.
const PgSession = connectPgSimple(session);

// Read the session secret from .env.
// The secret must never be exposed to the browser or committed to Git.
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 64) {
  throw new Error(
    "SESSION_SECRET must be configured with a sufficiently long secret",
  );
}

// Configure the session middleware.
const sessionMiddleware: RequestHandler = session({
  // Give the browser a specifically named session cookie.
  name: "google_auth_starter.sid",

  // Sign the session cookie using our private secret.
  secret: sessionSecret,

  // Store session data in PostgreSQL, not server memory.
  store: new PgSession({
    pool: pool,

    // The session table is created through a database migration.
    // The application should not need permission to create database tables.
    createTableIfMissing: false,

    // Name the table specifically for this application.
    tableName: "user_sessions",
  }),

  // Do not save a session again if it has not changed.
  resave: false,

  // Do not create sessions for visitors who have not logged in.
  saveUninitialized: false,

  // Configure the browser cookie.
  cookie: {
    // Prevent JavaScript in the browser from reading the cookie.
    httpOnly: true,

    // Use secure cookies in production, where HTTPS is required.
    secure: process.env.NODE_ENV === "production",

    // Send the cookie with ordinary same-site navigation and requests.
    sameSite: "lax",

    // Expire the session after eight hours.
    maxAge: 8 * 60 * 60 * 1000,
  },
});

// Export the middleware for use by the Express application.
export default sessionMiddleware;
