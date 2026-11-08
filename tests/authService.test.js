// Load environment variables before importing compiled application modules.
require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");

// Import the real compiled modules. Only their external dependencies
// are replaced with controlled test doubles below.
const usersRepository = require("../dist/repositories/usersRepository").default;
const publicSheet = require("../dist/integrations/google/publicSheet").default;
const { authenticateGoogleUser } =
  require("../dist/services/authService").default;

// Save the original methods so every test can restore them.
const originalMethods = {
  findByGoogleSub: usersRepository.findByGoogleSub,
  findByEmail: usersRepository.findByEmail,
  createUser: usersRepository.createUser,
  updateNames: usersRepository.updateNames,
  updateLastLogin: usersRepository.updateLastLogin,
  readAuthorisedUsers: publicSheet.readAuthorisedUsers,
};

const originalAdminEmail = process.env.ADMIN_EMAIL;

// Install isolated test doubles for one test and restore everything
// afterwards. This avoids database access and prevents test leakage.
async function withAuthMocks(options, runTest) {
  const calls = {
    sheetReads: 0,
    createdUser: null,
    updatedUserId: null,
  };

  let createdRecord = null;

  try {
    // Configure the administrator bootstrap email for this test.
    if (options.adminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = options.adminEmail;
    }

    // Simulate looking up an existing Google account.
    usersRepository.findByGoogleSub = async () => options.existingUser || null;

    // Simulate looking up an email already stored in the database.
    usersRepository.findByEmail = async () => {
      if (options.emailOwner !== undefined) {
        return options.emailOwner;
      }

      return options.existingUser || null;
    };

    // Capture the exact account details requested by the service.
    usersRepository.createUser = async (userData) => {
      calls.createdUser = userData;

      createdRecord = {
        id: "new-user",
        ...userData,
      };

      return createdRecord;
    };

    // Simulate updating the Google profile names on an existing account.
    // Returning the existing record allows the service to continue to login.
    usersRepository.updateNames = async (userId, firstName, lastName) => {
      if (!options.existingUser) {
        return null;
      }

      return {
        ...options.existingUser,
        first_name: firstName ?? options.existingUser.first_name ?? null,
        last_name: lastName ?? options.existingUser.last_name ?? null,
      };
    };

    // Return the latest database user record after login.
    usersRepository.updateLastLogin = async (userId) => {
      calls.updatedUserId = userId;

      if (options.updatedUser !== undefined) {
        return options.updatedUser;
      }

      if (options.existingUser) {
        return options.existingUser;
      }

      return createdRecord;
    };

    // Supply controlled authorised-user entries and count reads.
    publicSheet.readAuthorisedUsers = async () => {
      calls.sheetReads += 1;
      return options.sheetUsers || [];
    };

    await runTest(calls);
  } finally {
    // Restore every original dependency, even if an assertion fails.
    usersRepository.findByGoogleSub = originalMethods.findByGoogleSub;
    usersRepository.findByEmail = originalMethods.findByEmail;
    usersRepository.createUser = originalMethods.createUser;
    usersRepository.updateNames = originalMethods.updateNames;
    usersRepository.updateLastLogin = originalMethods.updateLastLogin;
    publicSheet.readAuthorisedUsers = originalMethods.readAuthorisedUsers;

    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
  }
}

// ---------------------------------------------------------
// EXISTING ACCOUNT POLICY
// ---------------------------------------------------------

test("existing user can log in after removal from the authorised Sheet", async () => {
  const existingUser = {
    id: "12",
    google_sub: "existing-google-sub",
    email: "existing@example.com",
    role: "user",
    multiplier: "1.25",
  };

  await withAuthMocks({ existingUser, sheetUsers: [] }, async (calls) => {
    const result = await authenticateGoogleUser({
      googleSub: "existing-google-sub",
      email: "existing@example.com",
    });

    assert.equal(result.user.id, "12");
    assert.equal(result.user.role, "user");
    assert.equal(result.isAdmin, false);
    assert.equal(result.isNewUser, false);

    // Existing accounts must not be re-authorised against the Sheet.
    assert.equal(calls.sheetReads, 0);
    assert.equal(calls.createdUser, null);
    assert.equal(calls.updatedUserId, "12");
  });
});

