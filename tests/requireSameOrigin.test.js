/*
 * SAME-ORIGIN MIDDLEWARE TESTS
 *
 * Purpose:
 * Verify that state-changing requests are accepted only
 * when they originate from the configured application origin.
 *
 * These tests use simulated Express objects. They do not
 * start a server or connect to PostgreSQL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// ---------------------------------------------------------
// TEST CONFIGURATION
// ---------------------------------------------------------

// Preserve the original environment setting so the test
// does not leave a changed value for other tests.
const originalAppOrigin = process.env.APP_ORIGIN;

// Set a known application origin before importing the middleware.
process.env.APP_ORIGIN = "http://localhost:3000";

// Load the middleware after configuring its environment.
// The middleware validates APP_ORIGIN when the module loads.
const requireSameOrigin =
  require("../dist/middleware/requireSameOrigin").default;

// ---------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------

// Create a simulated Express request.
// The Origin header is returned through Express's req.get().
function createMockRequest(method, origin) {
  return {
    method,

    get(headerName) {
      if (headerName.toLowerCase() === "origin") {
        return origin;
      }

      return undefined;
    },
  };
}

// Create a simulated Express response.
// Store the status and JSON body so the tests can inspect them.
function createMockResponse() {
  return {
    statusCode: null,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },
  };
}

// ---------------------------------------------------------
// TEST 1: MISSING ORIGIN
//
// A state-changing request without an Origin header must
// be rejected with HTTP 403 and the standard error envelope.
// ---------------------------------------------------------

test("state-changing request without Origin receives standard HTTP 403 response", () => {
  const req = createMockRequest("POST", undefined);
  const res = createMockResponse();

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  requireSameOrigin(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "FORBIDDEN",
      message: "Request origin is required",
    },
  });
});

// ---------------------------------------------------------
// TEST 2: UNTRUSTED ORIGIN
//
// A state-changing request from another website must be
// rejected with HTTP 403 and the standard error envelope.
// ---------------------------------------------------------

test("state-changing request from untrusted origin receives standard HTTP 403 response", () => {
  const req = createMockRequest("POST", "https://attacker.example");
  const res = createMockResponse();

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  requireSameOrigin(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "FORBIDDEN",
      message: "Request origin not permitted",
    },
  });
});

// ---------------------------------------------------------
// TEST 3: TRUSTED ORIGIN
//
// A state-changing request from the configured application
// origin must be allowed through to the next middleware.
// ---------------------------------------------------------

test("state-changing request from configured origin is allowed", () => {
  const req = createMockRequest("POST", "http://localhost:3000");
  const res = createMockResponse();

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  requireSameOrigin(req, res, next);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});

// ---------------------------------------------------------
// TEST 4: SAFE METHOD
//
// GET requests do not modify application data and therefore
// do not require an Origin header.
// ---------------------------------------------------------

test("GET request without Origin is allowed", () => {
  const req = createMockRequest("GET", undefined);
  const res = createMockResponse();

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  requireSameOrigin(req, res, next);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(res.body, null);
});

// Restore the original environment setting after the tests.
test.after(() => {
  if (originalAppOrigin === undefined) {
    delete process.env.APP_ORIGIN;
  } else {
    process.env.APP_ORIGIN = originalAppOrigin;
  }
});
