/*
 * DATABASE PORT VALIDATION TESTS
 *
 * Purpose:
 * Verify that the shared database port validator accepts valid TCP ports
 * and rejects missing, malformed or out-of-range values.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { getDatabasePort } = require("../dist/config/databasePort");

test("accepts a normal PostgreSQL port", () => {
  assert.equal(getDatabasePort("5432"), 5432);
});

test("accepts the lowest valid TCP port", () => {
  assert.equal(getDatabasePort("1"), 1);
});

test("accepts the highest valid TCP port", () => {
  assert.equal(getDatabasePort("65535"), 65535);
});

test("rejects a missing port", () => {
  assert.throws(
    () => getDatabasePort(undefined),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects an empty port", () => {
  assert.throws(
    () => getDatabasePort(""),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects a whitespace-only port", () => {
  assert.throws(
    () => getDatabasePort("   "),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects a port containing whitespace", () => {
  assert.throws(
    () => getDatabasePort(" 5432 "),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects non-numeric values", () => {
  assert.throws(
    () => getDatabasePort("postgres"),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects decimal values", () => {
  assert.throws(
    () => getDatabasePort("5432.5"),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects scientific notation", () => {
  assert.throws(
    () => getDatabasePort("5.432e3"),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects zero", () => {
  assert.throws(
    () => getDatabasePort("0"),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects negative values", () => {
  assert.throws(
    () => getDatabasePort("-5432"),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});

test("rejects values above the TCP port range", () => {
  assert.throws(
    () => getDatabasePort("65536"),
    /DB_PORT must be an integer between 1 and 65535/,
  );
});
