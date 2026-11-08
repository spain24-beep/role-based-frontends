
/*
 * FRONTEND DELIVERY TESTS
 *
 * Purpose:
 * Verify that role-protected frontend delivery uses the latest
 * database role and never redirects asset requests to HTML.
 *
 * Also verifies that the root URL redirects authenticated users
 * to their currently assigned frontend.
 *
 * The application is loaded with controlled authentication,
 * session and database dependencies. Express static-file delivery
 * remains real, using the actual deployed frontend directories.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");

const originalRequire = Module.prototype.require;

// Simulated authenticated user returned by the database.
const currentUser = {
  id: "42",
  email: "test@example.com",
  role: "admin",
  multiplier: null,
};

// Controls whether the simulated visitor has a session.
let sessionUserId = null;

// Use real Express routers as harmless stand-ins for unrelated APIs.
const emptyRouter = express.Router();

// Mock the user repository used by the root redirect.
// The application still uses its normal routing and redirect logic.
const usersRepositoryMock = {
  async findById(userId) {
    if (userId !== currentUser.id) {
      return null;
    }

    return currentUser;
  },
};

// Replace infrastructure dependencies while loading the application.
// The frontend routes and their static-file handling remain real.
Module.prototype.require = function (request) {
  if (request === "./config/session") {
    return (req, res, next) => {
      // Simulate the session middleware attaching a session.
      // A null userId represents an unauthenticated visitor.
      req.session = {
        userId: sessionUserId,

        // Simulate destroying an invalid session.
        destroy(callback) {
          sessionUserId = null;
          callback(null);
        },
      };

      next();
    };
  }

  if (request === "./middleware/requireSameOrigin") {
    return (req, res, next) => next();
  }

  if (request === "./middleware/requireAuth") {
    return (req, res, next) => {
      // Simulate requireAuth attaching the latest database user.
      req.user = currentUser;
      next();
    };
  }

  if (request === "./repositories/usersRepository") {
    return usersRepositoryMock;
  }

  if (
    request === "./routes/auth" ||
    request === "./routes/config" ||
    request === "./routes/adminUsers"
  ) {
    return emptyRouter;
  }

  if (request === "./middleware/requireRole") {
    return () => (req, res, next) => next();
  }

  if (request === "./middleware/notFound") {
    return (req, res) => res.status(404).send("Not found");
  }

  if (request === "./middleware/errorHandler") {
    return (error, req, res, next) => {
      res.status(500).send("Internal server error");
    };
  }

  if (request === "./routes/health") {
    return {
      createReadinessRouter: () => express.Router(),
    };
  }

  if (request === "./config/database") {
    return {};
  }

  return originalRequire.apply(this, arguments);
};

let app;

try {
  // Load the compiled application while the dependencies are mocked.
  const appPath = require.resolve("../dist/app");
  delete require.cache[appPath];
  app = require("../dist/app").default;
} finally {
  // Restore normal module loading immediately after application setup.
  Module.prototype.require = originalRequire;
}

async function withServer(callback) {
  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await callback(baseUrl);
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
// ROOT ENTRY ROUTE TESTS
// ---------------------------------------------------------

// An authenticated visitor requesting the root URL should be
// redirected to the frontend matching their current database role.
test("authenticated visitor is redirected from root to their assigned frontend", async () => {
  sessionUserId = currentUser.id;
  currentUser.role = "admin";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, {
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin/");
  });

  sessionUserId = null;
});

// An unauthenticated visitor must receive the public login page,
// not a redirect to a role-specific frontend.
test("unauthenticated visitor can load the public root login page", async () => {
  sessionUserId = null;

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, {
      redirect: "manual",
    });

    assert.equal(response.status, 200);
  });
});

// A valid session whose user has no deployed frontend must not
// produce an arbitrary or broken redirect.
test("root route refuses accounts without a deployed frontend", async () => {
  sessionUserId = currentUser.id;
  currentUser.role = "unconfigured-role";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`, {
      redirect: "manual",
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("location"), null);
  });

  // Restore the simulated user for subsequent tests.
  currentUser.role = "admin";
  sessionUserId = null;
});

// ---------------------------------------------------------
// ROLE-PROTECTED FRONTEND DELIVERY TESTS
// ---------------------------------------------------------

// A user requesting a frontend for an old role should be sent
// to the frontend matching their current database role.
test("page navigation redirects to the user's newly assigned frontend", async () => {
  currentUser.role = "admin";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/user/`, {
      redirect: "manual",
      headers: {
        "Sec-Fetch-Dest": "document",
        Accept: "text/html",
      },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin/");
  });
});

// A script or stylesheet request must not receive a redirect to
// an HTML page simply because the user has a different role.
test("asset request for the wrong frontend is forbidden, not redirected", async () => {
  currentUser.role = "admin";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/user/example.js`, {
      redirect: "manual",
      headers: {
        "Sec-Fetch-Dest": "script",
        Accept: "*/*",
      },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("location"), null);
  });
});

// A database role without a deployed frontend must never become
// an arbitrary redirect destination.
test("page navigation is forbidden when the assigned role has no frontend", async () => {
  currentUser.role = "unconfigured-role";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/user/`, {
      redirect: "manual",
      headers: {
        "Sec-Fetch-Dest": "document",
        Accept: "text/html",
      },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("location"), null);
  });
});

// A user whose database role matches the requested frontend
// should receive that frontend normally.
test("matching role can load its own frontend", async () => {
  currentUser.role = "user";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/user/`, {
      headers: {
        "Sec-Fetch-Dest": "document",
        Accept: "text/html",
      },
    });

    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /Account pending assignment/);
  });
});

// The physical directory name must never be usable as a public route.
test("old frontend directory URL is not publicly accessible", async () => {
  currentUser.role = "user";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/frontends/user/`, {
      redirect: "manual",
    });

    assert.equal(response.status, 404);
  });
});