test("existing user is not promoted just because their email matches ADMIN_EMAIL", async () => {
  const existingUser = {
    id: "13",
    google_sub: "ordinary-google-sub",
    email: "admin@example.com",
    role: "user",
    multiplier: null,
  };

  await withAuthMocks(
    {
      existingUser,
      adminEmail: "admin@example.com",
    },
    async (calls) => {
      const result = await authenticateGoogleUser({
        googleSub: "ordinary-google-sub",
        email: "admin@example.com",
      });

      assert.equal(result.user.role, "user");
      assert.equal(result.isAdmin, false);
      assert.equal(result.isNewUser, false);
      assert.equal(calls.createdUser, null);
      assert.equal(calls.sheetReads, 0);
    },
  );
});

test("existing administrator keeps database role when ADMIN_EMAIL changes", async () => {
  const existingUser = {
    id: "14",
    google_sub: "admin-google-sub",
    email: "former-admin@example.com",
    role: "admin",
    multiplier: null,
  };

  await withAuthMocks(
    {
      existingUser,
      adminEmail: "new-admin@example.com",
    },
    async (calls) => {
      const result = await authenticateGoogleUser({
        googleSub: "admin-google-sub",
        email: "former-admin@example.com",
      });

      assert.equal(result.user.role, "admin");
      assert.equal(result.isAdmin, true);
      assert.equal(result.isNewUser, false);
      assert.equal(calls.createdUser, null);
      assert.equal(calls.sheetReads, 0);
    },
  );
});

// ---------------------------------------------------------
// NEW ACCOUNT POLICY
// ---------------------------------------------------------

test("new ADMIN_EMAIL account is created as administrator without Sheet entry", async () => {
  await withAuthMocks(
    {
      adminEmail: "admin@example.com",
      sheetUsers: [],
    },
    async (calls) => {
      const result = await authenticateGoogleUser({
        googleSub: "new-admin-google-sub",
        email: "ADMIN@example.com",
      });

      assert.equal(result.user.role, "admin");
      assert.equal(result.isAdmin, true);
      assert.equal(result.isNewUser, true);

      assert.deepEqual(calls.createdUser, {
        googleSub: "new-admin-google-sub",
        email: "admin@example.com",
        firstName: undefined,
        lastName: undefined,
        multiplier: null,
        role: "admin",
      });

      // The bootstrap administrator does not need Sheet approval.
      assert.equal(calls.sheetReads, 0);
      assert.equal(calls.updatedUserId, "new-user");
    },
  );
});

test("new ordinary user is created with the multiplier from the Sheet", async () => {
  await withAuthMocks(
    {
      adminEmail: "admin@example.com",
      sheetUsers: [
        {
          email: "ordinary@example.com",
          multiplier: "1.75",
        },
      ],
    },
    async (calls) => {
      const result = await authenticateGoogleUser({
        googleSub: "ordinary-google-sub",
        email: "ordinary@example.com",
      });

      assert.equal(result.user.role, "user");
      assert.equal(result.isAdmin, false);
      assert.equal(result.isNewUser, true);

      assert.deepEqual(calls.createdUser, {
        googleSub: "ordinary-google-sub",
        email: "ordinary@example.com",
        firstName: undefined,
        lastName: undefined,
        multiplier: "1.75",
        role: "user",
      });

      assert.equal(calls.sheetReads, 1);
      assert.equal(calls.updatedUserId, "new-user");
    },
  );
});

test("new user with no Sheet authorisation is rejected", async () => {
  await withAuthMocks(
    {
      adminEmail: "admin@example.com",
      sheetUsers: [],
    },
    async (calls) => {
      await assert.rejects(
        authenticateGoogleUser({
          googleSub: "unauthorised-google-sub",
          email: "unauthorised@example.com",
        }),
        {
          message: "Your Google account is not authorised",
        },
      );

      assert.equal(calls.sheetReads, 1);
      assert.equal(calls.createdUser, null);
      assert.equal(calls.updatedUserId, null);
    },
  );
});

// ---------------------------------------------------------
// EMAIL OWNERSHIP PROTECTION
// ---------------------------------------------------------

test("rejects an email linked to another Google account", async () => {
  await withAuthMocks(
    {
      adminEmail: "admin@example.com",
      sheetUsers: [
        {
          email: "existing@example.com",
          multiplier: null,
        },
      ],
      emailOwner: {
        id: "2",
        email: "existing@example.com",
        role: "user",
      },
    },
    async (calls) => {
      await assert.rejects(
        authenticateGoogleUser({
          googleSub: "different-google-account",
          email: "existing@example.com",
        }),
        {
          message: "Email address is linked to another account",
        },
      );

      assert.equal(calls.sheetReads, 1);
      assert.equal(calls.createdUser, null);
      assert.equal(calls.updatedUserId, null);
    },
  );
});

