/*
 * DATABASE READINESS ROUTE TESTS
 *
 * Purpose:
 * Verify that the readiness endpoint:
 *
 * 1. Returns HTTP 200 when PostgreSQL responds successfully.
 * 2. Returns HTTP 503 when PostgreSQL is unavailable.
 * 3. Does not expose internal database error details.
 *
 * A small fake database object is injected into the route.
 * This keeps the tests independent of a live PostgreSQL server.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createReadinessRouter } = require("../dist/routes/health");

async function withReadinessServer(database, callback) {
  const app = express();

  app.use("/health/ready", createReadinessRouter(database));

  const server = app.listen(0, "127.0.0.1");

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/health/ready`;

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

test("readiness returns HTTP 200 when PostgreSQL responds", async () => {
  let receivedQuery = null;

  const database = {
    query: async (sql) => {
      receivedQuery = sql;
      return { rows: [{ "?column?": 1 }] };
    },
  };

  await withReadinessServer(database, async (url) => {
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      success: true,
      data: {
        status: "ready",
        database: "connected",
      },
    });

    assert.equal(receivedQuery, "SELECT 1");
  });
});

test("readiness returns HTTP 503 when PostgreSQL is unavailable", async () => {
  const database = {
    query: async () => {
      const error = new Error("Private database connection details");
      error.code = "ECONNREFUSED";
      throw error;
    },
  };

  await withReadinessServer(database, async (url) => {
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.deepEqual(body, {
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Service is not ready",
      },
    });

    assert.equal(
      JSON.stringify(body).includes("Private database connection details"),
      false,
    );

    assert.equal(JSON.stringify(body).includes("ECONNREFUSED"), false);
  });
});
