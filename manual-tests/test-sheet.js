// Load environment variables from .env.
require("dotenv").config();

// Import the spreadsheet reader we just created.
const { readAuthorisedUsers } =
  require("../dist/integrations/google/publicSheet").default;

// Run the test.
async function testSheet() {
  try {
    // Fetch and parse the public spreadsheet.
    const users = await readAuthorisedUsers();

    // Display the number of authorised users found.
    console.log("Authorised users found:", users.length);

    // Display the parsed records.
    console.table(users);
  } catch (error) {
    // Display any error encountered during the test.
    console.error("Spreadsheet test failed:", error.message);

    process.exitCode = 1;
  }
}

// Start the test.
testSheet();
