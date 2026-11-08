// Import Node.js's built-in testing framework.
const test = require("node:test");

// Import strict assertions for checking expected results.
const assert = require("node:assert/strict");

// Import the module loader so we can replace the database
// repository with a controlled mock during these tests.
const Module = require("node:module");

// Keep a reference to Node's original module loader.
const originalRequire = Module.prototype.require;

// ---------------------------------------------------------
// DATABASE REPOSITORY MOCK
//
// requireAuth normally retrieves users from PostgreSQL.
// We replace that dependency so the tests can control
// whether a user exists without accessing the real database.
// ---------------------------------------------------------

let mockUser = null;
let mockDatabaseError = null;

const mockUsersRepository = {
  async findById(userId) {
    // Simulate a database error when a test requests it.
    if (mockDatabaseError) {
      throw mockDatabaseError;
    }

    // Return the test user only when the requested ID matches.
    if (mockUser && String(mockUser.id) === String(userId)) {
      return mockUser;
    }

    // Simulate a user who no longer exists.
    return null;
  },
};

// ---------------------------------------------------------
// TEMPORARILY REPLACE THE REPOSITORY IMPORT
//
// This intercepts only the usersRepository import made by
// requireAuth.js. Other modules retain their normal behaviour.
// ---------------------------------------------------------

Module.prototype.require = function (request) {
  if (request === "../repositories/usersRepository") {
    return mockUsersRepository;
  }

  return originalRequire.apply(this, arguments);
};

// Load the middleware while the repository mock is active.
const requireAuth = require("../dist/middleware/requireAuth").default;

// Restore Node's original module loader immediately.
// The mock is now held by the middleware's imported reference.
Module.prototype.require = originalRequire;

// ---------------------------------------------------------
// EXPRESS REQUEST / RESPONSE TEST HELPERS
// ---------------------------------------------------------

function createMockRequest(userId = null) {
  return {
    originalUrl: "/",
    session: userId ? { userId } : {},
  };
}

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    clearedCookie: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },

    clearCookie(name, options) {
      this.clearedCookie = { name, options };
      return this;
    },
  };
}

// ---------------------------------------------------------
// TEST 1: NO SESSION
//
// A visitor without a session user ID must receive HTTP 401.
// ---------------------------------------------------------

test("request without a session receives HTTP 401", async () => {
  mockUser = null;
  mockDatabaseError = null;

  const req = createMockRequest();
  const res = createMockResponse();

  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

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

// ---------------------------------------------------------
// TEST 2: VALID SESSION
//
// An existing database user should be attached to req.user,
// and the request should continue to the next handler.
// ---------------------------------------------------------

test("valid session retrieves user and calls next", async () => {
  mockDatabaseError = null;

  mockUser = {
    id: 42,
    email: "test@example.com",
    role: "admin",
    multiplier: null,
  };

  const req = createMockRequest(42);
  const res = createMockResponse();

  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 42);
  assert.equal(req.user.role, "admin");
  assert.equal(res.statusCode, null);
});

// ---------------------------------------------------------
// TEST 3: USER NO LONGER EXISTS
//
// A session may still exist after its database user has
// been deleted. The middleware must destroy that session,
// clear the browser cookie and reject the request.
// ---------------------------------------------------------

test("session for a deleted user is destroyed and rejected", async () => {
  // Simulate a user who cannot be found in PostgreSQL.
  mockUser = null;
  mockDatabaseError = null;

  const req = createMockRequest(999);
  const res = createMockResponse();

  // Simulate Express successfully destroying the session.
  let sessionDestroyed = false;

  req.session.destroy = (callback) => {
    sessionDestroyed = true;
    callback(null);
  };

  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(sessionDestroyed, true);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "NOT_AUTHENTICATED",
      message: "Not authenticated",
    },
  });

  assert.equal(res.clearedCookie.name, "google_auth_starter.sid");
});

// ---------------------------------------------------------
// TEST 4: DATABASE FAILURE
//
// If PostgreSQL cannot be queried, authentication cannot
// be verified. The middleware must fail closed with HTTP 500.
// ---------------------------------------------------------

test("database failure prevents access and returns HTTP 500", async () => {
  mockUser = null;

  // Simulate PostgreSQL returning an error.
  mockDatabaseError = new Error("Simulated database failure");

  const req = createMockRequest(42);
  const res = createMockResponse();

  let nextCalled = false;

  await requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 500);

  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "AUTHENTICATION_VERIFICATION_FAILED",
      message: "Could not verify authentication",
    },
  });

  // Reset the mock so it cannot affect subsequent tests.
  mockDatabaseError = null;
});
