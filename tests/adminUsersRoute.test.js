const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Module = require("node:module");

const requireRole = require("../dist/middleware/requireRole").default;

// A representative database user. The repository normally returns
// timestamps as Date objects and BIGINT identifiers as strings.
function createTestUser() {
  return {
    id: "12",
    google_sub: "private-google-id",
    email: "test@example.com",
    role: "user",
    multiplier: "1.25",
    created_at: new Date("2026-01-01T10:00:00.000Z"),
    updated_at: new Date("2026-01-02T10:00:00.000Z"),
    last_login_at: new Date("2026-01-03T10:00:00.000Z"),
  };
}

// Load the real admin router while replacing only its database
// repository. This keeps the tests independent of PostgreSQL.
function loadAdminRouter(repository) {
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function (request) {
    if (request === "../repositories/usersRepository") {
      return repository;
    }

    return originalRequire.apply(this, arguments);
  };

  try {
    const routePath = require.resolve("../dist/routes/adminUsers");
    delete require.cache[routePath];

    return require("../dist/routes/adminUsers").default;
  } finally {
    Module.prototype.require = originalRequire;
  }
}

// Start a temporary Express server with the real admin-role middleware.
// Authentication is simulated here so these tests do not need sessions
// or a database connection.
async function startTestServer(role, repository) {
  const router = loadAdminRouter(repository);
  const app = express();

  app.use(express.json());

  app.use(
    "/api/admin/users",
    (req, res, next) => {
      req.user = role ? { id: "1", role } : null;

      next();
    },
    requireRole("admin"),
    router,
  );

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}/api/admin/users`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

// TEST 1: ADMIN USER LIST
//
// An admin can retrieve users, and the route passes pagination,
// role filtering and email search to the repository.
test("admin can list users with pagination and filters", async () => {
  const calls = [];

  const repository = {
    listUsers: async (options) => {
      calls.push(options);

      return {
        users: [createTestUser()],
        total: 1,
        totalAccounts: 148,
      };
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(
      `${server.url}?limit=10&offset=20&role=user&search=example`,
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);

    assert.deepEqual(calls[0], {
      limit: 10,
      offset: 20,
      role: "user",
      search: "example",
    });

    assert.deepEqual(body.data.pagination, {
      limit: 10,
      offset: 20,
      total: 1,
    });

    // The headline count must include all accounts, not just
    // the one account matching the active filters.
    assert.equal(body.data.totalAccounts, 148);

    // The public response must not expose Google's internal
    // account identifier.
    assert.equal(body.data.users[0].id, "12");
    assert.equal(body.data.users[0].email, "test@example.com");
    assert.equal(body.data.users[0].google_sub, undefined);
  } finally {
    await server.close();
  }
});

// TEST 2: INVALID PAGINATION
//
// Invalid query parameters must be rejected rather than silently
// converted into potentially unintended database queries.
test("invalid pagination query receives HTTP 400", async () => {
  let repositoryCalled = false;

  const repository = {
    listUsers: async () => {
      repositoryCalled = true;
      return { users: [], total: 0 };
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}?limit=invalid`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INVALID_QUERY");
    assert.equal(repositoryCalled, false);
  } finally {
    await server.close();
  }
});

