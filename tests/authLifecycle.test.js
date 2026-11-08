/*
 * AUTHENTICATION LIFECYCLE TESTS
 *
 * Purpose:
 * Test the complete HTTP lifecycle of the authentication routes:
 *
 * 1. Successful Google login.
 * 2. Rejection of an unverified Google email.
 * 3. Session regeneration and persistence.
 * 4. Retrieval of the current authenticated user.
 * 5. Rejection of unauthenticated /me requests.
 * 6. Successful logout and cookie clearing.
 * 7. Logout when session destruction fails.
 *
 * Google, the authentication service and authentication middleware
 * are controlled test doubles. These tests do not contact Google
 * or require a live PostgreSQL database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");

// ---------------------------------------------------------
// SHARED TEST USER
//
// Represents the user returned by the authentication service
// after a successful Google login.
// ---------------------------------------------------------

const testUser = {
  id: "42",
  email: "test@example.com",
  role: "user",
  multiplier: null,
  name: "Test User",
  picture: "https://example.com/profile.jpg",
};

// ---------------------------------------------------------
// TEST SERVER FACTORY
//
// Each test gets its own router instance, controlled dependencies,
// session object and temporary HTTP server.
//
// The real route and controller code is loaded. Only external
// dependencies are replaced.
// ---------------------------------------------------------

async function withAuthServer(options, callback) {
  const originalRequire = Module.prototype.require;

  const state = {
    verificationCalls: [],
    regenerationCalls: 0,
    saveCalls: 0,
    destroyCalls: 0,
    currentSession: null,
  };

  // Simulate the Google authentication library.
  class FakeOAuth2Client {
    async verifyIdToken(verificationOptions) {
      state.verificationCalls.push(verificationOptions);

      if (options.googleError) {
        throw options.googleError;
      }

      return {
        getPayload: () =>
          options.googlePayload || {
            sub: "test-google-sub",
            email: testUser.email,
            email_verified: true,
            name: testUser.name,
            picture: testUser.picture,
          },
      };
    }
  }

  // Simulate the application's authentication service.
  const mockAuthService = {
    authenticateGoogleUser:
      options.authenticateGoogleUser ||
      (async () => ({
        user: testUser,
        isNewUser: false,
      })),
  };

  // Replace only the dependencies needed by the authentication
  // controller and router while those modules are loaded.
  Module.prototype.require = function (request) {
    if (request === "google-auth-library") {
      return {
        OAuth2Client: FakeOAuth2Client,
      };
    }

    if (request === "../services/authService") {
      return mockAuthService;
    }

    if (request === "../repositories/usersRepository") {
      return {};
    }

    // This middleware double lets us test the controller's
    // /me response without needing a real database lookup.
    if (request === "../middleware/requireAuth") {
      return (req, res, next) => {
        if (!req.session.userId) {
          res.status(401).json({
            success: false,
            error: {
              code: "NOT_AUTHENTICATED",
              message: "Not authenticated",
            },
          });
          return;
        }

        req.user = options.authenticatedUser || testUser;
        next();
      };
    }

    return originalRequire.apply(this, arguments);
  };

  let authRouter;

  try {
    // Clear both modules so the controller and router capture
    // the dependencies belonging to this particular test.
    const controllerPath =
      require.resolve("../dist/controllers/authController");

    const routePath = require.resolve("../dist/routes/auth");

    delete require.cache[controllerPath];
    delete require.cache[routePath];

    authRouter = require("../dist/routes/auth").default;
  } finally {
    // Restore normal module loading immediately.
    Module.prototype.require = originalRequire;
  }

  const app = express();

  app.use(express.json());

  // Simulate the session middleware.
  //
  // The real application uses express-session with PostgreSQL.
  // Here we provide the same session operations in a controlled
  // way so the controller's behaviour can be tested independently.
  app.use((req, res, next) => {
    function createSession() {
      const session = {};

      session.regenerate = (sessionCallback) => {
        state.regenerationCalls++;

        // Regeneration replaces the old session with a fresh one.
        req.session = createSession();

        state.currentSession = req.session;

        sessionCallback(null);
      };

      session.save = (sessionCallback) => {
        state.saveCalls++;

        sessionCallback(options.saveError || null);
      };

      session.destroy = (sessionCallback) => {
        state.destroyCalls++;

        sessionCallback(options.destroyError || null);
      };

      return session;
    }

    req.session = createSession();

    // Allow tests to begin with an existing authenticated session.
    if (options.initialUserId) {
      req.session.userId = options.initialUserId;
    }

    state.currentSession = req.session;

    next();
  });

  app.use("/api/auth", authRouter);

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    const address = server.address();

    const baseUrl = `http://127.0.0.1:${address.port}/api/auth`;

    await callback({
      baseUrl,
      state,
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

// ---------------------------------------------------------
// HTTP REQUEST HELPERS
// ---------------------------------------------------------

async function postGoogleLogin(baseUrl) {
  return fetch(`${baseUrl}/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      credential: "test-google-id-token",
    }),
  });
}

async function postLogout(baseUrl) {
  return fetch(`${baseUrl}/logout`, {
    method: "POST",
  });
}

// ---------------------------------------------------------
// TEST 1: SUCCESSFUL GOOGLE LOGIN
//
// A valid Google identity should be authenticated by the service.
// The controller must create a fresh session, save it, and return
// the authenticated user's information.
// ---------------------------------------------------------

test("successful Google login creates and saves an authenticated session", async () => {
  await withAuthServer(
    {
      authenticateGoogleUser: async () => ({
        user: testUser,
        isNewUser: true,
      }),
    },
    async ({ baseUrl, state }) => {
      const response = await postGoogleLogin(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.success, true);

      assert.equal(body.data.status, "authenticated");

      assert.equal(body.data.user.id, testUser.id);

      assert.equal(body.data.user.email, testUser.email);

      assert.equal(body.data.isNewUser, true);

      // The controller must verify the supplied token.
      assert.equal(state.verificationCalls.length, 1);

      // Session fixation protection requires a fresh session.
      assert.equal(state.regenerationCalls, 1);

      // The session must be saved before success is returned.
      assert.equal(state.saveCalls, 1);

      // The authenticated user ID must be stored in the session.
      assert.equal(state.currentSession.userId, testUser.id);
    },
  );
});

// ---------------------------------------------------------
// TEST 2: UNVERIFIED GOOGLE EMAIL
//
// Google identity verification alone is insufficient.
// The controller must also require Google's email_verified claim.
// ---------------------------------------------------------

test("Google login rejects an unverified email address", async () => {
  await withAuthServer(
    {
      googlePayload: {
        sub: "test-google-sub",
        email: testUser.email,
        email_verified: false,
      },
    },
    async ({ baseUrl, state }) => {
      const response = await postGoogleLogin(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.success, false);

      assert.equal(body.error.code, "UNVERIFIED_EMAIL");

      // No authenticated session should be created.
      assert.equal(state.regenerationCalls, 0);
      assert.equal(state.saveCalls, 0);
    },
  );
});

// ---------------------------------------------------------
// TEST 3: GOOGLE TOKEN VERIFICATION FAILURE
//
// An invalid or expired Google ID token must not authenticate
// the user or create a session.
// ---------------------------------------------------------

test("Google login rejects a token verification failure", async () => {
  await withAuthServer(
    {
      googleError: new Error("Invalid Google token"),
    },
    async ({ baseUrl, state }) => {
      const response = await postGoogleLogin(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.success, false);

      assert.equal(body.error.code, "GOOGLE_AUTHENTICATION_FAILED");

      assert.equal(state.regenerationCalls, 0);
      assert.equal(state.saveCalls, 0);
    },
  );
});

// ---------------------------------------------------------
// TEST 4: SESSION SAVE FAILURE
//
// A login must not be reported as successful if the server
// cannot persist the authenticated session.
// ---------------------------------------------------------

test("Google login fails if the new session cannot be saved", async () => {
  await withAuthServer(
    {
      saveError: new Error("Simulated session store failure"),
    },
    async ({ baseUrl, state }) => {
      const response = await postGoogleLogin(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.success, false);

      assert.equal(state.regenerationCalls, 1);
      assert.equal(state.saveCalls, 1);

      // The controller must not return a successful login.
      assert.notEqual(body.data?.status, "authenticated");
    },
  );
});

// ---------------------------------------------------------
// TEST 5: CURRENT AUTHENTICATED USER
//
// An authenticated session should allow /me to return the
// current user information.
// ---------------------------------------------------------

test("GET /me returns the current authenticated user", async () => {
  await withAuthServer(
    {
      initialUserId: String(testUser.id),
    },
    async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/me`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.success, true);

      assert.equal(body.data.user.id, testUser.id);

      assert.equal(body.data.user.email, testUser.email);

      assert.equal(body.data.user.role, testUser.role);
    },
  );
});

// ---------------------------------------------------------
// TEST 6: UNAUTHENTICATED CURRENT USER REQUEST
//
// Without a session user ID, /me must reject the request.
// ---------------------------------------------------------

test("GET /me rejects a request without an authenticated session", async () => {
  await withAuthServer({}, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/me`);
    const body = await response.json();

    assert.equal(response.status, 401);

    assert.deepEqual(body, {
      success: false,
      error: {
        code: "NOT_AUTHENTICATED",
        message: "Not authenticated",
      },
    });
  });
});

// ---------------------------------------------------------
// TEST 7: SUCCESSFUL LOGOUT
//
// Logout must destroy the server-side session, clear the
// browser's session cookie and return a success response.
// ---------------------------------------------------------

test("logout destroys the session and clears the session cookie", async () => {
  await withAuthServer(
    {
      initialUserId: String(testUser.id),
    },
    async ({ baseUrl, state }) => {
      const response = await postLogout(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 200);

      assert.deepEqual(body, {
        success: true,
        data: {
          status: "logged_out",
        },
      });

      assert.equal(state.destroyCalls, 1);

      const setCookie = response.headers.get("set-cookie");

      assert.ok(setCookie);
      assert.match(setCookie, /google_auth_starter\.sid/);

      assert.match(setCookie, /Expires=Thu, 01 Jan 1970/);
    },
  );
});

// ---------------------------------------------------------
// TEST 8: LOGOUT WITHOUT AN AUTHENTICATED SESSION
//
// Logout is deliberately available without requireAuth.
// This allows a browser to clear an obsolete session cookie.
// ---------------------------------------------------------

test("logout is allowed without an authenticated session", async () => {
  await withAuthServer({}, async ({ baseUrl, state }) => {
    const response = await postLogout(baseUrl);
    const body = await response.json();

    assert.equal(response.status, 200);

    assert.deepEqual(body, {
      success: true,
      data: {
        status: "logged_out",
      },
    });

    assert.equal(state.destroyCalls, 1);
  });
});

// ---------------------------------------------------------
// TEST 9: LOGOUT FAILURE
//
// If the server cannot destroy the session, it must return
// an error rather than claim that logout succeeded.
// ---------------------------------------------------------

test("logout returns HTTP 500 if session destruction fails", async () => {
  await withAuthServer(
    {
      destroyError: new Error("Simulated session destruction failure"),
    },
    async ({ baseUrl, state }) => {
      const response = await postLogout(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.success, false);

      assert.equal(body.error.code, "LOGOUT_FAILED");

      assert.equal(state.destroyCalls, 1);
    },
  );
});
