/*
 * SHARED SITE BANNER
 *
 * Purpose:
 * Display a consistent authentication banner across every frontend.
 *
 * Behaviour:
 * - Display Login when there is no authenticated session.
 * - Display the user's full name when a valid session exists.
 * - Display Logout when a valid session exists.
 * - Destroy the server session when Logout is selected.
 *
 * Session verification:
 * - Role-specific frontends reuse the promise from frontend-auth.js.
 * - The public login page performs its own session check because
 *   it does not load frontend-auth.js.
 *
 * Security:
 * The backend determines whether the session is valid.
 * This script never treats browser-stored information as proof
 * of authentication or authorization.
 */

(function initialiseSiteBanner() {
  // Create the shared banner.
  const banner = document.createElement("header");
  banner.id = "site-banner";
  banner.className = "site-banner";

  // Create the application title.
  const title = document.createElement("div");
  title.className = "site-banner-title";
  title.textContent = "Google Auth Starter";

  // Create the area containing the authentication button.
  const actions = document.createElement("div");
  actions.className = "site-banner-actions";

  // Display a neutral state until the session check completes.
  const status = document.createElement("span");
  status.className = "site-banner-status";
  status.textContent = "Checking session...";

  // Create the Login / Logout button.
  const button = document.createElement("button");
  button.type = "button";
  button.className = "site-banner-button";
  button.textContent = "Checking...";
  button.disabled = true;

  actions.append(status, button);
  banner.append(title, actions);

  // Insert the banner before the page's other content.
  document.body.prepend(banner);

  /*
   * Build the display name from the name fields returned by the backend.
   *
   * The backend supplies firstName and lastName from the names stored
   * when the user account was created.
   *
   * The fallback prevents an empty or misleading name if Google did
   * not supply either name when the account was created.
   */
  function formatFullName(user) {
    const firstName = user?.firstName?.trim() || "";
    const lastName = user?.lastName?.trim() || "";

    return [firstName, lastName].filter(Boolean).join(" ");
  }

  /*
   * Display the logged-out state.
   *
   * Login takes the visitor to the public login page.
   * If already there, focus the Google sign-in button.
   */
  function showLoggedOut() {
    status.textContent = "Not signed in";
    button.textContent = "Login";
    button.disabled = false;

    button.onclick = function () {
      if (window.location.pathname === "/") {
        document.getElementById("google-button")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } else {
        window.location.assign("/");
      }
    };
  }

  /*
   * Display the logged-in state.
   *
   * The authenticated user object is supplied by the backend
   * session response. Its stored first and last names are combined
   * for display in the banner.
   *
   * Logout calls the backend so the server-side session
   * is destroyed rather than merely hiding the button.
   */
  function showLoggedIn(user) {
    const fullName = formatFullName(user);

    status.textContent = fullName
      ? `Signed in as ${fullName}`
      : "Signed in";

    button.textContent = "Logout";
    button.disabled = false;

    button.onclick = async function () {
      button.disabled = true;
      button.textContent = "Logging out...";

      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error("Logout failed");
        }

        // Return to the public login screen after logout.
        window.location.assign("/");
      } catch (error) {
        console.error("Logout failed:", error);

        status.textContent = "Logout failed. Please try again.";
        button.textContent = "Logout";
        button.disabled = false;
      }
    };
  }

  /*
   * Check the session.
   *
   * Role-specific frontends reuse frontendAuthReady, which has
   * already made the session request.
   *
   * The public login page has no frontendAuthReady promise,
   * so it performs the session check itself.
   */
  async function checkSession() {
    try {
      if (window.frontendAuthReady) {
        const auth = await window.frontendAuthReady;

        if (auth.authenticated) {
          showLoggedIn(auth.user);
        } else if (auth.error) {
          status.textContent = "Session verification unavailable";
          button.textContent = "Unavailable";
          button.disabled = true;
        } else {
          showLoggedOut();
        }

        return;
      }

      // The public login page uses this independent session check.
      const response = await fetch("/api/auth/me", {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      });

      if (response.status === 401) {
        showLoggedOut();
        return;
      }

      if (!response.ok) {
        throw new Error("Session verification failed");
      }

      const result = await response.json();

      if (
        result.success !== true ||
        !result.data ||
        result.data.status !== "authenticated"
      ) {
        throw new Error("Unexpected authentication response");
      }

      showLoggedIn(result.data.user);
    } catch (error) {
      console.error("Banner session check failed:", error);

      status.textContent = "Session verification unavailable";
      button.textContent = "Unavailable";
      button.disabled = true;
    }
  }

  // Start the session check after the banner has been inserted.
  checkSession();
})();
