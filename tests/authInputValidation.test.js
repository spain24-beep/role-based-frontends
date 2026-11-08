/*
 * GOOGLE LOGIN INPUT VALIDATION TESTS
 *
 * Purpose:
 * Verify that POST /api/auth/google accepts only a JSON object
 * containing exactly one non-empty string property: credential.
 *
 * Google and the authentication service are replaced with test
 * doubles. This ensures the tests do not contact external services.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");

test("Google login rejects malformed request bodies before Google verification", async () => {
  // Track whether the controller attempts to contact Google
  // or the authentication service.
  let verificationCalls = 0;
  let authenticationCalls = 0;

  // Preserve Node's original module-loading function.
  const originalRequire = Module.prototype.require;

  // Replace the dependencies used by the authentication controller.
  Module.prototype.require = function (request) {
    // Simulate Google's library.
    // Any call to verifyIdToken is counted and rejected.
    if (request === "google-auth-library") {
      return {
        OAuth2Client: class FakeOAuth2Client {
          async verifyIdToken() {
            verificationCalls++;
            throw new Error("Simulated invalid Google token");
          }
        },
      };
    }

    // Track whether the authentication service is called.
    if (request === "../services/authService") {
      return {
        authenticateGoogleUser: async () => {
          authenticationCalls++;
          throw new Error("Authentication service should not be called");
        },
      };
    }

    // These dependencies are not needed for input validation.
    if (request === "../repositories/usersRepository") {
      return {};
    }

    if (request === "../middleware/requireAuth") {
      return (req, res, next) => next();
    }

    // Load all other modules normally.
    return originalRequire.apply(this, arguments);
  };

  let authRouter;

  try {
    // Clear the compiled controller and route from Node's cache.
    // This ensures they load using the test dependencies above.
    const controllerPath =
      require.resolve("../dist/controllers/authController");
    delete require.cache[controllerPath];

    const routePath = require.resolve("../dist/routes/auth");
    delete require.cache[routePath];

    // Load the real authentication router.
    authRouter = require("../dist/routes/auth").default;
  } finally {
    // Restore normal module loading immediately.
    Module.prototype.require = originalRequire;
  }

  // Create a temporary Express application.
  const app = express();

  // Parse incoming JSON request bodies.
  app.use(express.json({ strict: false }));

  // Mount the actual authentication router.
  app.use("/api/auth", authRouter);

  // Start a temporary HTTP server.
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/auth/google`;

    // Each entry represents an invalid request body.
    // Undefined represents a request with no body at all.
    const invalidBodies = [
      { description: "missing body", body: undefined },
      { description: "empty object", body: {} },
      { description: "missing credential", body: { role: "user" } },
      { description: "empty credential", body: { credential: "" } },
      {
        description: "whitespace-only credential",
        body: { credential: "   " },
      },
      { description: "numeric credential", body: { credential: 123 } },
      { description: "boolean credential", body: { credential: true } },
      {
        description: "additional role property",
        body: { credential: "token", role: "admin" },
      },
      {
        description: "additional userId property",
        body: { credential: "token", userId: "123" },
      },
      { description: "null body", body: null },
      { description: "array body", body: ["token"] },
      { description: "string body", body: "token" },
      { description: "numeric body", body: 123 },
    ];

    // Send each invalid body through the real HTTP endpoint.
    for (const entry of invalidBodies) {
      const headers = {
        Origin: "http://localhost:3000",
      };

      const options = {
        method: "POST",
        headers,
      };

      // Only add JSON headers and a body when a body exists.
      if (entry.body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(entry.body);
      }

      const response = await fetch(url, options);
      const responseBody = await response.json();

      // Every malformed request must receive HTTP 400.
      assert.equal(
        response.status,
        400,
        `Unexpected HTTP status for ${entry.description}`,
      );

      // Every malformed request must use the standard error format.
      assert.deepEqual(
        responseBody,
        {
          success: false,
          error: {
            code: "INVALID_REQUEST",
            message:
              "Request must contain only a non-empty Google ID token credential",
          },
        },
        `Unexpected response for ${entry.description}`,
      );
    }

    // None of the invalid requests should have reached Google
    // or the authentication service.
    assert.equal(verificationCalls, 0);
    assert.equal(authenticationCalls, 0);

    // Now send a correctly structured request.
    // The fake Google client deliberately rejects its token.
    // Receiving HTTP 401 proves the request passed input validation
    // and reached Google's verification step.
    const validResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        credential: "test-google-id-token",
      }),
    });

    const validResponseBody = await validResponse.json();

    assert.equal(validResponse.status, 401);

    assert.deepEqual(validResponseBody, {
      success: false,
      error: {
        code: "GOOGLE_AUTHENTICATION_FAILED",
        message: "Google authentication failed",
      },
    });

    // The validly structured request reached Google exactly once.
    assert.equal(verificationCalls, 1);

    // Google rejected the token, so the authentication service
    // must not have been called.
    assert.equal(authenticationCalls, 0);
  } finally {
    // Always close the temporary HTTP server.
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
