/*
 * CENTRAL ERROR HANDLER
 *
 * Purpose:
 * Provide one final place to handle unexpected errors
 * passed through Express middleware and route handlers.
 *
 * Security:
 * Internal exception messages and stack traces are never
 * returned to the client or written to application logs.
 *
 * Express 5 automatically forwards rejected promises from
 * asynchronous route handlers to this error handler.
 *
 * API contract:
 * Errors use { success: false, error: { code, message } }.
 */

import type { ErrorRequestHandler } from "express";

const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  // If response headers have already been sent, Express
  // must finish handling the error itself.
  if (res.headersSent) {
    next(error);
    return;
  }

  // Read an HTTP status from errors that explicitly provide one.
  // Only accept valid client/server error status codes.
  const possibleError = error as {
    status?: number;
    statusCode?: number;
    code?: string;
  };

  const candidateStatus = possibleError?.statusCode ?? possibleError?.status;

  const status =
    typeof candidateStatus === "number" &&
    Number.isInteger(candidateStatus) &&
    candidateStatus >= 400 &&
    candidateStatus <= 599
      ? candidateStatus
      : 500;

  // Map common HTTP statuses to stable machine-readable codes.
  // Clients should use these codes rather than interpreting messages.
  const errorCodes: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "NOT_AUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    429: "TOO_MANY_REQUESTS",
    500: "INTERNAL_SERVER_ERROR",
  };

  // Use safe, predefined messages rather than exposing
  // the original exception message.
  const messages: Record<number, string> = {
    400: "Invalid request",
    401: "Not authenticated",
    403: "Access denied",
    404: "Resource not found",
    409: "Request conflicts with existing data",
    413: "Request is too large",
    415: "Unsupported media type",
    429: "Too many requests",
  };

  const code =
    errorCodes[status] ||
    (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR");

  const message =
    status >= 500
      ? "An internal server error occurred"
      : messages[status] || "Request could not be completed";

  // Log diagnostic metadata only.
  // Do not log raw exception messages, which may contain
  // database details, credentials or other sensitive information.
  console.error("Unhandled application error:", {
    name: error instanceof Error ? error.name : "UnknownError",
    code: possibleError?.code || "NO_ERROR_CODE",
    status,
  });

  // Return a consistent JSON structure for API requests.
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    res.status(status).json({
      success: false,
      error: {
        code,
        message,
      },
    });
    return;
  }

  // Browser-facing requests receive a simple error response.
  res.status(status).send(message);
};

export default errorHandler;
