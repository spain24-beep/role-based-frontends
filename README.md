# Role-Based Frontend Boilerplate

A reusable Node.js, Express and TypeScript application foundation featuring Google Sign-In, PostgreSQL-backed user accounts and sessions, spreadsheet-based admission for new users, dynamically discovered role-based frontends, and an administrator dashboard.

This repository is an authentication and frontend-delivery foundation. It is **not a complete business application** and does not prescribe what an application built on top of it should do.

The current npm package name remains `google-auth-starter`.

---

# Part 1 - Overview

## 1. What the application provides

### Authentication and accounts

- Google Sign-In using Google Identity Services.
- Backend verification of Google ID tokens.
- Admission of new ordinary users through a publicly readable Google Sheet.
- A configurable administrator bootstrap account using `ADMIN_EMAIL`.
- PostgreSQL-backed user records.
- PostgreSQL-backed server-side sessions.
- Database-authoritative user roles.
- Stored first and last names.
- Optional user multiplier values.

### Dynamic role-based frontends

- Separate frontend directories for each application role.
- Automatic discovery of deployed frontend roles at server startup.
- Server-side authentication and role enforcement for frontend pages and their assets.
- Automatic redirection to the user's assigned frontend.
- A shared login/logout banner.
- A common frontend authentication check.

### Administrator workspace

- Paginated user directory.
- Email search.
- Role filtering.
- Individual account details.
- Editable first and last names.
- Editable user roles.
- Editable or clearable multiplier values.
- Role options obtained dynamically from deployed frontend directories.

### Backend and infrastructure

- Express 5 and TypeScript.
- PostgreSQL connection pools.
- Separate runtime and migration database accounts.
- Numbered SQL migrations.
- Transactional migration execution.
- PostgreSQL advisory locking during migrations.
- Same-origin protection for state-changing requests.
- Centralised error handling.
- Health and database-readiness endpoints.
- Automated tests using Node.js's built-in test runner.

## 2. Current deployed frontends

The current repository contains these frontend directories:

| Role | Directory | Purpose |
| --- | --- | --- |
| `admin` | `public/frontends/admin/` | Administrator workspace and user management |
| `user` | `public/frontends/user/` | Ordinary user frontend |
| `dummy1` | `public/frontends/dummy1/` | Demonstration frontend |

The administrator dashboard also contains a Dummy 2 placeholder navigation item. There is currently no `dummy2` frontend directory, so `dummy2` is not a deployed role.

These are the roles discovered from the current filesystem, not a hardcoded list of all possible roles.

## 3. Technology stack

- Runtime: Node.js
- Backend language: TypeScript, compiled to JavaScript
- Backend framework: Express 5
- Database: PostgreSQL
- Database connectivity: `pg` (node-postgres)
- Browser authentication: Google Identity Services
- Google ID token verification: `google-auth-library`
- Session management: `express-session`
- Session storage: `connect-pg-simple`
- Environment configuration: `dotenv`
- Spreadsheet CSV parsing: `csv-parse`
- Frontend: plain HTML, CSS and JavaScript
- Migrations: numbered SQL files and a TypeScript migration runner
- Build: TypeScript compiler and a migration-copy script
- Module system: CommonJS
- Tests: Node.js built-in test runner
- Development compilation: TypeScript watch mode

The frontend does not use React or another frontend framework.

---

# Part 2 - Installation guide

## 4. What you need

Install the following:

- **Node.js** - use a current LTS release, including npm.
- **PostgreSQL** - PostgreSQL 18 was used during development.
- **Visual Studio Code** - recommended editor.
- **Google Cloud account** - to configure Google OAuth.
- **Google account** - to create the authorised-user spreadsheet.

The original development environment was Windows with PowerShell.

## 5. Install dependencies

Open the project directory in VS Code and open its integrated PowerShell terminal.

Install the dependencies:

```powershell
npm.cmd install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
code .env
```

The `.env` file contains local credentials and configuration. It must never be committed to Git or uploaded to a public repository.

## 6. Configure Google Sign-In

In the Google Cloud Console:

1. Create or select a Google Cloud project.
2. Configure the OAuth consent screen.
3. Create an OAuth client ID.
4. Select **Web application** as the application type.
5. Add the application's browser origin to **Authorised JavaScript origins**.

For local development, the origin is:

```text
http://localhost:3000
```

Copy the generated client ID into `.env`:

