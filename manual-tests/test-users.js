// Load environment variables before importing the database pool.
require("dotenv").config();

// Import the repository functions we want to test.
const usersRepository = require("../dist/repositories/usersRepository").default;

// Import the shared database pool for test cleanup.
const pool = require("../dist/config/database").default;

// Use clearly artificial test identifiers.
// These are not real Google accounts.
const testUser = {
  googleSub: "google_auth_starter-repository-test",
  email: "repository-test@invalid.example",
  multiplier: 1.25,
};

async function testUsersRepository() {
  try {
    // Remove a leftover test record if this test was run before.
    await pool.query("DELETE FROM users WHERE google_sub = $1", [
      testUser.googleSub,
    ]);

    // 1. Create a test user.
    const created = await usersRepository.createUser(testUser);
    console.log("1. Created user:");
    console.table([created]);

    // 2. Find the user using Google's identifier.
    const foundByGoogleSub = await usersRepository.findByGoogleSub(
      testUser.googleSub,
    );

    console.log("2. Found by Google ID:");
    console.table([foundByGoogleSub]);

    // 3. Find the same user using their email.
    const foundByEmail = await usersRepository.findByEmail(testUser.email);

    console.log("3. Found by email:");
    console.table([foundByEmail]);

    // 4. Record a successful login.
    const updated = await usersRepository.updateLastLogin(created.id);

    console.log("4. Updated last login:");
    console.table([updated]);
  } catch (error) {
    console.error("Repository test failed:", error.message);
    process.exitCode = 1;
  } finally {
    // Delete only our artificial test record.
    // This keeps the actual application users table clean.
    try {
      await pool.query("DELETE FROM users WHERE google_sub = $1", [
        testUser.googleSub,
      ]);
      console.log("Test record cleaned up.");
    } catch (cleanupError) {
      console.error("Test cleanup failed:", cleanupError.message);
      process.exitCode = 1;
    }

    // Close the database pool so Node.js can exit.
    await pool.end();
  }
}

testUsersRepository();
