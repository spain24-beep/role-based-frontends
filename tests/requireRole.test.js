// Import Node.js's built-in test framework.
// This means we do not need to install another testing package.
const test = require("node:test");

// Import Node.js's assertion library.
// We use it to verify the middleware's responses.
const assert = require("node:assert/strict");

// Import the middleware we want to test.
const requireRole = require("../dist/middleware/requireRole").default;

// ---------------------------------------------------------
// TEST HELPER
//
// Creates a simulated Express request, response and next
// function so we can test the middleware without starting
// the application or connecting to PostgreSQL.
// ---------------------------------------------------------

function createMockRequest(user) {
  return {
    user,
  };
}

function createMockResponse() {
  // Store the HTTP status and response body so the tests
  // can inspect what the middleware returned.
  const response = {
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

  return response;
}

// ---------------------------------------------------------
// TEST 1: ADMIN ACCESS
//
// An admin should be allowed through an admin-only route.
// ---------------------------------------------------------

test("admin can access an admin-only route", () => {
  const req = createMockRequest({
    id: 1,
    role: "admin",
  });

  const res = createMockResponse();

  // Record whether the middleware called next().
  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  // Execute the middleware.
  requireRole("admin")(req, res, next);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

// ---------------------------------------------------------
// TEST 2: ORDINARY USER ACCESS
//
// An ordinary user must receive HTTP 403 when attempting
// to access an admin-only route.
// ---------------------------------------------------------

test("ordinary user cannot access an admin-only route", () => {
  const req = createMockRequest({
    id: 2,
    role: "user",
  });

  const res = createMockResponse();

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  // Execute the admin-only middleware.
  requireRole("admin")(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "FORBIDDEN",
      message: "You do not have permission to access this resource",
    },
  });
});

// ---------------------------------------------------------
// TEST 3: UNAUTHENTICATED REQUEST
//
// If authentication middleware has not attached req.user,
// requireRole must reject the request with HTTP 401.
// ---------------------------------------------------------

test("request without an authenticated user receives HTTP 401", () => {
  const req = createMockRequest(null);

  const res = createMockResponse();

  let nextCalled = false;

  const next = () => {
    nextCalled = true;
  };

  // Execute the admin-only middleware.
  requireRole("admin")(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "NOT_AUTHENTICATED",
      message: "Not authenticated",
    },
  });
});