```dotenv
GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

The browser first requests the public Google Client ID from `GET /api/config`. This endpoint does not require an authenticated session.

The backend reads the Client ID from its environment configuration and returns only that public value in the standard API response envelope. The browser then uses Google Identity Services to obtain a Google ID token.

The browser does not read `.env` directly. The Client ID is public configuration, not a secret. The backend verifies the resulting ID token using Google's authentication library and checks its audience against the configured Client ID.

Never expose a Google Client Secret or other private credentials through the configuration endpoint.

## 7. Configure the authorised-user Google Sheet

The application uses a publicly accessible Google Sheet as an admission list for new ordinary users.

The sheet must contain this exact mandatory column heading:

| Email address | multiplier |
| --- | ---: |
| person@example.com | 1.25 |
| another@example.com | |

Only `Email address` is mandatory. `multiplier` is optional.

The spreadsheet must be shared publicly with link access so that the backend can retrieve its CSV export without a Google service account.

Set `GOOGLE_SHEET_URL` in `.env` to the spreadsheet's CSV export URL.

The application:

- Normalises email addresses to lowercase.
- Matches the exact `Email address` column.
- Accepts finite numeric multipliers between 0 and 20, inclusive.
- Treats blank, missing or invalid multipliers as `NULL`.
- Does not silently substitute a multiplier of `1.00`.

Existing users are looked up in PostgreSQL and do not need to be admitted again through the spreadsheet.

**Privacy warning:** the spreadsheet is deliberately publicly readable by link. Do not put passwords, financial details or other sensitive information in it. Keep it limited to the information required for admission, such as email addresses and optional multipliers.

## 8. Configure PostgreSQL

Create a database and two separate database accounts:

- An **application account**, used by the running web application.
- A **migration account**, used only when applying database migrations.

The migration account owns the database and schema. The application account receives only the permissions needed to run the application.

Connect to PostgreSQL as a database administrator and substitute your chosen database and account names:

```sql
CREATE ROLE starter_app
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE;

CREATE ROLE starter_migrator
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE;

CREATE DATABASE starter_database
    OWNER starter_migrator;
```

Set each account's password interactively in `psql`:

```text
\password starter_app
\password starter_migrator
```

Connect to the new database:

```text
\c starter_database
```

Configure the schema and application permissions:

```sql
ALTER SCHEMA public OWNER TO starter_migrator;

GRANT CONNECT ON DATABASE starter_database TO starter_app;
GRANT USAGE ON SCHEMA public TO starter_app;

ALTER DEFAULT PRIVILEGES FOR ROLE starter_migrator IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO starter_app;

ALTER DEFAULT PRIVILEGES FOR ROLE starter_migrator IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO starter_app;
```

These default privileges apply to objects subsequently created by the migration account.

Do not give the running application database ownership, superuser privileges or permission to create database objects.

After the first migrations have run, the migration-history table should remain inaccessible to the application account. As the migration account, run:

```sql
REVOKE ALL ON TABLE schema_migrations FROM starter_app;
```

If you use different database role names, substitute your actual application role in this command.

## 9. Configure `.env`

Set the values for your local environment:

```dotenv
PORT=3000

GOOGLE_CLIENT_ID=your-google-oauth-client-id

ADMIN_EMAIL=your-administrator-google-email

GOOGLE_SHEET_URL=your-public-google-sheet-csv-export-url

DB_HOST=localhost
# Must be an integer from 1 through 65535.
DB_PORT=5432
DB_NAME=starter_database
DB_USER=starter_app
DB_PASSWORD=your-application-database-password

MIGRATION_DB_USER=starter_migrator
MIGRATION_DB_PASSWORD=your-migration-database-password

SESSION_SECRET=your-generated-session-secret

APP_ORIGIN=http://localhost:3000

