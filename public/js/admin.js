
/*
 * ADMIN DASHBOARD
 *
 * Purpose:
 * Provide the administrator interface for browsing application users.
 *
 * Security:
 * - Wait for the shared authentication and role check before loading data.
 * - Call only the existing administrator-protected API.
 * - Render API values using textContent, never as HTML.
 * - Do not expose Google's internal account identifier.
 *
 * User management:
 * - Load available roles from the administrator API.
 * - Submit role changes to the administrator API.
 * - Revert a role selection when the server rejects a change.
 * - Allow administrators to edit first and last names explicitly.
 * - Allow administrators to edit the multiplier explicitly.
 *
 * Account dialog:
 * - All editable fields are inside the account details section.
 * - Email and account metadata remain read-only.
 * - Cancel, the close icon and Escape discard unsaved changes.
 * - Done saves changed fields and closes only after successful updates.
 *
 * Google authentication does not update names after account creation.
 * Name changes are made only through the administrator API.
 */

(async function initialiseAdminDashboard() {
  // Wait until the shared authentication script has verified this session.
  const auth = await window.frontendAuthReady;

  // Stop if the session or administrator role could not be verified.
  if (!auth || !auth.authenticated) {
    return;
  }

  // Keep references to the page elements used by this module.
  const elements = {
    sidebar: document.getElementById("admin-sidebar"),
    mobileNavToggle: document.getElementById("mobile-nav-toggle"),
    navItems: document.querySelectorAll(".nav-item"),
    views: document.querySelectorAll(".admin-view"),
    totalUsers: document.getElementById("total-users"),
    pageUsers: document.getElementById("page-users"),
    search: document.getElementById("user-search"),
    roleFilter: document.getElementById("role-filter"),
    refreshButton: document.getElementById("refresh-users"),
    status: document.getElementById("users-status"),
    tableBody: document.getElementById("users-table-body"),
    paginationSummary: document.getElementById("pagination-summary"),
    previousPage: document.getElementById("previous-page"),
    nextPage: document.getElementById("next-page"),
    dialog: document.getElementById("user-dialog"),
    detailList: document.getElementById("user-detail-list"),
    closeDialog: document.getElementById("close-user-dialog"),
    cancelButton: document.getElementById("dialog-cancel"),
    doneButton: document.getElementById("dialog-done"),
  };

  // Keep pagination, filtering and dialog state in one place.
  const state = {
    limit: 25,
    offset: 0,
    role: "",
    search: "",
    total: 0,
    totalAccounts: 0,
    requestNumber: 0,
    searchTimer: null,
    roles: [],
    rolesError: "",
    selectedUser: null,
    dialogFields: null,
    dialogStatus: null,
    isSavingDialog: false,
    isLoadingUsers: false,
    lastRequestStartedAt: 0,
    lastSuccessfulRefresh: null,
    autoRefreshTimer: null,
  };

  // Refresh the directory every minute while this page is visible.
  const AUTO_REFRESH_INTERVAL_MS = 60_000;

  // Display a status message without interpreting it as HTML.
  function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle("is-error", isError);
  }

  // Format the time of the most recent successful directory refresh.
  function formatRefreshTime(date) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  }

  // Refresh when the administrator returns, unless a request just started
  // or another directory request is already running.
  function refreshDashboardIfNeeded() {
    if (document.visibilityState !== "visible" || state.isLoadingUsers) {
      return;
    }

    // Focus and visibility events can fire together. Avoid duplicate requests.
    if (Date.now() - state.lastRequestStartedAt < 5000) {
      return;
    }

    loadUsers();
  }

  // Start the periodic refresh only while the dashboard tab is visible.
  function startAutoRefresh() {
    if (
      document.visibilityState !== "visible" ||
      state.autoRefreshTimer !== null
    ) {
      return;
    }

    state.autoRefreshTimer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !state.isLoadingUsers
      ) {
        loadUsers();
      }
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  // Stop the periodic refresh when the administrator leaves the tab.
  function stopAutoRefresh() {
    if (state.autoRefreshTimer !== null) {
      window.clearInterval(state.autoRefreshTimer);
      state.autoRefreshTimer = null;
    }
  }

  // Create a table cell containing plain text.
  function createCell(value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = value;

    if (className) {
      cell.className = className;
    }

    return cell;
  }

  // Format a date supplied by the API for display.
  function formatDate(value) {
    if (!value) {
      return "Never";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Not available";
    }

    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(date);
  }

  // Format the account multiplier without inventing a default.
  function formatMultiplier(value) {
    return value === null || value === undefined || value === ""
      ? "Not set"
      : String(value);
  }

  // Combine the stored first and last names for the directory table.
  // Names are optional, so show a dash if neither is available.
  function formatFullName(user) {
    const fullName = [user.firstName, user.lastName]
      .map((name) => (typeof name === "string" ? name.trim() : ""))
      .filter(Boolean)
      .join(" ");

    return fullName || "—";
  }

  // Create the role badge using a text node, not API-generated markup.
  function createRoleBadge(role) {
    const badge = document.createElement("span");
    badge.className = "role-badge";

    if (role === "admin") {
      badge.classList.add("is-admin");
    }

    badge.textContent = role || "Unknown";
    return badge;
  }

  // Add one row to the account details list.
  // The editor controls are created as DOM elements rather than HTML strings.
  function createDetailRow(label, value, control = null) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = label;

    if (control) {
      description.append(control);
    } else {
      description.textContent =
        value === null || value === undefined || value === ""
          ? "Not available"
          : String(value);
    }

    row.append(term, description);
    elements.detailList.append(row);
  }

  // Create the account dialog's status message.
  // It sits inside the existing dialog rather than creating another editor.
  function createDialogStatus() {
    const status = document.createElement("p");
    status.className = "name-save-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    elements.detailList.after(status);
    state.dialogStatus = status;
  }


  // Show a message inside the account dialog.
  function setDialogStatus(message, isError = false) {
    state.dialogStatus.textContent = message;
    state.dialogStatus.classList.toggle("is-error", isError);
  }

  // Populate the account dialog with the selected user's current details.
  function showUserDetails(user) {
    state.selectedUser = user;

    // Build the editable first-name field.
    const firstNameInput = document.createElement("input");
    firstNameInput.type = "text";
    firstNameInput.name = "firstName";
    firstNameInput.maxLength = 100;
    firstNameInput.autocomplete = "off";
    firstNameInput.value = user.firstName || "";
    firstNameInput.setAttribute("aria-label", "First name");

    // Build the editable last-name field.
    const lastNameInput = document.createElement("input");
    lastNameInput.type = "text";
    lastNameInput.name = "lastName";
    lastNameInput.maxLength = 100;
    lastNameInput.autocomplete = "off";
    lastNameInput.value = user.lastName || "";
    lastNameInput.setAttribute("aria-label", "Last name");

    // Build the role dropdown using the roles returned by the API.
    const roleSelect = document.createElement("select");
    roleSelect.name = "role";
    roleSelect.className = "role-select";
    roleSelect.setAttribute("aria-label", "User role");

    // Preserve an existing role if it is no longer in the deployed-role list.
    // The API remains responsible for deciding whether a role can be assigned.
    const availableRoles = [...state.roles];

    if (user.role && !availableRoles.includes(user.role)) {
      availableRoles.push(user.role);
    }

    for (const role of availableRoles) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      roleSelect.append(option);
    }

    roleSelect.value = user.role || "";
    roleSelect.disabled = availableRoles.length === 0;

    // Build the editable multiplier field.
    // An empty value represents NULL, not zero or the default multiplier.
    const multiplierInput = document.createElement("input");
    multiplierInput.type = "number";
    multiplierInput.name = "multiplier";
    multiplierInput.min = "0";
    multiplierInput.max = "20";
    multiplierInput.step = "any";
    multiplierInput.value =
      user.multiplier === null || user.multiplier === undefined
        ? ""
        : String(user.multiplier);
    multiplierInput.placeholder = "Not set";
    multiplierInput.setAttribute("aria-label", "Multiplier");

    // Rebuild the details list so it contains exactly one set of account details.
    elements.detailList.replaceChildren();

    createDetailRow("First Name", null, firstNameInput);
    createDetailRow("Last Name", null, lastNameInput);
    createDetailRow("Email", user.email);
    createDetailRow("Role", null, roleSelect);
    createDetailRow("Multiplier", null, multiplierInput);
    createDetailRow("User ID", user.id);
    createDetailRow("Account created", formatDate(user.createdAt));
    createDetailRow("Last updated", formatDate(user.updatedAt));
    createDetailRow("Last login", formatDate(user.lastLoginAt));

    // Keep references to the controls so saving and cancellation can use them.
    state.dialogFields = {
      firstNameInput,
      lastNameInput,
      roleSelect,
      multiplierInput,
    };

    // Clear any message left over from a previous account.
    setDialogStatus("");

    elements.doneButton.disabled = false;
    elements.cancelButton.disabled = false;

    elements.dialog.showModal();
  }

  // Disable or enable every editable control while a save is in progress.
  function setDialogSaving(isSaving) {
    state.isSavingDialog = isSaving;

    const fields = state.dialogFields;

    if (fields) {
      fields.firstNameInput.disabled = isSaving;
      fields.lastNameInput.disabled = isSaving;
      fields.roleSelect.disabled =
        isSaving || state.roles.length === 0;
      fields.multiplierInput.disabled = isSaving;
    }

    elements.doneButton.disabled = isSaving;
    elements.cancelButton.disabled = isSaving;
    elements.closeDialog.disabled = isSaving;
  }

  // Send one account update to its dedicated administrator API endpoint.
  // The server response is used as the authoritative updated account record.
  async function sendUserUpdate(user, endpoint, body, errorMessage) {
    const response = await fetch(
      `/api/admin/users/${encodeURIComponent(user.id)}/${endpoint}`,
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const result = await response.json();

    if (!response.ok || !result.success || !result.data?.user) {
      throw new Error(result.error?.message || errorMessage);
    }

    // Keep the selected user object in sync with the server response.
    Object.assign(user, result.data.user);

    return result.data.user;
  }

  // Save only the fields that have changed since the dialog was opened.
  async function saveUserDetails() {
    const user = state.selectedUser;
    const fields = state.dialogFields;

    // Do not submit if the dialog no longer has a selected account.
    if (!user || !fields || state.isSavingDialog) {
      return;
    }

    const firstName = fields.firstNameInput.value.trim();
    const lastName = fields.lastNameInput.value.trim();
    const role = fields.roleSelect.value;
    const multiplierText = fields.multiplierInput.value.trim();

    // Match the server's name-length validation before making a request.
    if (firstName.length > 100 || lastName.length > 100) {
      setDialogStatus(
        "Each name must be no longer than 100 characters.",
        true,
      );
      return;
    }

    // Validate the multiplier before sending it to the API.
    // A blank value is deliberately allowed and means NULL.
    let multiplier = null;

    if (multiplierText !== "") {
      multiplier = Number(multiplierText);

      if (
        !Number.isFinite(multiplier) ||
        multiplier < 0 ||
        multiplier > 20
      ) {
        setDialogStatus(
          "Multiplier must be a number between 0 and 20, or left blank.",
          true,
        );
        return;
      }
    }

    // Capture the original values so only changed fields are submitted.
    // After each successful request, the user object is updated from the API.
    const namesChanged =
      firstName !== (user.firstName || "") ||
      lastName !== (user.lastName || "");

    const roleChanged = role !== (user.role || "");

    const originalMultiplier =
      user.multiplier === null || user.multiplier === undefined
        ? null
        : Number(user.multiplier);

    const multiplierChanged = multiplier !== originalMultiplier;

    // There is nothing to save. Close without making unnecessary API calls.
    if (!namesChanged && !roleChanged && !multiplierChanged) {
      closeUserDialog();
      return;
    }

    setDialogSaving(true);
    setDialogStatus("Saving changes...");

    try {
      // Save names first, using the existing names endpoint.
      if (namesChanged) {
        await sendUserUpdate(
          user,
          "names",
          { firstName, lastName },
          "The user's name could not be saved.",
        );
      }

      // Save the role using the existing role endpoint.
      // This endpoint performs the server-side deployed-role and
      // self-demotion checks; the browser does not replace those checks.
      if (roleChanged) {
        await sendUserUpdate(
          user,
          "role",
          { role },
          "The user's role could not be saved.",
        );
      }

      // Save the multiplier using the dedicated multiplier endpoint.
      // null is sent when the field is blank so the database value is cleared.
      if (multiplierChanged) {
        await sendUserUpdate(
          user,
          "multiplier",
          { multiplier },
          "The user's multiplier could not be saved.",
        );
      }

      // Refresh the directory so the full name, role and multiplier columns
      // reflect the saved values. loadUsers handles its own display errors.
      await loadUsers();

      // A successful save is allowed to close the dialog immediately.
      closeUserDialog(true);
    } catch (error) {
      // A previous field may already have been saved successfully.
      // Keep the dialog open so the administrator can review and retry.
      // The user object was updated after each successful API response,
      // so a retry will not unnecessarily resubmit those successful changes.
      setDialogStatus(
        error.message || "One or more account changes could not be saved.",
        true,
      );
    } finally {
      setDialogSaving(false);
    }
  }

  // Close the dialog and discard any unsaved field values.
  function closeUserDialog(force = false) {
    // Prevent cancellation during saving, but allow a successful save to close.
    if (state.isSavingDialog && !force) {
      return;
    }

    if (elements.dialog.open) {
      elements.dialog.close();
    }

    state.selectedUser = null;
    state.dialogFields = null;
    state.dialogStatus.textContent = "";
    state.dialogStatus.classList.remove("is-error");
  }

  // Render the current page of users into the directory table.
  function renderUsers(users) {
    elements.tableBody.replaceChildren();

    if (users.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 7;
      cell.className = "table-message";
      cell.textContent = "No users match these filters.";

      row.append(cell);
      elements.tableBody.append(row);
      return;
    }

    for (const user of users) {
      const row = document.createElement("tr");

      const emailCell = createCell(user.email || "Not available");
      emailCell.classList.add("account-email");

      // Offer only roles reported by the server as deployed frontends.
      const roleCell = document.createElement("td");
      const roleSelect = document.createElement("select");

      roleSelect.className = "role-select";
      roleSelect.setAttribute(
        "aria-label",
        `Change role for ${user.email || "this user"}`,
      );

      // Preserve visibility of an existing role if its frontend has since
      // been removed. The server will still reject assigning that role.
      const availableRoles = [...state.roles];

      if (user.role && !availableRoles.includes(user.role)) {
        availableRoles.push(user.role);
      }

      for (const role of availableRoles) {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = role
          .split("-")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
        roleSelect.append(option);
      }

      roleSelect.value = user.role || "";
      roleSelect.disabled = state.roles.length === 0;

      // The server remains authoritative for permission checks, including
      // the rule preventing an administrator from demoting themselves.
      roleSelect.addEventListener("change", () => {
        updateUserRole(user, roleSelect);
      });

      roleCell.append(roleSelect);

      const actionCell = document.createElement("td");
      const viewButton = document.createElement("button");

      viewButton.type = "button";
      viewButton.className = "view-button";
      viewButton.textContent = "View";
      viewButton.setAttribute(
        "aria-label",
        `View account details for ${user.email || "this user"}`,
      );

      // The button uses the user object from the current API response.
      viewButton.addEventListener("click", () => showUserDetails(user));
      actionCell.append(viewButton);

      row.append(
        createCell(formatFullName(user)),
        emailCell,
        roleCell,
        createCell(formatMultiplier(user.multiplier)),
        createCell(formatDate(user.createdAt)),
        createCell(formatDate(user.lastLoginAt)),
        actionCell,
      );

      elements.tableBody.append(row);
    }
  }

  // Update the pagination summary and enable only valid page actions.
  function renderPagination() {
    const first = state.total === 0 ? 0 : state.offset + 1;
    const last = Math.min(state.offset + state.limit, state.total);

    elements.paginationSummary.textContent =
      `Showing ${first}-${last} of ${state.total} accounts`;

    elements.totalUsers.textContent = String(state.totalAccounts);
    elements.pageUsers.textContent = String(
      Math.min(state.limit, Math.max(0, state.total - state.offset)),
    );

    elements.previousPage.disabled = state.offset === 0;
    elements.nextPage.disabled = state.offset + state.limit >= state.total;
  }

  // Retrieve the available roles from the server.
  // This keeps the interface aligned with deployed frontend directories.
  async function loadRoles() {
    const response = await fetch("/api/admin/users/roles", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    const result = await response.json();

    if (
      !response.ok ||
      !result.success ||
      !Array.isArray(result.data?.roles)
    ) {
      throw new Error(
        result.error?.message || "Available roles could not be loaded.",
      );
    }

    state.roles = result.data.roles;

    // Rebuild the role filter using the roles supplied by the server.
    const allRolesOption = document.createElement("option");
    allRolesOption.value = "";
    allRolesOption.textContent = "All roles";
    elements.roleFilter.replaceChildren(allRolesOption);

    for (const role of state.roles) {
      const option = document.createElement("option");
      option.value = role;
      option.textContent = role
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      elements.roleFilter.append(option);
    }
  }

  // Submit one role change from the directory table and refresh after success.
  async function updateUserRole(user, roleSelect) {
    const previousRole = user.role;
    const requestedRole = roleSelect.value;

    if (requestedRole === previousRole) {
      return;
    }

    roleSelect.disabled = true;
    setStatus(`Updating role for ${user.email}...`);

    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.id)}/role`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: requestedRole,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error?.message || "The user's role could not be changed.",
        );
      }

      user.role = requestedRole;
      setStatus(`Role updated for ${user.email}.`);
      await loadUsers();
    } catch (error) {
      // Restore the original value if the server rejects the change.
      roleSelect.value = previousRole;
      setStatus(
        error.message || "The user's role could not be changed.",
        true,
      );
    } finally {
      roleSelect.disabled = false;
    }
  }

  // Request one page from the existing administrator-only API.
  async function loadUsers() {
    const currentRequest = ++state.requestNumber;

    state.lastRequestStartedAt = Date.now();
    state.isLoadingUsers = true;

    setStatus("Loading users...");
    elements.refreshButton.disabled = true;
    elements.previousPage.disabled = true;
    elements.nextPage.disabled = true;

    const parameters = new URLSearchParams({
      limit: String(state.limit),
      offset: String(state.offset),
    });

    if (state.role) {
      parameters.set("role", state.role);
    }

    if (state.search) {
      parameters.set("search", state.search);
    }

    try {
      const response = await fetch(
        `/api/admin/users?${parameters.toString()}`,
        {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
          },
        },
      );

      // Do not display data if the server no longer accepts this session.
      if (response.status === 401 || response.status === 403) {
        setStatus(
          "Your administrator session is no longer authorised.",
          true,
        );
        elements.tableBody.replaceChildren();
        return;
      }

      const result = await response.json();

      if (!response.ok || !result.success || !result.data) {
        throw new Error(
          result.error?.message || "The user list could not be loaded.",
        );
      }

      // Ignore an older response if a more recent search has started.
      if (currentRequest !== state.requestNumber) {
        return;
      }

      const users = Array.isArray(result.data.users)
        ? result.data.users
        : [];

      state.total = result.data.pagination.total;
      state.totalAccounts = result.data.totalAccounts;
      renderUsers(users);
      renderPagination();

      // Record only successful responses as the last known good refresh.
      state.lastSuccessfulRefresh = new Date();

      setStatus(
        state.total === 0
          ? `No matching accounts. Last refreshed ${formatRefreshTime(state.lastSuccessfulRefresh)}.`
          : `User directory updated. Last refreshed ${formatRefreshTime(state.lastSuccessfulRefresh)}.`,
      );
    } catch (error) {
      // Ignore errors belonging to an outdated request.
      if (currentRequest !== state.requestNumber) {
        return;
      }

      state.total = 0;
      elements.totalUsers.textContent = "—";
      elements.pageUsers.textContent = "—";
      elements.paginationSummary.textContent = "Unable to load accounts";
      elements.tableBody.replaceChildren();

      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 7;
      cell.className = "table-message";
      cell.textContent = "Unable to load users. Please try again.";

      row.append(cell);
      elements.tableBody.append(row);

      const lastRefreshMessage = state.lastSuccessfulRefresh
        ? ` Last successful refresh: ${formatRefreshTime(state.lastSuccessfulRefresh)}.`
        : " No successful refresh has completed yet.";

      setStatus(
        `${error.message || "Unable to load users."}${lastRefreshMessage}`,
        true,
      );
    } finally {
      // Only the latest request may re-enable the controls.
      if (currentRequest === state.requestNumber) {
        state.isLoadingUsers = false;
        elements.refreshButton.disabled = false;
        renderPagination();
      }
    }
  }

  // Switch between Users and the two visual placeholder sections.
  function showView(viewName) {
    for (const view of elements.views) {
      view.hidden = view.id !== `view-${viewName}`;
    }

    for (const item of elements.navItems) {
      const selected = item.dataset.view === viewName;

      item.classList.toggle("is-active", selected);

      if (selected) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    }

    // Close the mobile navigation after a selection.
    elements.sidebar.classList.remove("is-open");
    elements.mobileNavToggle.setAttribute("aria-expanded", "false");
  }

  // Search after a short pause so every keystroke does not trigger a request.
  elements.search.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);

    state.searchTimer = window.setTimeout(() => {
      state.search = elements.search.value.trim();
      state.offset = 0;
      loadUsers();
    }, 300);
  });

  // Apply the selected role filter and return to the first page.
  elements.roleFilter.addEventListener("change", () => {
    state.role = elements.roleFilter.value;
    state.offset = 0;
    loadUsers();
  });

  // Reload the current page without changing its filters.
  elements.refreshButton.addEventListener("click", loadUsers);

  // Move backward through the result pages.
  elements.previousPage.addEventListener("click", () => {
    if (state.offset >= state.limit) {
      state.offset -= state.limit;
      loadUsers();
    }
  });

  // Move forward only when more results are available.
  elements.nextPage.addEventListener("click", () => {
    if (state.offset + state.limit < state.total) {
      state.offset += state.limit;
      loadUsers();
    }
  });

  // Connect the left navigation to its corresponding content section.
  for (const item of elements.navItems) {
    item.addEventListener("click", () => {
      showView(item.dataset.view);
    });
  }

  // Toggle the vertical navigation on smaller screens.
  elements.mobileNavToggle.addEventListener("click", () => {
    const isOpen = elements.sidebar.classList.toggle("is-open");
    elements.mobileNavToggle.setAttribute("aria-expanded", String(isOpen));
  });

  // The close icon acts like Cancel: it discards unsaved edits.
  elements.closeDialog.addEventListener("click", closeUserDialog);

  // Done saves changed fields; it does not simply close the dialog.
  elements.doneButton.addEventListener("click", saveUserDetails);

  // Escape normally closes a native dialog. Prevent that while saving so
  // an in-progress request cannot leave the administrator uncertain.
  elements.dialog.addEventListener("cancel", (event) => {
    if (state.isSavingDialog) {
      event.preventDefault();
    }
  });
  // Clicking the backdrop behaves like Cancel and discards unsaved edits.
  elements.dialog.addEventListener("click", (event) => {
    if (state.isSavingDialog) {
      return;
    }

    // Only close when the click is on the backdrop, not inside the dialog.
    if (event.target === elements.dialog) {
      closeUserDialog();
    }
  });

  // Clear dialog state when it closes through any permitted route.
  elements.dialog.addEventListener("close", () => {
    state.selectedUser = null;
    state.dialogFields = null;
    state.dialogStatus.textContent = "";
    state.dialogStatus.classList.remove("is-error");
  });

  // Stop polling while the dashboard is hidden to avoid unnecessary requests.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshDashboardIfNeeded();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Refresh when the browser window regains focus.
  // The recent-request check prevents duplicate focus/visibility requests.
  window.addEventListener("focus", refreshDashboardIfNeeded);

  // Also handle returning to a page restored from the browser's back-forward cache.
  window.addEventListener("pageshow", refreshDashboardIfNeeded);

  // Create the dialog status and Cancel button before the first account opens.
  createDialogStatus();

  // Start on Users. Load deployed roles before displaying role selectors.
  showView("users");

  try {
    await loadRoles();
  } catch (error) {
    state.rolesError =
      error.message || "Available roles could not be loaded.";
  }

  await loadUsers();

  if (state.rolesError) {
    setStatus(state.rolesError, true);
  }

  // Begin periodic refresh after the initial directory load has completed.
  startAutoRefresh();
})();
