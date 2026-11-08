/*
 * APPLICATION SERVER
 *
 * Purpose:
 * Load environment configuration, import the Express application,
 * and start the HTTP server.
 */

// Load environment variables before importing application modules.
// This ensures configuration is available when those modules initialise.
import "dotenv/config";

// Import the configured Express application.
import app from "./app";

// Use the PORT environment variable if supplied.
// Otherwise, use port 3000 for local development.
const PORT = process.env.PORT || 3000;

// Start the HTTP server.
app.listen(PORT, () => {
  console.log(`Google Auth Starter API listening on port ${PORT}`);
});