NODE_ENV=development
```

Generate a session secret using Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use the generated value for `SESSION_SECRET`. The application requires a secret of at least 64 characters. Use a different secret in each environment.

Never put real credentials in `.env.example`.

### Environment variable reference

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP server port; defaults to `3000` |
| `GOOGLE_CLIENT_ID` | Google OAuth Web Client ID used for token verification |
| `ADMIN_EMAIL` | Failsafe administrator email for first-time account creation |
| `GOOGLE_SHEET_URL` | Public Google Sheets CSV export URL used for new ordinary users |
| `DB_HOST` | PostgreSQL host for the runtime pool |
| `DB_PORT` | PostgreSQL port; validated as an integer from 1 to 65535 |
| `DB_NAME` | PostgreSQL database name |
| `DB_USER` | Least-privilege runtime database account |
| `DB_PASSWORD` | Runtime database password |
| `MIGRATION_DB_USER` | Dedicated migration database account |
| `MIGRATION_DB_PASSWORD` | Migration database password |
| `SESSION_SECRET` | Secret used to sign session cookies |
| `APP_ORIGIN` | Exact canonical application origin used by same-origin protection |
| `NODE_ENV` | Environment mode; production enables secure session-cookie behaviour |

`APP_ORIGIN` must be a canonical HTTP or HTTPS origin, without a path, query string, fragment or credentials. For example:

```text
https://app.example.com
```

## 10. Run database migrations

From the project root:

```powershell
npm.cmd run migrate
```

The migration runner:

- Uses the dedicated migration database account.
- Finds SQL migration files matching the numbered filename convention.
- Applies them in filename order.
- Records successful migrations in `schema_migrations`.
- Executes each migration and its history record in one transaction.
- Uses a PostgreSQL advisory lock to prevent concurrent migration runs.
- Skips migrations already recorded as applied.

The application account is not used for migrations.

The build process copies SQL files from `src/config` into `dist/config`, where the compiled migration runner expects to find them.

The current migrations are:

| File | Purpose |
| --- | --- |
| `001_create_users.sql` | Creates the user table |
| `002_add_user_roles.sql` | Adds the role field for role-based access |
| `003_create_user_sessions.sql` | Creates the PostgreSQL session table and expiry index |
| `004_add_user_names.sql` | Adds nullable first-name and last-name fields |

## 11. Run the application

Start the TypeScript compiler in watch mode:

```powershell
npm.cmd run dev
```

This command recompiles TypeScript when source files change. It does not start or automatically restart the Express server.

In a separate terminal, start the application:

```powershell
npm.cmd start
```

After changing backend TypeScript files, allow the compiler to finish and restart the application process.

The default local address is:

```text
http://localhost:3000
```

The liveness endpoint is:

```text
http://localhost:3000/health
```

It confirms that the application process is responding. It does not check PostgreSQL.

The database readiness endpoint is:

```text
http://localhost:3000/health/ready
```

It executes a database check and returns HTTP 503 if PostgreSQL is unavailable.

## 12. Run the automated tests

```powershell
npm.cmd test
```

The test command first builds the application and then runs the JavaScript test files using Node.js's built-in test runner.

The suite covers authentication routes, authentication service behaviour, session lifecycle, spreadsheet parsing, public configuration, administrator user routes, database port validation, database readiness, authentication middleware, role middleware, same-origin protection, frontend delivery and error handling.

Run the tests after making changes to authentication, database access, middleware, frontend delivery or configuration.

## 13. Available npm scripts

| Command | Purpose |
| --- | --- |
| `npm.cmd run dev` | Compile TypeScript continuously; does not start the server |
| `npm.cmd start` | Start the compiled application |
| `npm.cmd test` | Build the application and run automated tests |
| `npm.cmd run migrate` | Build the application and apply pending database migrations |
| `npm.cmd run build` | Compile TypeScript and copy SQL migration files |
| `npm.cmd run typecheck` | Check TypeScript without generating compiled output |

---

# Part 3 - How the application works

## 14. Authentication lifecycle

The authentication process works as follows:

1. The browser retrieves the public Google Client ID from `GET /api/config`.
2. Google Identity Services displays Google's sign-in button.
3. After successful sign-in, the browser receives a Google ID token.
4. The browser sends the token to `POST /api/auth/google`.
5. The backend verifies the token using Google's authentication library.
6. The backend validates the token audience against `GOOGLE_CLIENT_ID`.
7. The backend requires a Google account identifier, an email address and a verified email claim.
8. The backend looks up the user by Google's stable `sub` identifier.
9. If an existing account is found, its last-login timestamp is updated.
10. If the email belongs to a different existing account, authentication is rejected.
11. If the account is new and its email matches `ADMIN_EMAIL`, it can be created as the failsafe administrator without a spreadsheet entry.
12. Otherwise, the backend checks the public Google Sheet for an exact email match.
13. If the email is not authorised, access is rejected and no user record is created.
14. If the email is authorised, a database user is created with the ordinary `user` role and the spreadsheet multiplier.
15. The server regenerates the session, stores the internal database user ID and saves the session.
16. The browser navigates to the frontend destination returned by the backend.

The Google `sub` is a stable external identity identifier. It is stored in PostgreSQL but is not exposed in the normal public user response.

The browser must never be trusted to supply its own identity, role or administrator status.

## 15. Account lifecycle policy

The application uses the following account lifecycle rules.

### Google Sheet admission

The Google Sheet controls admission of new ordinary accounts only.

A person must appear in the authorised-user Sheet to create an ordinary account. Once created, their database account remains valid even if their email address is subsequently removed from the Sheet.

Removing someone from the Sheet does not revoke or disable an existing account.

### Administrator bootstrap

`ADMIN_EMAIL` is a failsafe administrator admission mechanism.

When a Google identity does not already have an application account, a matching `ADMIN_EMAIL` can be used to create the administrator account without requiring a Sheet entry.

It does not continuously control administrator permissions.

### Database authority

The database is authoritative for existing users and roles.

Changing `ADMIN_EMAIL` does not automatically promote or demote an existing account. An existing user's database role remains in force when they log in, regardless of whether their email matches the current `ADMIN_EMAIL` value.

These rules are intentional: the Sheet controls initial admission, while PostgreSQL controls the ongoing status and permissions of established accounts.

### Names

Google's verified given and family names are saved when the account is first created.

Subsequent Google logins do not overwrite the stored names. An administrator can edit first and last names through the administrator interface.

If Google does not supply either name, the corresponding database field remains `NULL`.

### Multiplier

A new ordinary user's multiplier comes from the Google Sheet.

A blank, missing or invalid Sheet multiplier remains `NULL`. The application does not silently substitute `1.00`.

An administrator can subsequently set or clear a user's multiplier through the administrator interface.

## 16. Dynamic role-based frontend architecture

This is a central feature of the repository.

The available frontend roles are discovered from the physical directory structure under:

```text
public/frontends/
```

A directory counts as a deployed role only when:

- Its name matches the permitted lowercase role pattern.
- It is a directory.
- It contains an `index.html` entry page.

The permitted role-name pattern is:

```text
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Examples of valid role names include:

