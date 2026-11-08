/*
 * DUMMY1 TEST FRONTEND
 *
 * Purpose:
 * Prove that the authenticated user can reach the frontend
 * assigned to the dummy1 database role.
 *
 * Authentication:
 * Reuses window.frontendAuthReady from frontend-auth.js.
 * No second authentication request is made here.
 *
 * Security:
 * - This script does not establish authentication itself.
 * - The backend has already verified the session and role.
 * - User-supplied account values are displayed using textContent,
 *   so they cannot be interpreted as HTML.
 * - This page contains no business functionality or privileged
 *   operations.
 */

(async function initialiseDummy1Dashboard() {
  // Wait for the shared backend authentication and role check.
  const auth = await window.frontendAuthReady;

  // Do not reveal the dashboard unless authentication succeeded.
  if (!auth || !auth.authenticated || !auth.user) {
    return;
  }

  // Build the display name from the account's stored name fields.
  const firstName = auth.user.firstName?.trim() || "";
  const lastName = auth.user.lastName?.trim() || "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  // Display the verified account information as plain text.
  document.getElementById("account-name").textContent =
    fullName || "Not available";

  document.getElementById("account-email").textContent =
    auth.user.email || "Not available";

  document.getElementById("account-role").textContent =
    auth.user.role || "Not available";

  // Reveal the dashboard only after the shared check succeeds.
  document.getElementById("verification-panel").hidden = false;
})();
