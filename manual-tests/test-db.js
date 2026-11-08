// Load .env before importing the database connection.
require("dotenv").config();

// Import the PostgreSQL connection pool.
const pool = require("../dist/config/database").default;

// Test the connection with a simple SQL query.
async function testDatabase() {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, current_user AS user",
    );

    console.log("Database connection successful:");
    console.table(result.rows);
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    // Close the pool so this test process can exit cleanly.
    await pool.end();
  }
}

testDatabase();