```text
admin
user
dummy1
finance-team
```

The directory structure is the source of truth for deployed frontend roles. There is no separate hardcoded list that must be updated whenever a frontend is added.

### Adding a new role frontend

To add a role named `manager`:

1. Create `public/frontends/manager/`.
2. Add a valid `index.html` entry page.
3. Add the appropriate frontend assets and role metadata.
4. Restart the application so the role is discovered at startup.
5. The role becomes available through `GET /api/admin/users/roles`.
6. An administrator can then assign the role to an existing user.

The frontend must declare its expected role:

```html
<meta name="app-role" content="manager">
```

The browser-side authentication script checks this declared value against the role returned by the backend.

The HTML metadata is not proof of permission. The server independently checks the current database role before serving the frontend or its assets.

### Removing a role frontend

Removing a frontend directory removes that role from the discovered role list after the server is restarted.

Consider existing users assigned to that role before removing its directory. They will no longer have an available workspace.

### Role discovery and assignment

`getFrontendRoles()` discovers deployed role directories.

`hasFrontendRole(role)` checks whether a specific role has a valid deployed entry page.

The administrator role-management endpoint only accepts a role for which a frontend is deployed. An administrator cannot demote their own account from `admin` through the role-update endpoint.

A deployed frontend does not automatically grant access to everyone. A user must also have the corresponding role in PostgreSQL.

## 17. Request routing and frontend protection

The Express application separates public resources from protected role frontends.

### Root route `/`

The root URL is the application's entry point.

- An unauthenticated visitor continues to the public login page.
- An authenticated visitor is looked up again in PostgreSQL.
- If the account exists and its frontend is deployed, the visitor is redirected to `/{role}/`.
- If the session refers to a deleted account, the server destroys the session, clears the cookie and continues to the login page.
- If the account's role has no deployed frontend, the server returns HTTP 403.

The redirect uses the current database role, not a role stored in the browser or trusted from the session.

### Protected frontend routes

For each discovered role, the server creates a route such as:

```text
/admin/
/user/
/dummy1/
```

Each route:

1. Requires a valid session.
2. Retrieves the current user from PostgreSQL.
3. Checks that the user's database role matches the requested frontend.
4. Serves that role's files only after the checks succeed.

If a user's role has changed, a browser document request to their old frontend is redirected to their current frontend, provided that frontend exists.

Requests for assets or other non-document resources under the wrong role receive HTTP 403 rather than being redirected.

The role's `index.html` is also used as the single-page application fallback for nested browser routes.

The physical directory name is not a public route. Requests to `/frontends/...` explicitly return HTTP 404.

### Public resources

The public login page and shared assets are served from `public/`.

The public login page is not protected by a role check. The role-specific frontend directories are.

## 18. Browser-side frontend authentication

The shared script:

```text
public/js/frontend-auth.js
```

checks the current session through:

```text
GET /api/auth/me
```

Each protected frontend declares its expected role using the `app-role` meta element.

The script:

- Rejects a frontend without an expected role.
- Redirects an unauthenticated visitor to `/`.
- Compares the backend-verified role with the expected role.
- Fails closed if the session cannot be verified.
- Exposes a shared `window.frontendAuthReady` promise for other scripts.

Other frontend scripts can wait for this promise rather than making another session request.

This browser check is useful for controlling what the user sees, but it is not the security boundary. The Express server and protected API routes enforce actual access control.

## 19. Shared site banner and login

The shared script:

```text
public/js/site-banner.js
```

creates the common site banner.

It displays:

- A Login action when no valid session exists.
- The stored first and last name when a valid session exists.
- A Logout action for authenticated users.

On protected frontends, it reuses `window.frontendAuthReady`.

On the public login page, it performs its own session check because the public page does not load the role-specific authentication script.

Logout sends a POST request to:

```text
/api/auth/logout
```

The backend destroys the server-side session and clears the session cookie.

The Google sign-in browser logic is in:

```text
public/js/auth.js
```

It retrieves the public Client ID, loads Google Identity Services, sends the returned credential to the backend and navigates to the destination returned by the backend.

## 20. Administrator dashboard

The administrator frontend is located at:

```text
public/frontends/admin/
```

It currently provides three navigation sections:

- **Users** - implemented user directory and account management.
- **Dummy 1** - placeholder module.
- **Dummy 2** - placeholder module.

The Dummy 1 and Dummy 2 entries are dashboard placeholders, not a claim that both corresponding role frontends exist.

### User directory

The Users section provides:

- Total registered account count.
- Current page count.
- Manual refresh.
- Email search.
- Role filtering.
- User table.
- Pagination.
- Account detail dialog.

The directory refreshes periodically while the browser tab is visible and also refreshes on relevant focus and visibility events.

### Account details and editing

The administrator can view account details and edit:

- First name.
- Last name.
- Role.
- Multiplier.

Email and account metadata are read-only in the current interface.

The frontend sends changes to separate API endpoints. Only changed fields are submitted.

