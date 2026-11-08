/*
 * DATABASE PORT VALIDATION
 *
 * Purpose:
 * Validate the PostgreSQL TCP port before it is passed to a connection pool.
 *
 * Both the application and migration database pools use this helper so
 * that they enforce exactly the same port rules.
 */

export function getDatabasePort(value: string | undefined): number {
  // Accept only a string of decimal digits.
  // This rejects whitespace, decimals, negative values and scientific notation.
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error("DB_PORT must be an integer between 1 and 65535");
  }

  const port = Number(value);

  // A TCP port must be a safe integer within the valid port range.
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535");
  }

  return port;
}
