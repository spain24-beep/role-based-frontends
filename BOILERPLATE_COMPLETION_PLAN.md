# Google Auth Starter � Boilerplate Completion Plan

Purpose: Complete this repository as a reusable Google authentication starter that can be used as the foundation for future applications.

Keep the starter independent of any particular application's business rules.

## 1. Project principles

- Google is the authentication provider.
- The backend verifies Google ID tokens.
- PostgreSQL is the authoritative store for users and roles.
- The backend controls authentication and authorization.
- Admin access is restricted to the configured administrator.
- Secrets belong in .env, never in source control.
- Code should be modular, commented and maintainable.
- API responses and errors should follow consistent conventions.

## 2. Confirmed architecture decisions

- [x] Frontend framework: React.
- [x] Frontend build tool: Vite.
- [x] Frontend language: TypeScript.
- [x] Backend: existing Node.js and Express application, migrated to TypeScript.
- [x] API style: REST.
- [ ] Roles: admin and user.
- [x] Frontend and API share the same origin in production.
- [x] Frontend and backend have separate build outputs.
- [ ] Specific production hosting arrangement.

Do not introduce additional frameworks or dependencies without a clear reason.

## 3. Stage 1 � API foundation

### API structure

- [ ] Review and finalise the Express application structure.
- [ ] Separate routes, controllers, middleware, services and database access.
- [ ] Keep authentication separate from application-specific functionality.
- [ ] Add a central 404 handler.
- [ ] Add central error-handling middleware.
- [ ] Never expose stack traces or internal details in production responses.

### Response conventions

Successful response:

    {
      "success": true,
      "data": {}
    }

Error response:

    {
      "success": false,
      "error": {
        "code": "ERROR_CODE",
        "message": "A safe, human-readable message"
      }
    }

- [ ] Apply conventions consistently.
- [ ] Use appropriate HTTP status codes.
- [ ] Do not expose database errors or sensitive implementation details.

### Authentication and authorization

- [ ] Retain the existing Google authentication flow.
- [ ] Retain server-side session authentication.
- [ ] Require an authenticated session for protected routes.
- [ ] Require the database-backed admin role for admin routes.
- [ ] Retrieve the current user's role from the database on protected requests.
- [ ] Return 401 for unauthenticated requests.
- [ ] Return 403 when the user lacks the required permission.
- [ ] Ensure logout invalidates the session.

### Validation

- [ ] Add validation for incoming request data.
- [ ] Reject missing, malformed or unexpected fields.
- [ ] Validate query parameters.
- [ ] Set sensible request-size limits.
- [ ] Never rely on frontend validation for security.

### Generic endpoints

Retain:

- [ ] GET /health
- [ ] POST /api/auth/google
- [ ] GET /api/auth/me
- [ ] POST /api/auth/logout

Add:

- [ ] GET /api/users/me � current user's profile.
- [ ] GET /api/admin/users � paginated user listing.
- [ ] GET /api/admin/users/:id � individual user details.

Every admin endpoint must enforce admin authorization on the backend.

### Pagination and filtering

- [ ] Add pagination to the admin user listing.
- [ ] Define default and maximum page sizes.
- [ ] Add search by email.
- [ ] Add filtering by role.
- [ ] Return pagination metadata.
- [ ] Validate pagination and filter parameters.

### API tests

- [ ] Test successful authentication.
- [ ] Test failed authentication.
- [ ] Test unauthenticated access to protected endpoints.
- [ ] Test user access to admin endpoints.
- [ ] Test admin access to admin endpoints.
- [ ] Test invalid request data.
- [ ] Test pagination and filtering.
- [ ] Test logout and session invalidation.
- [ ] Test error responses.

## 4. Stage 2 � Frontend foundation

Build a generic frontend using React and Vite, subject to confirmation of the decisions above.

- [ ] Create the frontend application.
- [ ] Establish a clear component and page structure.
- [ ] Configure API communication.
- [ ] Configure frontend environment variables.
- [ ] Implement application loading states.
- [ ] Implement authentication state.
- [ ] Implement protected routes.
- [ ] Implement role-based navigation.
- [ ] Implement reusable error and loading displays.
- [ ] Add a logout action.
- [ ] Ensure session handling works correctly.

The frontend must never be treated as the authority for permissions. The API remains authoritative.

## 5. Stage 3 � User dashboard

Create at least one complete generic page for ordinary users.

- [ ] Display the signed-in user's email.
- [ ] Display the user's role.
- [ ] Display relevant account information returned by the API.
- [ ] Provide a logout action.
- [ ] Handle loading states.
- [ ] Handle API errors.
- [ ] Handle expired or invalid sessions.
- [ ] Provide a clear unauthenticated state.

Limit the dashboard to generic account and profile functionality.

## 6. Stage 4 � Admin dashboard

Create at least one complete generic page for administrators.

- [ ] Display a paginated list of users.
- [ ] Display user email and role.
- [ ] Display relevant account status and dates where available.
- [ ] Search users by email.
- [ ] Filter users by role.
- [ ] Open an individual user detail view.
- [ ] Handle loading states.
- [ ] Handle empty results.
- [ ] Handle API errors.
- [ ] Provide a logout action.

### Administrative security

- [ ] Every admin API endpoint checks the user's admin role.
- [ ] Frontend route protection is not treated as security.
- [ ] Ordinary users cannot retrieve the admin user list.
- [ ] Ordinary users cannot retrieve another user's private details.
- [ ] Do not add user-management actions until their permissions and requirements are defined.

## 7. Stage 5 � End-to-end verification

- [ ] A user who meets the configured registration requirements can sign in.
- [ ] Existing user can sign in.
- [ ] A user who does not meet the configured registration requirements is rejected.
- [ ] Administrator can sign in.
- [ ] User sees the user dashboard.
- [ ] Administrator sees the admin dashboard.
- [ ] User cannot access admin pages or admin API endpoints.
- [ ] Administrator can list and search users.
- [ ] Logout works.
- [ ] Expired sessions are handled correctly.
- [ ] Refreshing a protected page preserves valid authentication.
- [ ] Application works in the intended production configuration.

## 8. Stage 6 � Documentation and release

- [ ] Update README with the final architecture.
- [ ] Document all environment variables.
- [ ] Document database setup and migrations.
- [ ] Document Google OAuth configuration.
- [ ] Document local development commands.
- [ ] Document frontend and backend startup.
- [ ] Document API endpoints and response conventions.
- [ ] Document deployment configuration.
- [ ] Update the project structure in README.
- [ ] Ensure .env.example contains placeholders only.
- [ ] Run the complete test suite.
- [ ] Run git diff --check.
- [ ] Review tracked files for secrets and local configuration.
- [ ] Create a final release commit and push.

## 9. Implementation order

1. Confirm the decisions in section 2.
2. Complete the API foundation.
3. Test the API independently.
4. Build the frontend foundation.
5. Complete the user dashboard.
6. Complete the admin dashboard.
7. Run end-to-end tests.
8. Complete documentation and release checks.

Do not move to the next stage until the current stage has been tested.

## 10. Working checkpoint

At the end of each stage:

- Record completed checklist items.
- Record outstanding decisions.
- Run relevant tests.
- Review changes before committing.
- Keep this document updated.

## Definition of done

A developer can clone the repository, configure Google OAuth and PostgreSQL, run the application, sign in as a user or administrator, and use the corresponding generic dashboard without adding application-specific business logic.