The server response is authoritative. If one update succeeds and a later update fails, the dialog remains open and reflects the successful change rather than pretending that all changes were atomic.

An empty multiplier clears the database value to `NULL`.

The UI uses DOM text operations rather than inserting API-provided values through `innerHTML`.

---

# Part 4 - Backend architecture

## 21. Technology and application layers

The backend separates HTTP handling, authentication decisions, database access and integrations.

### Application entry points

| File | Responsibility |
| --- | --- |
| `src/server.ts` | Loads environment configuration and starts the HTTP server |
| `src/app.ts` | Configures Express middleware, routes, health checks and frontend delivery |

`app.ts` configures and exports the Express application. It does not start the HTTP listener. `server.ts` starts the server.

### Authentication

| File | Responsibility |
| --- | --- |
| `src/routes/auth.ts` | Defines the authentication, session and logout routes |
| `src/controllers/authController.ts` | Handles Google credential verification, session creation, session restoration and logout |
| `src/services/authService.ts` | Makes account admission and authentication decisions |
| `src/routes/config.ts` | Returns the public Google Client ID configuration |

The authentication service does not handle HTTP requests or session management. Those responsibilities belong to the controller and route layers.

### User data

| File | Responsibility |
| --- | --- |
| `src/repositories/usersRepository.ts` | Centralises PostgreSQL queries for user records |

The repository handles database access. Authentication and permission decisions belong in the service, controller and middleware layers.

### Google integration

| File | Responsibility |
| --- | --- |
| `src/integrations/google/publicSheet.ts` | Retrieves and parses the authorised-user Google Sheet CSV export |

### Middleware

| File | Responsibility |
| --- | --- |
| `src/middleware/requireAuth.ts` | Requires a valid authenticated user |
| `src/middleware/requireRole.ts` | Enforces a database-managed role |
| `src/middleware/requireSameOrigin.ts` | Validates the origin of state-changing requests |
| `src/middleware/notFound.ts` | Handles unmatched requests |
| `src/middleware/errorHandler.ts` | Handles errors forwarded through Express |

### Configuration and database infrastructure

| File | Responsibility |
| --- | --- |
| `src/config/database.ts` | Runtime PostgreSQL connection pool |
| `src/config/migrationDatabase.ts` | Separate migration PostgreSQL connection pool |
| `src/config/databasePort.ts` | Validates PostgreSQL port configuration |
| `src/config/session.ts` | Configures PostgreSQL-backed sessions |
| `src/config/runMigrations.ts` | Applies and records database migrations |
| `src/utils/frontendRoles.ts` | Discovers deployed frontend roles |
| `src/types/express.d.ts` | Adds application-specific types to Express request objects |

## 22. User database

The `users` table includes:

| Column | Purpose |
| --- | --- |
| `id` | Internal database identity |
| `google_sub` | Google's stable account identifier |
| `email` | Normalised email address |
| `first_name` | Nullable stored first name |
| `last_name` | Nullable stored last name |
| `role` | Database-assigned application role |
| `multiplier` | Nullable numeric value |
| `created_at` | Account creation timestamp |
| `updated_at` | Last account update timestamp |
| `last_login_at` | Last successful login timestamp |

PostgreSQL `BIGINT` and `NUMERIC` values are represented as strings by node-postgres to avoid JavaScript precision loss.

The current accepted multiplier range is 0 to 20 inclusive.

The role is stored as text rather than being restricted to a fixed TypeScript union. This is intentional because deployed frontend directory names define the available role names.

## 23. Sessions

Sessions are stored in PostgreSQL using `connect-pg-simple`.

The browser session cookie:

- Is HTTP-only.
- Uses `SameSite=Lax`.
- Has an eight-hour maximum lifetime.
- Uses the `Secure` flag in production.

The session stores only the internal `userId`. It does not store a trusted copy of the user's role or other authorisation decisions.

On authenticated requests, `requireAuth` retrieves the current user from PostgreSQL. Role changes therefore take effect without requiring the user to sign out and back in.

The session table is created through a database migration. The running application should not need permission to create it.

## 24. API endpoints

### Public and authentication endpoints

| Method | Endpoint | Purpose | Access |
| --- | --- | --- | --- |
| `GET` | `/api/config` | Return the public Google Client ID | Public |
| `POST` | `/api/auth/google` | Verify a Google ID token and establish a session | Public entry point |
| `GET` | `/api/auth/me` | Return the current authenticated user | Authenticated |
| `POST` | `/api/auth/logout` | Destroy the current session | Session-based |

### Administrator user endpoints

