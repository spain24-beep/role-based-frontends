/*
 * Browser-side Google authentication.
 *
 * This file:
 * 1. Retrieves public Google sign-in configuration from our backend.
 * 2. Loads Google's Identity Services library.
 * 3. Displays Google's official sign-in button.
 * 4. Receives the ID token after successful sign-in.
 * 5. Sends that token to our Express backend.
 * 6. Navigates to the frontend selected by the backend.
 *
 * The backend remains authoritative for identity, account access
 * and role. The Google Client ID is supplied by the backend from
 * its environment; no Client ID is hardcoded in this file.
 */

// References to elements on our login page.
const statusElement = document.getElementById("status");
const userDetailsElement = document.getElementById("user-details");
const googleButtonElement = document.getElementById("google-button");

// Hold the public Client ID retrieved from the backend.
let googleClientId = null;

/*
 * Called by Google Identity Services after successful sign-in.
 * The response contains the Google ID token.
 */
window.handleGoogleCredentialResponse = async function (response) {
  statusElement.textContent = "Verifying your Google account...";
  userDetailsElement.textContent = "";

  try {
    // Send the Google ID token to our backend.
    const serverResponse = await fetch("/api/auth/google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        credential: response.credential,
      }),
    });

    // Parse the standard API response envelope.
    const result = await serverResponse.json();

    // Error responses use:
    // { success: false, error: { code, message } }
    if (!serverResponse.ok) {
      throw new Error(result.error?.message || "Authentication failed");
    }

    // Successful responses use:
    // { success: true, data: { ... } }
    if (
      result.success !== true ||
      !result.data ||
      typeof result.data !== "object"
    ) {
      throw new Error("Invalid authentication response");
    }

    const redirectTo = result.data.redirectTo;

    // Validate the public frontend path before allowing browser navigation.
    // Only a single, lowercase role segment is accepted.
    // The role is not hardcoded; it comes from the authenticated user's record.
    if (
      typeof redirectTo !== "string" ||
      !/^\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(redirectTo)
    ) {
      throw new Error("Invalid frontend destination");
    }

    // Navigate to the frontend selected using the database role.
    window.location.assign(redirectTo);
  } catch (error) {
    statusElement.textContent = error.message;
    console.error("Sign-in error:", error);
  }
};

/*
 * Load Google's Identity Services library only after retrieving
 * the Client ID from the backend.
 */
function loadGoogleIdentityServices() {
  const googleScript = document.createElement("script");

  googleScript.src = "https://accounts.google.com/gsi/client";
  googleScript.async = true;

  googleScript.onload = function () {
    // Initialise Google sign-in using the backend-provided Client ID.
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: window.handleGoogleCredentialResponse,
    });

    // Display Google's official sign-in button.
    google.accounts.id.renderButton(googleButtonElement, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
    });

    statusElement.textContent = "Ready to sign in.";
  };

  googleScript.onerror = function () {
    statusElement.textContent =
      "Could not load Google sign-in. Check your internet connection.";
  };

  document.head.appendChild(googleScript);
}

/*
 * Retrieve the public configuration from our own backend.
 *
 * This keeps the Google Client ID in one place: the server's .env.
 * The endpoint returns only the public Client ID, never secrets.
 */
async function initialiseGoogleSignIn() {
  try {
    statusElement.textContent = "Loading sign-in...";

    const response = await fetch("/api/config");

    const result = await response.json();

    if (
      !response.ok ||
      result.success !== true ||
      typeof result.data?.googleClientId !== "string" ||
      result.data.googleClientId.trim() === ""
    ) {
      throw new Error(
        result.error?.message || "Could not load sign-in configuration",
      );
    }

    googleClientId = result.data.googleClientId;

    // Load Google's library only when configuration is available.
    loadGoogleIdentityServices();
  } catch (error) {
    statusElement.textContent = error.message;
    console.error("Google sign-in initialisation error:", error);
  }
}

// Initialise Google sign-in when this script loads.
initialiseGoogleSignIn();
