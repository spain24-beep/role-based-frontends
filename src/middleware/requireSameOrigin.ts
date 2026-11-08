/*
 * SAME-ORIGIN SECURITY MIDDLEWARE
 *
 * Purpose:
 * Protect cookie-authenticated endpoints against requests
 * initiated by websites other than our own application.
 *
 * This protects state-changing requests against CSRF
 * (Cross-Site Request Forgery) attacks.
 */

import type { RequestHandler } from "express";

// HTTP methods that must never modify application data.
// These methods do not require an Origin check.
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// Read the permitted application origin from .env.
const configuredOrigin = process.env.APP_ORIGIN;

// Refuse to start if the application origin is missing.
if (!configuredOrigin) {
  throw new Error("APP_ORIGIN must be configured in .env");
}

// Validate and store the permitted application origin.
let allowedOrigin: string;

try {
  // Parse the configured value as a URL.
  const parsedOrigin = new URL(configuredOrigin);

  // Only HTTP and HTTPS origins are permitted.
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }

  // Reject paths, query strings, fragments and credentials.
  if (
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error("APP_ORIGIN must contain only an origin");
  }

  // Store the normalised origin for request comparisons.
  allowedOrigin = parsedOrigin.origin;

  // Require the configured value itself to be canonical.
  if (configuredOrigin !== allowedOrigin) {
    throw new Error("APP_ORIGIN is not in canonical form");
  }
} catch {
  // Stop startup rather than running with an invalid
  // or ambiguous security configuration.
  throw new Error("APP_ORIGIN must be a valid canonical HTTP or HTTPS origin");
}

// ---------------------------------------------------------
// MIDDLEWARE FUNCTION
// ---------------------------------------------------------

// RequestHandler supplies Express's request, response and
// next() types and ensures this function is valid middleware.
const requireSameOrigin: RequestHandler = (req, res, next) => {
  // Safe methods should not change application data.
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  // Read the Origin header supplied by the browser.
  const requestOrigin = req.get("Origin");

  // Reject state-changing requests without an Origin header.
  if (!requestOrigin) {
    return res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Request origin is required",
      },
    });
  }

  // Reject requests originating from another website.
  if (requestOrigin !== allowedOrigin) {
    return res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Request origin not permitted",
      },
    });
  }

  // The request has passed the origin check.
  return next();
};

// Export the middleware for use in app.ts.
export default requireSameOrigin;