All endpoints under `/api/admin/users` require authentication and the `admin` role.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/users/roles` | Return deployed frontend role names |
| `GET` | `/api/admin/users` | Return a paginated user list |
| `GET` | `/api/admin/users/:id` | Return an individual user |
| `PATCH` | `/api/admin/users/:id/names` | Update first and last names |
| `PATCH` | `/api/admin/users/:id/role` | Change a user's role |
| `PATCH` | `/api/admin/users/:id/multiplier` | Update or clear a multiplier |

#### User-list query parameters

`GET /api/admin/users` supports:

| Parameter | Default | Validation and purpose |
| --- | --- | --- |
| `limit` | `25` | Integer from 1 to 100 |
| `offset` | `0` | Non-negative integer |
| `role` | None | Optional exact role filter |
| `search` | None | Optional case-insensitive email substring search |

The response includes the filtered total, total registered accounts and pagination details.

#### Name update

`PATCH /api/admin/users/:id/names`

Both `firstName` and `lastName` must be supplied as strings. Each is limited to 100 characters. Blank values are stored as `NULL`.

#### Role update

`PATCH /api/admin/users/:id/role`

The requested role must have a deployed frontend. An administrator cannot remove their own administrator role through this endpoint.

#### Multiplier update

`PATCH /api/admin/users/:id/multiplier`

Accepted values:

- A number from 0 to 20.
- A numeric string from 0 to 20.
- `null` or an empty string to clear the multiplier.

### Health endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Application liveness check; does not query PostgreSQL |
| `GET` | `/health/ready` | Database readiness check; returns HTTP 503 if PostgreSQL is unavailable |

### API response format

Successful API responses use the standard envelope:

```json
{
  "success": true,
  "data": {}
}
```

Error responses use:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "A safe, user-facing message"
  }
}
```

The API should not expose database credentials, Google tokens, session identifiers or raw internal exceptions.

---

# Part 5 - Security architecture

## 25. Google identity verification

- Verify ID tokens on the backend.
- Validate the token audience against `GOOGLE_CLIENT_ID`.
- Require a verified email claim.
- Require the stable Google account identifier.
- Never trust browser-supplied identity or role information.
- Do not use an email-domain suffix as a substitute for verified identity or explicit admission.

## 26. Database security

- Use separate runtime and migration credentials.
- The runtime account must not own the database or schema.
- Do not grant runtime database superuser, role-creation or database-creation privileges.
- Use parameterised SQL queries.
- Do not expose database credentials in logs or API responses.
- Keep migration-history access restricted to the migration account.

## 27. Session security

- Store sessions server-side.
- Store only the internal user ID in the session.
- Retrieve the current user and role from PostgreSQL.
- Regenerate the session when establishing a new authenticated session.
- Destroy the server-side session on logout.
- Use HTTP-only and `SameSite=Lax` cookies.
- Enable secure cookies in production.

## 28. Same-origin protection

`requireSameOrigin` is applied globally after session middleware and before authentication and API routes.

- `APP_ORIGIN` is validated as a canonical HTTP or HTTPS origin.
- State-changing requests must include an `Origin` header that exactly matches the configured origin.
- Missing or foreign origins are rejected.
- `GET`, `HEAD` and `OPTIONS` bypass the origin check.
- Do not implement state-changing operations using GET requests.

Same-origin protection is a CSRF defence. It does not replace authentication or authorisation.

## 29. Frontend access control

- Frontend role directories are discovered at server startup.
- Protected frontend routes require a valid session.
- The current database role must match the requested frontend.
- Static assets are protected by the same route-level checks.
- The browser's declared role is only a comparison value, never proof of permission.
- API endpoints must enforce their own authentication and authorisation requirements.
- The physical `/frontends` directory path is not publicly accessible as a route.

## 30. Google Sheet integration

- The CSV export URL is validated.
- Only HTTPS Google Sheets URLs are accepted.
- CSV retrieval has a timeout and download-size limit.
- Required column names are checked.
- Email addresses are normalised.
- Invalid multiplier values are not silently converted into a default.
- The Sheet is publicly readable by link and must not contain sensitive information.

## 31. Security and deployment checklist

Use this checklist whenever deploying a new instance or changing its configuration.

### Secrets and environment variables

- [ ] Keep `.env` local and never commit it to Git.
- [ ] Commit only `.env.example`, containing placeholders rather than real credentials.
- [ ] Generate a unique, high-entropy `SESSION_SECRET` for each deployment.
- [ ] Keep Google OAuth credentials and database passwords private.
- [ ] Restrict production environment-variable access to authorised administrators.
- [ ] If a secret is exposed, rotate it immediately. Removing it from the current file does not remove it from Git history.

### Google authentication

- [ ] Use the correct Google OAuth Web Client ID for the deployment.
- [ ] Configure the exact authorised JavaScript origins in Google Cloud.
- [ ] Ensure the backend verifies ID tokens, including their audience, signature and expiry.
- [ ] Require Google's `email_verified` claim.
- [ ] Never rely on frontend checks to establish identity or privileges.
- [ ] Protect `ADMIN_EMAIL` and verify that it identifies the intended administrator.

### Authorised-user Google Sheet

- [ ] Confirm that the configured Sheet is the intended admission list.
- [ ] Remember that the Sheet is deliberately publicly readable by link.
- [ ] Do not put passwords, financial details or other sensitive information in the Sheet.
- [ ] Keep the admission list limited to required data.
- [ ] Check that email addresses are entered correctly.
- [ ] Check that multiplier values are numeric and within the accepted range of 0 to 20. Blank, missing or invalid values must not silently become `1`.

