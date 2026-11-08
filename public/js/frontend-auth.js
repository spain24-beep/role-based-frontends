/*
 * FRONTEND AUTHENTICATION CHECK
 *
 * Purpose:
 * Verify the user's session and role before a role-specific
 * frontend displays its content.
 *
 * The resulting promise is shared with other frontend scripts.
 * This prevents each script from making its own session request.
 *
 * Security:
 * - The backend remains authoritative for authentication and roles.
 * - The HTML role is only a comparison value, never proof of permission.
 * - An invalid session returns the visitor to the login page.
 * - The backend must still enforce permissions on every protected API.
 */

window.frontendAuthReady = (async function verifyFrontendAuthentication() {
  // Read the role this particular frontend is designed for.
  const expectedRole = document.querySelector('meta[name="app-role"]')?.content;

  // Fail closed if the frontend has not declared its expected role.
  if (!expectedRole) {
    document.body.textContent =
      "Frontend configuration error: expected role is missing.";

    return { authenticated: false, error: true };
  }

  try {
    // Ask the backend to verify the current session.
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    // An invalid or expired session requires a new login.
    if (response.status === 401) {
      window.location.assign("/");
      return { authenticated: false };
    }

    // Do not continue if the backend could not verify the session.
    if (!response.ok) {
      throw new Error("Session verification failed");
    }

    // Read the standard API success envelope.
    const result = await response.json();

    // Confirm that the response follows the expected API format.
    if (
      result.success !== true ||
      !result.data ||
      result.data.status !== "authenticated"
    ) {
      throw new Error("Invalid session response");
    }

    // Compare the database role with this frontend's declared role.
    if (result.data.role !== expectedRole) {
      document.body.textContent =
        "Access denied: your account does not have access to this frontend.";

      return { authenticated: false };
    }

    // Return the backend-verified user details to other scripts.
    return {
      authenticated: true,
      user: result.data.user,
    };
  } catch (error) {
    // Do not allow the frontend to continue as authenticated
    // when the backend could not verify the session.
    console.error("Frontend authentication check failed:", error);

    document.body.textContent =
      "Unable to verify your session. Please reload the page.";

    return { authenticated: false, error: true };
  }
})();
