// Use Node's built-in test runner and assertion library.
// No additional testing packages are required.
const test = require("node:test");
const assert = require("node:assert/strict");

// Import Express so we can run the real authentication router
// inside a temporary local HTTP server.
const express = require("express");

// Import Node's module system so we can temporarily replace
// the authentication router's dependencies while loading it.
const Module = require("node:module");

test("returns HTTP 409 when an email is linked to another account", async () => {
  // Keep the original require function so we can restore it
  // immediately after loading the router with our test doubles.
  const originalRequire = Module.prototype.require;

  // Temporarily replace selected dependencies used by auth.js.
  // This prevents the test from contacting Google or the database.
  Module.prototype.require = function (request) {
    // Simulate successful Google token verification.
    if (request === "google-auth-library") {
      return {
        OAuth2Client: class FakeOAuth2Client {
          async verifyIdToken() {
            return {
              getPayload: () => ({
                sub: "test-google-sub",
                email: "conflict@example.com",
                email_verified: true,
                name: "Test User",
              }),
            };
          }
        },
      };
    }

    // Simulate the exact conflict produced by the real
    // authentication service when an email belongs to
    // a different Google account.
    if (request === "../services/authService") {
      return {
        authenticateGoogleUser: async () => {
          throw new Error("Email address is linked to another account");
        },
      };
    }

    // The Google login route does not need repository access
    // in this test because the authentication service is mocked.
    if (request === "../repositories/usersRepository") {
      return {};
    }

    // The /google route does not use requireAuth.
    // Supply a harmless placeholder for the import.
    if (request === "../middleware/requireAuth") {
      return (req, res, next) => next();
    }

    // All other dependencies, including Express itself,
    // are loaded normally.
    return originalRequire.apply(this, arguments);
  };

  let authRouter;

  try {
    // Remove any cached copy so the router is loaded again
    // while the temporary dependencies are in place.
    const controllerPath =
      require.resolve("../dist/controllers/authController");
    delete require.cache[controllerPath];

    const routePath = require.resolve("../dist/routes/auth");
    delete require.cache[routePath];

    // Load the actual authentication router.
    authRouter = require("../dist/routes/auth").default;
  } finally {
    // Restore Node's normal module loading immediately.
    // The router has already captured the test dependencies.
    Module.prototype.require = originalRequire;
  }

  // Create a small Express application for this test only.
  const app = express();

  // Parse JSON request bodies, as the real application does.
  app.use(express.json());

  // Mount the actual authentication router at its normal path.
  app.use("/api/auth", authRouter);

  // Listen on an automatically assigned local port.
  const server = app.listen(0, "127.0.0.1");

  // Wait until the temporary server is ready.
  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    // Find the port assigned by the operating system.
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/auth/google`;

    // Send a request through the real Express route.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        credential: "test-google-id-token",
      }),
    });

    // Read the JSON response returned by the route.
    const body = await response.json();

    // The route must translate the service conflict into HTTP 409.
    assert.equal(response.status, 409);

    // Check the exact public-facing error message.
    assert.deepEqual(body, {
      success: false,
      error: {
        code: "EMAIL_ALREADY_LINKED",
        message: "This email address is already linked to another account",
      },
    });
  } finally {
    // Always close the temporary server, even if an assertion fails.
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

test("returns HTTP 500 when an unexpected internal error occurs", async () => {
  // Preserve Node's original module-loading function.
  const originalRequire = Module.prototype.require;

  // Replace the router's external dependencies for this test.
  Module.prototype.require = function (request) {
    // Simulate successful Google token verification.
    if (request === "google-auth-library") {
      return {
        OAuth2Client: class FakeOAuth2Client {
          async verifyIdToken() {
            return {
              getPayload: () => ({
                sub: "test-google-sub",
                email: "test@example.com",
                email_verified: true,
                name: "Test User",
              }),
            };
          }
        },
      };
    }

    // Simulate an unexpected internal failure.
    // This could represent a database connection failure.
    if (request === "../services/authService") {
      return {
        authenticateGoogleUser: async () => {
          throw new Error("Simulated database failure");
        },
      };
    }

    // These dependencies are not needed by this test.
    if (request === "../repositories/usersRepository") {
      return {};
    }

    if (request === "../middleware/requireAuth") {
      return (req, res, next) => next();
    }

    return originalRequire.apply(this, arguments);
  };

  let authRouter;

  try {
    // Force Node to reload the router using our test doubles.
    const controllerPath =
      require.resolve("../dist/controllers/authController");
    delete require.cache[controllerPath];

    const routePath = require.resolve("../dist/routes/auth");
    delete require.cache[routePath];

    authRouter = require("../dist/routes/auth").default;
  } finally {
    // Restore normal module loading immediately.
    Module.prototype.require = originalRequire;
  }

  // Create a temporary Express application.
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);

  // Start the test server on an automatically assigned port.
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/auth/google`;

    // Send a request through the actual authentication route.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        credential: "test-google-id-token",
      }),
    });

    const body = await response.json();

    // Unexpected internal errors must produce HTTP 500.
    assert.equal(response.status, 500);

    // The internal error details must not be exposed to the browser.
    assert.deepEqual(body, {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An internal authentication error occurred",
      },
    });
  } finally {
    // Always close the temporary server.
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