### PostgreSQL

- [ ] Use a dedicated, least-privilege runtime database account.
- [ ] Keep the migration account separate from the runtime account.
- [ ] Never run the application using the PostgreSQL superuser.
- [ ] Keep database credentials out of source code and Git.
- [ ] Restrict database network access to trusted application and administration hosts.
- [ ] Use encrypted database connections where supported by the deployment environment.
- [ ] Configure regular database backups and periodically test restoration.

### Application and deployment

- [ ] Set `NODE_ENV=production` in production.
- [ ] Set `APP_ORIGIN` to the exact public application origin, including the correct scheme.
- [ ] Use HTTPS in production.
- [ ] Ensure production session cookies use the `Secure` flag.
- [ ] Preserve the server-side Origin checks for state-changing requests.
- [ ] Do not expose internal error details, credentials or session data in API responses or logs.
- [ ] Run database migrations using the migration account, not the runtime account.
- [ ] Run the automated test suite before deployment.
- [ ] Review dependency vulnerabilities and update dependencies regularly.

### Final release check

- [ ] Confirm that no `.env` file, credentials, private keys or production data are tracked by Git.
- [ ] Review the files and changes being committed before pushing.
- [ ] Verify that the deployed application uses the intended Google OAuth client, admission Sheet and database.
- [ ] Test login, logout, unauthorised access and administrator access after deployment.

---

# Part 6 - Project structure

## 32. Current repository structure

The following tree reflects the current repository structure. Generated output such as `dist` and installed dependencies such as `node_modules` are omitted.

```text
project-root/
├── public/
│   ├── css/
│   │   ├── admin.css
│   │   ├── dummy1.css
│   │   ├── site-banner.css
│   │   └── user.css
│   ├── frontends/
│   │   ├── admin/
│   │   │   └── index.html
│   │   ├── dummy1/
│   │   │   └── index.html
│   │   └── user/
│   │       └── index.html
│   ├── js/
│   │   ├── admin.js
│   │   ├── auth.js
│   │   ├── dummy1.js
│   │   ├── frontend-auth.js
│   │   ├── site-banner.js
│   │   └── user.js
│   └── index.html
├── scripts/
│   └── copyMigrations.js
├── src/
│   ├── config/
│   │   ├── 001_create_users.sql
│   │   ├── 002_add_user_roles.sql
│   │   ├── 003_create_user_sessions.sql
│   │   ├── 004_add_user_names.sql
│   │   ├── database.ts
│   │   ├── databasePort.ts
│   │   ├── migrationDatabase.ts
│   │   ├── runMigrations.ts
│   │   └── session.ts
│   ├── controllers/
│   │   └── authController.ts
│   ├── integrations/
│   │   └── google/
│   │       └── publicSheet.ts
│   ├── middleware/
│   │   ├── errorHandler.ts
│   │   ├── notFound.ts
│   │   ├── requireAuth.ts
│   │   ├── requireRole.ts
│   │   └── requireSameOrigin.ts
│   ├── repositories/
│   │   └── usersRepository.ts
│   ├── routes/
│   │   ├── adminUsers.ts
│   │   ├── auth.ts
│   │   ├── config.ts
│   │   └── health.ts
│   ├── services/
│   │   └── authService.ts
│   ├── types/
│   │   └── express.d.ts
│   ├── utils/
│   │   └── frontendRoles.ts
│   ├── app.ts
│   └── server.ts
├── tests/
│   ├── adminUsersRoute.test.js
│   ├── authInputValidation.test.js
│   ├── authLifecycle.test.js
│   ├── authRoute.test.js
│   ├── authService.test.js
│   ├── configRoute.test.js
│   ├── databasePort.test.js
│   ├── errorHandling.test.js
│   ├── frontendDelivery.test.js
│   ├── healthRoute.test.js
│   ├── publicSheet.test.js
│   ├── requireAuth.test.js
│   ├── requireRole.test.js
│   └── requireSameOrigin.test.js
├── .env.example
├── .gitignore
├── BOILERPLATE_COMPLETION_PLAN.md
├── LICENSE
├── package.json
├── package-lock.json
├── README.md
└── tsconfig.json
```

### Directory responsibilities

- `src/` contains the TypeScript application source and SQL migration files.
- `src/config/` contains database, session and migration configuration.
- `src/controllers/` handles HTTP-level authentication operations.
- `src/services/` contains authentication and admission decisions.
- `src/repositories/` centralises database access.
- `src/integrations/` contains external service integrations.
- `src/middleware/` contains authentication, authorisation, request-origin and error-handling middleware.
- `src/routes/` defines HTTP endpoints.
- `src/utils/` contains shared utilities, including frontend role discovery.
- `public/` contains browser-side static assets.
- `public/frontends/` contains the protected role-specific frontend directories.
- `public/css/` contains shared and frontend-specific stylesheets.
- `public/js/` contains browser-side scripts.
- `scripts/` contains build-support scripts.
- `tests/` contains automated JavaScript tests.

The `.env` file is intentionally omitted because it contains local credentials and must not be committed to Git.

