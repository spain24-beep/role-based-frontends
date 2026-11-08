// Import Node's built-in test tools.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

// Import the spreadsheet integration being tested.
const { readAuthorisedUsers } =
  require("../dist/integrations/google/publicSheet").default;

// Keep the original fetch function so we can restore it after each test.
const originalFetch = global.fetch;

// Restore fetch and environment variables after every test.
afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.GOOGLE_SHEET_URL;
});

// Helper function to provide simulated spreadsheet CSV data.
// It imitates the streaming response returned by Node's fetch().
function mockSpreadsheet(csv) {
  const csvBytes = new TextEncoder().encode(csv);
  let hasBeenRead = false;

  global.fetch = async () => ({
    ok: true,
    status: 200,

    // Simulate the HTTP response headers.
    headers: {
      get: (name) => {
        if (name.toLowerCase() === "content-length") {
          return String(csvBytes.byteLength);
        }

        return null;
      },
    },

    // Simulate the streamed response body.
    body: {
      getReader: () => ({
        read: async () => {
          if (hasBeenRead) {
            return { done: true };
          }

          hasBeenRead = true;

          return {
            done: false,
            value: csvBytes,
          };
        },

        cancel: async () => {},
      }),
    },
  });

  process.env.GOOGLE_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/test/export?format=csv";
}

// Test that ordinary decimal multipliers are accepted.
test("accepts valid decimal multipliers", async () => {
  mockSpreadsheet(
    "Email address,multiplier\n" +
      "one@example.com,.5\n" +
      "two@example.com,1.25\n" +
      "three@example.com,20",
  );

  const users = await readAuthorisedUsers();

  assert.equal(users[0].multiplier, 0.5);
  assert.equal(users[1].multiplier, 1.25);
  assert.equal(users[2].multiplier, 20);
});

// Test that blank and invalid multipliers become null.
test("defaults blank and invalid multipliers to null", async () => {
  mockSpreadsheet(
    "Email address,multiplier\n" +
      "one@example.com,\n" +
      "two@example.com,abc\n" +
      "three@example.com,-1\n" +
      "four@example.com,20.01",
  );

  const users = await readAuthorisedUsers();

  for (const user of users) {
    assert.equal(user.multiplier, null);
  }
});

// Test that a zero multiplier is valid.
test("accepts a zero multiplier", async () => {
  mockSpreadsheet("Email address,multiplier\n" + "one@example.com,0");

  const users = await readAuthorisedUsers();

  assert.equal(users[0].multiplier, 0);
});

// Test that Email address is mandatory.
test("rejects a spreadsheet missing the Email address column", async () => {
  mockSpreadsheet("Name,multiplier\n" + "Example User,1.5");

  await assert.rejects(
    readAuthorisedUsers(),
    /missing required column: Email address/,
  );
});

// Test that duplicate Email address headers are rejected.
test("rejects duplicate Email address headers", async () => {
  mockSpreadsheet(
    "Email address,Email address,multiplier\n" +
      "one@example.com,two@example.com,1",
  );

  await assert.rejects(
    readAuthorisedUsers(),
    /duplicate column: Email address/,
  );
});

// Test that multiplier is optional.
test("accepts a spreadsheet without a multiplier column", async () => {
  mockSpreadsheet("Email address\n" + "ONE@example.com\n" + "two@example.com");

  const users = await readAuthorisedUsers();

  assert.equal(users.length, 2);
  assert.deepEqual(users, [
    {
      email: "one@example.com",
      multiplier: null,
    },
    {
      email: "two@example.com",
      multiplier: null,
    },
  ]);
});

// Test that additional columns do not break the integration.
test("accepts additional spreadsheet columns", async () => {
  mockSpreadsheet(
    "Email address,multiplier,Name,Department\n" +
      "one@example.com,1.5,Example User,Finance",
  );

  const users = await readAuthorisedUsers();

  assert.deepEqual(users, [
    {
      email: "one@example.com",
      multiplier: 1.5,
    },
  ]);
});

// Reject a spreadsheet with no CSV content or header row.
test("rejects an empty spreadsheet", async () => {
  mockSpreadsheet("");

  await assert.rejects(
    readAuthorisedUsers(),
    /empty or does not contain a header row/,
  );
});

// Reject spreadsheet URLs that do not use HTTPS.
test("rejects spreadsheet URLs that do not use HTTPS", async () => {
  process.env.GOOGLE_SHEET_URL =
    "http://docs.google.com/spreadsheets/d/test/export?format=csv";

  // Fetch must never be called when the URL is invalid.
  global.fetch = async () => {
    throw new Error("Fetch should not have been called");
  };

  await assert.rejects(
    readAuthorisedUsers(),
    /must be a valid Google Sheets URL/,
  );
});

// Reject URLs hosted outside Google Sheets.
test("rejects spreadsheet URLs hosted outside Google", async () => {
  process.env.GOOGLE_SHEET_URL =
    "https://evil.example/spreadsheets/d/test/export";

  global.fetch = async () => {
    throw new Error("Fetch should not have been called");
  };

  await assert.rejects(
    readAuthorisedUsers(),
    /must be a valid Google Sheets URL/,
  );
});

// Reject a spreadsheet response whose Content-Length exceeds 1 MB.
test("rejects a spreadsheet with an oversized Content-Length", async () => {
  process.env.GOOGLE_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/test/export?format=csv";

  let bodyCancelled = false;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => String(1024 * 1024 + 1),
    },
    body: {
      cancel: async () => {
        bodyCancelled = true;
      },
    },
  });

  await assert.rejects(readAuthorisedUsers(), /exceeds the 1 MB size limit/);

  assert.equal(bodyCancelled, true);
});

// Reject a spreadsheet that exceeds 1 MB while being downloaded.
test("rejects a spreadsheet that exceeds the size limit while streaming", async () => {
  process.env.GOOGLE_SHEET_URL =
    "https://docs.google.com/spreadsheets/d/test/export?format=csv";

  let readCount = 0;
  let bodyCancelled = false;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get: () => null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          readCount++;

          if (readCount === 1) {
            // Return a chunk larger than the permitted 1 MB.
            return {
              done: false,
              value: new Uint8Array(1024 * 1024 + 1),
            };
          }

          return { done: true };
        },
        cancel: async () => {
          bodyCancelled = true;
        },
      }),
    },
  });

  await assert.rejects(readAuthorisedUsers(), /exceeds the 1 MB size limit/);

  assert.equal(bodyCancelled, true);
});
