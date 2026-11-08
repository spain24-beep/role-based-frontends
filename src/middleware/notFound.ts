/*
 * CENTRAL 404 HANDLER
 *
 * Purpose:
 * Handle requests that do not match any registered route
 * or public static file.
 *
 * API requests receive a consistent JSON error response.
 * Non-API requests receive a simple text response.
 */

import type { RequestHandler } from "express";

const notFound: RequestHandler = (req, res) => {
  // Use a JSON response for API clients.
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
      },
    });
    return;
  }

  // Keep browser-facing 404 responses simple.
  res.status(404).send("Page not found");
};

export default notFound;
