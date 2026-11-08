/*
 * USER PURGATORY PAGE
 *
 * Purpose:
 * Display the signed-in user's own account details while
 * their account is awaiting administrator role assignment.
 *
 * This page has no business functionality and makes no
 * additional backend requests.
 *
 * The account details come from the shared authentication
 * check, which has already been verified by the backend.
 */

(async function initialiseUserPage() {
  // Wait for the shared session and role verification to finish.
  const auth = await window.frontendAuthReady;

  // Do not display account details if verification failed.
  if (!auth || !auth.authenticated || !auth.user) {
    return;
  }

  // Display only the current user's own account information.
  const email = document.getElementById("account-email");
  const role = document.getElementById("account-role");

  // Use textContent so account data is displayed as text,
  // never interpreted as HTML.
  email.textContent = auth.user.email || "Not available";
  role.textContent = auth.user.role || "Not available";

  // Reveal the account details only after verification.
  document.getElementById("account-details").hidden = false;
})();