The TypeScript build creates `dist/`. The build-support script copies SQL migrations into `dist/config`, because TypeScript compilation does not copy SQL files.

The tests are JavaScript files and load the compiled application modules from `dist`.

## 33. Important implementation files

| File | Responsibility |
| --- | --- |
| `src/server.ts` | Loads environment configuration and starts Express |
| `src/app.ts` | Configures Express middleware, routes and frontend delivery |
| `src/routes/auth.ts` | Authentication, session restoration and logout routes |
| `src/routes/config.ts` | Public Google Client ID configuration |
| `src/routes/adminUsers.ts` | Administrator user-management API |
| `src/controllers/authController.ts` | Google credential verification and session handling |
| `src/services/authService.ts` | Authentication and admission decisions |
| `src/repositories/usersRepository.ts` | PostgreSQL operations for user records |
| `src/integrations/google/publicSheet.ts` | Google Sheet CSV retrieval and parsing |
| `src/config/database.ts` | Runtime PostgreSQL connection pool |
| `src/config/migrationDatabase.ts` | Migration PostgreSQL connection pool |
| `src/config/runMigrations.ts` | Ordered database migration runner |
| `src/config/session.ts` | PostgreSQL-backed session configuration |
| `src/config/databasePort.ts` | Database port validation |
| `src/utils/frontendRoles.ts` | Dynamic frontend role discovery |
| `src/middleware/requireAuth.ts` | Database-backed authentication |
| `src/middleware/requireRole.ts` | Role enforcement |
| `src/middleware/requireSameOrigin.ts` | Same-origin protection |
| `public/js/auth.js` | Browser-side Google Sign-In |
| `public/js/frontend-auth.js` | Role frontend session and role check |
| `public/js/site-banner.js` | Shared login/logout banner |
| `public/js/admin.js` | Administrator dashboard behaviour |
| `scripts/copyMigrations.js` | Copies SQL migrations into compiled output |
| `tsconfig.json` | TypeScript compilation configuration |
| `package.json` | Dependencies and application scripts |

---

# Part 7 - Known limitations and future work

## 34. Known follow-up work

The following are known or potential improvements, not features that should be assumed to exist:

- **Concurrent first-time logins:** harden user creation against simultaneous first-time logins that attempt to create the same account. The authentication service currently has a TODO for this.
- **Duplicate Sheet entries:** consider rejecting duplicate email addresses in the authorised-user spreadsheet rather than accepting the first match.
- **Sheet redirects:** review redirect behaviour when retrieving the public Google Sheet CSV.
- **Production deployment:** add deployment-specific configuration and documentation for platforms such as Cloud Run and Cloud SQL.
- **Starter customisation:** consider removing original application-specific naming and making the starter fully configurable.
- **Frontend expansion:** the administrator dashboard's Dummy 1 and Dummy 2 sections are placeholders for future work.

Do not implement these automatically without considering the requested task.

## 35. Testing and verification

The automated test suite is run with:

```powershell
npm.cmd test
```

It covers:

- Administrator user routes.
- Authentication input validation.
- Authentication lifecycle.
- Authentication routes.
- Authentication service.
- Public configuration route.
- Database port validation.
- Error handling.
- Frontend delivery.
- Database readiness.
- Public Sheet parsing.
- Authentication middleware.
- Role middleware.
- Same-origin protection.

A passing automated test suite does not, by itself, prove that a live Google OAuth login or production database deployment is correctly configured.

Always run the tests again after making changes. Do not rely on historical test counts as evidence that the current working tree passes.

---

# Instructions to future AI agents

When working on this repository:

1. Read this README and inspect the actual source files before making architectural assumptions.
2. Treat the repository as a reusable authentication and role-based frontend foundation, not as a complete business application.
3. Do not conflate this boilerplate with any separate application that may use or adapt it.
4. Preserve the separation between Google identity verification, authentication decisions, database access and HTTP routes.
5. Preserve the separate runtime and migration database accounts.
6. Never put credentials, tokens or secrets in source code, browser code, logs or Git.
7. Never trust browser-supplied identity, email, role or administrator status.
8. Use PostgreSQL as the authoritative source for existing users and their roles.
9. Preserve dynamic role discovery from `public/frontends/`.
10. Do not introduce a second hardcoded role registry.
11. Remember that adding or removing a frontend directory requires a server restart for role discovery to refresh.
12. Preserve the distinction between an absent multiplier (`NULL`) and a numeric multiplier of `1`.
13. Use parameterised SQL queries.
14. Add or update automated tests when changing behaviour.
15. Explain security implications when proposing architectural changes.
16. Do not silently change the existing API contract, database schema or authentication flow.
17. Do not introduce unrelated application features.
18. When adding code, use clear comments explaining what it does, why it exists and important security decisions.
19. Identify assumptions and uncertainties rather than inventing missing requirements.
20. Before committing, inspect the working tree and stage only the files relevant to the requested change.

**First task for an agent:** inspect the repository and compare the actual implementation against this README. Report discrepancies, security concerns and unfinished work before proposing changes.