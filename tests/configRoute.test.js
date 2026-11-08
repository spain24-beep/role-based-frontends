/*
 * PUBLIC CONFIGURATION ROUTE TESTS
 *
 * Purpose:
 * Verify that the browser configuration endpoint:
 *
 * 1. Returns the configured Google Client ID.
 * 2. Fails clearly when the Client ID is missing.
 * 3. Does not expose the Google Client Secret.
 *
 * The route is tested independently of the main application.
 * This avoids requiring a live PostgreSQL database or session store.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const configRouter = require("../dist/routes/config").default;

// ---------------------------------------------------------
// TEST SERVER
//
// Mount the real configuration router in a small Express app.
// No session middleware is installed: this endpoint is public
// and must not require an authenticated session.
// ---------------------------------------------------------

async function withConfigServer(callback) {
  const app = express();

  app.use("/api/config", configRouter);

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    const address = server.address();

    const url = `http://127.0.0.1:${address.port}/api/config`;

    await callback(url);
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
// TEST 1: CONFIGURED CLIENT ID
//
// The browser should receive the Client ID from the backend.
// The response must contain no private server configuration.
// ---------------------------------------------------------

test("GET /api/config returns the public Google Client ID only", async () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  try {
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "this-is-a-private-test-secret";

    await withConfigServer(async (url) => {
      const response = await fetch(url);
      const body = await response.json();

      assert.equal(response.status, 200);

      assert.deepEqual(body, {
        success: true,
        data: {
          googleClientId: "test-client-id.apps.googleusercontent.com",
        },
      });

      // The response must never contain the Client Secret.
      assert.equal(
        JSON.stringify(body).includes("this-is-a-private-test-secret"),
        false,
      );

      // Confirm that no unexpected configuration fields appear.
      assert.deepEqual(Object.keys(body.data), ["googleClientId"]);
    });
  } finally {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.GOOGLE_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
    }
  }
});

// ---------------------------------------------------------
// TEST 2: MISSING CLIENT ID
//
// Missing configuration must produce the standard API error
// response rather than an incomplete successful response.
// ---------------------------------------------------------

test("GET /api/config returns a configuration error when Client ID is missing", async () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  try {
    delete process.env.GOOGLE_CLIENT_ID;

    await withConfigServer(async (url) => {
      const response = await fetch(url);
      const body = await response.json();

      assert.equal(response.status, 500);

      assert.deepEqual(body, {
        success: false,
        error: {
          code: "CONFIGURATION_ERROR",
          message: "Google sign-in is not configured",
        },
      });
    });
  } finally {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  }
});

// ---------------------------------------------------------
// TEST 3: WHITESPACE-ONLY CLIENT ID
//
// A value containing only spaces is not a valid configuration.
// The route trims the value before checking it.
// ---------------------------------------------------------

test("GET /api/config rejects a whitespace-only Client ID", async () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID;

  try {
    process.env.GOOGLE_CLIENT_ID = "   ";

    await withConfigServer(async (url) => {
      const response = await fetch(url);
      const body = await response.json();

      assert.equal(response.status, 500);

      assert.equal(body.success, false);
      assert.equal(body.error.code, "CONFIGURATION_ERROR");
    });
  } finally {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
  }
});
