/*
 * CENTRAL ERROR HANDLING TESTS
 *
 * Purpose:
 * Verify that unknown routes and unexpected errors receive
 * the correct HTTP status and response format.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const notFound = require("../dist/middleware/notFound").default;
const errorHandler = require("../dist/middleware/errorHandler").default;

// ---------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------

function createMockRequest(path) {
  return { path };
}

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },

    send(data) {
      this.body = data;
      return this;
    },
  };
}

// ---------------------------------------------------------
// TEST 1: UNKNOWN API ROUTE
//
// Unknown API endpoints should return the standard JSON
// error structure with HTTP 404.
// ---------------------------------------------------------

test("unknown API route returns standard JSON 404", () => {
  const req = createMockRequest("/api/unknown");
  const res = createMockResponse();

  notFound(req, res);

  assert.equal(res.statusCode, 404);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Resource not found",
    },
  });
});

// ---------------------------------------------------------
// TEST 2: UNKNOWN BROWSER ROUTE
//
// Unknown browser pages should return a simple HTTP 404.
// ---------------------------------------------------------

test("unknown browser route returns HTTP 404", () => {
  const req = createMockRequest("/unknown-page");
  const res = createMockResponse();

  notFound(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body, "Page not found");
});

// ---------------------------------------------------------
// TEST 3: UNEXPECTED API ERROR
//
// Unexpected internal errors should return HTTP 500
// without exposing internal exception details.
// ---------------------------------------------------------

test("unexpected API error returns a safe JSON 500", () => {
  const req = createMockRequest("/api/example");
  const res = createMockResponse();

  const internalError = new Error("Sensitive database connection details");

  errorHandler(internalError, req, res, () => {});

  assert.equal(res.statusCode, 500);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An internal server error occurred",
    },
  });

  assert.equal(JSON.stringify(res.body).includes("Sensitive database"), false);
});

// ---------------------------------------------------------
// TEST 4: KNOWN HTTP ERROR
//
// An error with a recognised HTTP status should preserve
// that status and use a safe predefined message.
// ---------------------------------------------------------

test("known HTTP error preserves its status code", () => {
  const req = createMockRequest("/api/upload");
  const res = createMockResponse();

  const requestError = Object.assign(new Error("Internal parser details"), {
    status: 413,
  });

  errorHandler(requestError, req, res, () => {});

  assert.equal(res.statusCode, 413);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request is too large",
    },
  });
});

// ---------------------------------------------------------
// TEST 5: HEADERS ALREADY SENT
//
// Express cannot send a second response after headers have
// been sent. The error must be passed to the next handler.
// ---------------------------------------------------------

test("error after headers are sent is passed to next", () => {
  const req = createMockRequest("/api/example");
  const res = createMockResponse();

  res.headersSent = true;

  const internalError = new Error("Response already started");

  let forwardedError = null;

  errorHandler(internalError, req, res, (error) => {
    forwardedError = error;
  });

  assert.equal(forwardedError, internalError);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});