// TEST 3: SINGLE USER
//
// An admin can retrieve one user by their database ID.
test("admin can retrieve a single user", async () => {
  let requestedId = null;

  const repository = {
    findById: async (id) => {
      requestedId = id;
      return createTestUser();
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/12`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(requestedId, "12");
    assert.equal(body.data.user.id, "12");
    assert.equal(body.data.user.email, "test@example.com");
    assert.equal(body.data.user.google_sub, undefined);
  } finally {
    await server.close();
  }
});

// TEST 4: INVALID USER ID
//
// IDs must be positive decimal integers. Invalid IDs are rejected
// before the repository is called.
test("invalid user ID receives HTTP 400", async () => {
  let repositoryCalled = false;

  const repository = {
    findById: async () => {
      repositoryCalled = true;
      return null;
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/abc`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INVALID_USER_ID");
    assert.equal(repositoryCalled, false);
  } finally {
    await server.close();
  }
});

// TEST 5: USER NOT FOUND
//
// A valid ID that does not exist must produce HTTP 404.
test("missing user receives HTTP 404", async () => {
  const repository = {
    findById: async () => null,
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/999`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "USER_NOT_FOUND");
  } finally {
    await server.close();
  }
});

// TEST 6: ORDINARY USER
//
// Authentication alone is not sufficient. An ordinary user must
// not be allowed to access the admin user-management endpoints.
test("ordinary user cannot access admin user endpoints", async () => {
  const repository = {
    listUsers: async () => ({ users: [], total: 0 }),
  };

  const server = await startTestServer("user", repository);

  try {
    const response = await fetch(server.url);
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "FORBIDDEN");
  } finally {
    await server.close();
  }
});

// TEST 7: UNAUTHENTICATED REQUEST
//
// A request without an authenticated user must be rejected with 401.
test("unauthenticated request cannot access admin user endpoints", async () => {
  const repository = {
    listUsers: async () => ({ users: [], total: 0 }),
  };

  const server = await startTestServer(null, repository);

  try {
    const response = await fetch(server.url);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NOT_AUTHENTICATED");
  } finally {
    await server.close();
  }
});

// TEST 8: AVAILABLE FRONTEND ROLES
//
// The roles endpoint must discover roles from deployed frontend
// directories rather than relying on a hardcoded role list.
test("admin can retrieve roles from deployed frontend directories", async () => {
  const repository = {};
  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/roles`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.roles));

    // These two frontend directories are part of the current project.
    assert.ok(body.data.roles.includes("admin"));
    assert.ok(body.data.roles.includes("user"));

    // The returned list should be consistently sorted.
    assert.deepEqual(
      body.data.roles,
      [...body.data.roles].sort(),
    );
  } finally {
    await server.close();
  }
});

// TEST 9: CHANGE USER ROLE
//
// An administrator can assign another user a role that has
// a deployed frontend. The repository must receive the correct ID.
test("admin can change another user's role to a deployed frontend role", async () => {
  let requestedId = null;
  let updatedId = null;
  let updatedRole = null;

  const updatedUser = {
    ...createTestUser(),
    role: "admin",
  };

  const repository = {
    findById: async (id) => {
      requestedId = id;
      return createTestUser();
    },
    updateRole: async (id, role) => {
      updatedId = id;
      updatedRole = role;
      return updatedUser;
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/12/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "admin",
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(requestedId, "12");
    assert.equal(updatedId, "12");
    assert.equal(updatedRole, "admin");
    assert.equal(body.data.user.role, "admin");
    assert.equal(body.data.user.google_sub, undefined);
  } finally {
    await server.close();
  }
});

// TEST 10: UNAVAILABLE FRONTEND ROLE
//
// A role without a deployed frontend must be rejected.
// The database repository must not be called.
test("admin cannot assign a role without a deployed frontend", async () => {
  let repositoryCalled = false;

  const repository = {
    findById: async () => {
      repositoryCalled = true;
      return createTestUser();
    },
    updateRole: async () => {
      repositoryCalled = true;
      return createTestUser();
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/12/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "role-that-does-not-exist",
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "INVALID_ROLE");
    assert.equal(repositoryCalled, false);
  } finally {
    await server.close();
  }
});

// TEST 11: PREVENT SELF-DEMOTION
//
// An administrator must not be able to remove their own
// administrator role through the role-management endpoint.
test("admin cannot remove their own administrator role", async () => {
  let repositoryCalled = false;

  const repository = {
    findById: async () => {
      repositoryCalled = true;
      return createTestUser();
    },
    updateRole: async () => {
      repositoryCalled = true;
      return createTestUser();
    },
  };

  const server = await startTestServer("admin", repository);

  try {
    const response = await fetch(`${server.url}/1/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role: "user",
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "SELF_DEMOTION_FORBIDDEN");
    assert.equal(repositoryCalled, false);
  } finally {
    await server.close();
  }
});
