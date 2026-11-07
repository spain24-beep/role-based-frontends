/*
 * FRONTEND AUTHENTICATION CHECK
 *
 * Purpose:
 * Verify the user's session when a role-specific frontend loads.
 *
 * How it works:
 * 1. Read the expected role from the frontend's HTML metadata.
 * 2. Request the current authenticated user from the backend.
 * 3. Check that the session is valid.
 * 4. Confirm that the user's database role matches this frontend.
 * 5. Make the authenticated user details available to the frontend.
 *
 * Important security decisions:
 * - The backend remains authoritative for authentication and roles.
 * - The expected role is used only for comparison, never as proof
 *   of the user's permissions.
 * - An invalid session returns the visitor to the login page.
 * - An authenticated user remains on the current URL.
 */

(async function verifyFrontendAuthentication() {

    // Read the role this particular frontend is designed for.
    // Each frontend declares its own role in its HTML metadata.
    const expectedRole = document.querySelector(
        'meta[name="app-role"]'
    )?.content;

    // Fail closed if the frontend has not declared its expected role.
    if (!expectedRole) {
        document.body.textContent =
            "Frontend configuration error: expected role is missing.";
        return;
    }

    try {

        // Ask the backend to verify the current session.
        // The browser sends its session cookie automatically.
        const response = await fetch("/api/auth/me", {
            method: "GET",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json"
            }
        });

        // An invalid or expired session requires a new login.
        if (response.status === 401) {
            window.location.assign("/");
            return;
        }

        // Do not continue if the backend could not verify the session.
        if (!response.ok) {
            throw new Error("Session verification failed");
        }

        // Read the authenticated user returned by the backend.
        const result = await response.json();

        // Confirm that the authenticated user's database role
        // matches the frontend currently being accessed.
        if (
            result.status !== "authenticated" ||
            result.role !== expectedRole
        ) {
            document.body.textContent =
                "Access denied: your account does not have access to this frontend.";
            return;
        }

        // Make the verified user details available to this frontend.
        // These details are for display and application behaviour;
        // the backend must still enforce all permissions on API requests.
        window.authenticatedUser = result.user;

    } catch (error) {

        // Do not allow the frontend to continue as though authentication
        // succeeded when the backend could not verify the session.
        console.error("Frontend authentication check failed:", error);

        document.body.textContent =
            "Unable to verify your session. Please reload the page.";
    }

})();
