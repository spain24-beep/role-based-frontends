# Google Authentication + PostgreSQL Starter

A reusable Node.js / Express authentication foundation using Google Sign-In, PostgreSQL-backed user accounts and server-side sessions.

This repository is intended to be copied or adapted as the authentication starting point for other applications. It is **not a complete business application** and does not prescribe what the application built on top of it should do.

---

# Part 1 — Installation guide

## 1. What you need

Install the following:

- **Node.js** — use a current LTS release, including npm.
- **PostgreSQL** — version 18 was used during development.
- **Visual Studio Code** — recommended editor.
- **Google Cloud account** — to configure Google OAuth.
- **Google account** — to create the authorised-user spreadsheet.

The original development environment was Windows with PowerShell.

## 2. Install the project dependencies

Open the project directory in VS Code and open its integrated PowerShell terminal.

Install dependencies:

```powershell
npm.cmd install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
code .env
```

The `.env` file contains local credentials and configuration. It must never be committed to Git or uploaded to a public repository.

## 3. Configure Google Sign-In

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

The browser first requests the public Google Client ID from `GET /api/config`. This endpoint is public and does not require an authenticated session.

The backend reads the Client ID from its environment configuration and returns only that value in the standard API response envelope. The browser then uses Google Identity Services to obtain a Google ID token.

The browser does not read `.env` directly. The Client ID is public configuration, not a secret. The backend verifies the resulting ID token using Google's authentication library and checks its audience against the configured Client ID.

Never expose the Google Client Secret through the configuration endpoint.

## 4. Configure the authorised-user Google Sheet

The starter uses a publicly accessible Google Sheet as an admission list for new users.

The sheet must contain this exact mandatory column heading:

| Email address       | multiplier |
| ------------------- | ---------: |
| person@example.com  |       1.25 |
| another@example.com |            |

Only `Email address` is mandatory. `multiplier` is optional.

The spreadsheet must be shared publicly with link access so that the backend can retrieve its CSV export without a Google service account.

Set `GOOGLE_SHEET_URL` in `.env` to the spreadsheet's CSV export URL.

The application:

- Normalises email addresses to lowercase.
- Matches the exact `Email address` column.
- Accepts finite numeric multipliers between 0 and 20, inclusive.
- Treats blank, missing or invalid multipliers as `NULL`.
- Does not silently substitute a multiplier of 1.00.

Existing users are looked up in the database and do not need to be admitted again through the spreadsheet.

## 5. Configure PostgreSQL

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

## 6. Configure `.env`

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

Use the generated value for `SESSION_SECRET`. Use a different secret in each environment.

Never put real credentials in `.env.example`.

## 7. Run database migrations

From the project root:

```powershell
npm.cmd run migrate
```

The migration runner:

- Uses the dedicated migration database account.
- Finds numbered SQL migration files.
- Applies them in filename order.
- Records successful migrations in `schema_migrations`.
- Uses transactions for individual migrations.
- Uses a PostgreSQL advisory lock to prevent concurrent migration runs.

The application account is not used for migrations.

## 8. Run the application

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

The health endpoint is:

```text
http://localhost:3000/health
```

This is the liveness endpoint. It confirms that the application process is responding; it does not check PostgreSQL.

The database readiness endpoint is:

```text
http://localhost:3000/health/ready
```

## 9. Run the automated tests

```powershell
npm.cmd test
```

The test suite covers authentication routes, authentication service behaviour, spreadsheet parsing, configuration routes, database port validation, database readiness, authentication middleware, role middleware, same-origin protection and error handling.

Run tests after making changes to authentication, database access, middleware or configuration.

## 10. Available npm scripts

| Command                 | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `npm.cmd run dev`       | Compile TypeScript continuously; does not start the server  |
| `npm.cmd start`         | Start the compiled application                              |
| `npm.cmd test`          | Build the application and run automated tests               |
| `npm.cmd run migrate`   | Build the application and apply pending database migrations |
| `npm.cmd run build`     | Compile TypeScript and copy SQL migration files             |
| `npm.cmd run typecheck` | Check TypeScript without generating compiled output         |

---

# Part 2 — Technical overview for AI coding agents

The following section is intended to be supplied to another AI coding agent when asking it to understand, review, extend or adapt this repository.

## 1. Project identity and purpose

This repository is a reusable Google authentication foundation for Node.js applications.

It provides:

- Google Sign-In.
- Backend verification of Google ID tokens.
- Database-backed user identities.
- An externally maintained admission list.
- Database-managed application roles.
- PostgreSQL-backed server sessions.
- Authentication and role middleware.
- Same-origin protection for state-changing requests.
- Database migration infrastructure.
- Automated tests.

It is not a complete application.

Do not invent or assume business functionality. The application built on top of this foundation could be a financial application, an internal management system, a reporting tool or something entirely different.

The current implementation contains some original project-specific naming and configuration. Treat these as customisation points when reusing the starter.

## 2. Technology stack

- **Runtime:** Node.js
- **Backend language:** TypeScript, compiled to JavaScript
- **Backend framework:** Express 5
- **Database:** PostgreSQL
- **Database connectivity:** `pg` (node-postgres)
- **Authentication:** Google Sign-In using Google Identity Services in the browser
- **Google ID token verification:** `google-auth-library`
- **Session management:** `express-session`
- **Session storage:** `connect-pg-simple` (PostgreSQL)
- **Environment configuration:** `dotenv`
- **Google Sheets integration:** `csv-parse` for processing the public Google Sheet CSV export
- **Frontend:** Plain HTML and JavaScript, served as static files by Express
- **Database migrations:** Numbered SQL migration files, applied by a TypeScript migration runner
- **Build and compilation:** TypeScript compiler (`tsc`)
- **Build support:** A Node.js script copies SQL migration files into the compiled output directory
- **Module system:** CommonJS
- **Testing:** Node.js built-in test runner (`node --test`)
- **Development:** TypeScript watch mode (`tsc --watch`); the Express server is started separately

Do not introduce another authentication provider unless explicitly requested.

## 3. Authentication flow

The authentication process works as follows:

1. The browser obtains a Google ID token using Google Identity Services.
2. The browser sends the token to the backend at `POST /api/auth/google`.
3. The backend verifies the token using Google's authentication library.
4. The backend validates the token audience against `GOOGLE_CLIENT_ID`.
5. The backend obtains the verified Google `sub` and email.
6. The backend looks up the user by Google `sub`.
7. If an existing account is found, its last-login timestamp is updated.
8. If the email belongs to a different existing account, authentication is rejected with HTTP 409.
9. If the account is new and its email matches `ADMIN_EMAIL`, it is admitted as an administrator without checking the spreadsheet.
10. Otherwise, the backend checks the publicly accessible Google Sheet.
11. If the email is not on the sheet, access is rejected with HTTP 403 and no user record is created.
12. If the email is authorised, a database user is created with the ordinary `user` role.
13. The server creates a session containing the internal database user ID.
14. The browser receives the authentication result.

The Google `sub` is a stable external identity identifier. It is stored in the database but is not exposed in the normal authentication response.

The browser must never be trusted to supply its own identity, role or administrator status.

### Account lifecycle policy

The application uses the following account lifecycle rules:

- **Google Sheet authorisation applies to new accounts only.** A person must appear in the authorised-user Google Sheet to create an ordinary application account. Once created, their database account remains valid even if their email address is subsequently removed from the Sheet. Removing someone from the Sheet does not revoke or disable an existing account.

- **ADMIN_EMAIL is an administrator bootstrap mechanism.** When a Google identity does not already have an application account, a matching ADMIN_EMAIL can be used to create the failsafe administrator account without requiring an entry in the Google Sheet. It does not continuously control administrator permissions.

- **The database is authoritative for existing users and roles.** Changing ADMIN_EMAIL does not automatically promote or demote an existing account. An existing user's database role remains in force when they log in, regardless of whether their email matches the current ADMIN_EMAIL value.

These rules are intentional. The Google Sheet controls initial admission, while the application database controls the ongoing status and permissions of established accounts.

## 4. User roles

The database currently supports two roles:

- `admin`
- `user`

The role is stored in PostgreSQL and is authoritative.

The `ADMIN_EMAIL` environment variable provides an administrator admission mechanism for the configured Google account. It is not a substitute for database role management.

Other users can be promoted by changing their database role.

Never trust a role value supplied by the browser.

## 5. User database

The `users` table includes:

- `id` — internal database identity.
- `google_sub` — Google's stable user identifier.
- `email` — normalised email address.
- `role` — `admin` or `user`.
- `multiplier` — nullable numeric value.
- `created_at`
- `updated_at`
- `last_login_at`

The multiplier is optional. Blank or invalid spreadsheet values must remain `NULL`.

The current accepted multiplier range is 0–20 inclusive.

## 6. Sessions

Sessions are stored in PostgreSQL using `connect-pg-simple`.

The browser session cookie is HTTP-only, uses `SameSite=Lax`, and has an eight-hour maximum lifetime.

The `secure` cookie setting is enabled in production.

The session stores only the internal `userId`. It does not store a trusted copy of the user's role or other authorisation decisions.

On authenticated requests, `requireAuth` retrieves the current user from PostgreSQL. This means changes to roles take effect without requiring the user to sign out and back in.

The session table is created through a database migration. The running application should not need permission to create it.

## 7. Security architecture

Important security boundaries:

### Google identity

- Verify ID tokens on the backend.
- Validate the audience.
- Require a verified email.
- Never trust browser-supplied identity or role information.

### Database

- Use separate runtime and migration credentials.
- The runtime account must not own the database or schema.
- Do not grant runtime database superuser, role-creation or database-creation privileges.
- Use parameterised SQL queries.
- Do not expose database credentials in logs or API responses.

### Sessions

- Store sessions server-side.
- Store only the internal user ID in the session.
- Retrieve current user and role information from the database.
- Destroy sessions on logout.

### Cross-origin requests

- `requireSameOrigin` validates the configured `APP_ORIGIN`.
- Missing or foreign origins are rejected for state-changing requests.
- Safe methods (`GET`, `HEAD`, `OPTIONS`) bypass the origin check.
- Do not implement state-changing operations using GET requests.

Same-origin protection is a CSRF defence. It does not replace authentication or authorisation.

### Google Sheet

- The CSV export URL is validated.
- Only HTTPS Google Sheets URLs are accepted.
- CSV retrieval has a timeout and size limit.
- Column names are checked.
- Invalid multiplier values are not silently converted into a default.

## 8. Security and configuration checklist

Use this checklist whenever deploying a new instance or changing its configuration.

### Secrets and environment variables

- [ ] Keep `.env` local and never commit it to Git.
- [ ] Commit only `.env.example`, containing placeholder values rather than real credentials.
- [ ] Generate a unique, high-entropy `SESSION_SECRET` for each deployment.
- [ ] Keep Google OAuth credentials and database passwords private.
- [ ] Restrict access to production environment variables to authorised administrators.
- [ ] If a secret is exposed, rotate it immediately. Removing it from the current file does not remove it from Git history.

### Google authentication

- [ ] Use the correct Google OAuth Web Client ID for the deployment.
- [ ] Configure the exact authorised JavaScript origins in Google Cloud.
- [ ] Ensure the backend validates Google ID tokens, including their audience, signature and expiry.
- [ ] Require Google's `email_verified` claim.
- [ ] Never rely on frontend checks to establish a user's identity or privileges.
- [ ] Do not use an email-domain suffix as a substitute for verified identity or explicit admission.
- [ ] Protect `ADMIN_EMAIL` and verify that it identifies the intended administrator.

### Authorised-user Google Sheet

- [ ] Confirm that the configured Sheet is the intended admission list.
- [ ] The Sheet is deliberately publicly readable by link. Do not put passwords, financial details or other sensitive information in it.
- [ ] Keep the admission list limited to the data the application needs, such as email addresses and multipliers.
- [ ] Verify that email addresses are entered correctly.
- [ ] Check that multiplier values are numeric and within the application's accepted range (0–20). Blank, missing or invalid values must not silently become `1`.

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
- [ ] Keep the configured session lifetime and cookie policy appropriate for the application.
- [ ] Preserve the server-side Origin checks for state-changing requests.
- [ ] Do not expose internal error details, credentials or session data in API responses or logs.
- [ ] Run database migrations using the migration account, not the runtime account.
- [ ] Run the automated test suite before deployment.
- [ ] Review dependency vulnerabilities and update dependencies regularly.

### Final release check

- [ ] Confirm that no `.env` file, credentials, private keys or production data are tracked by Git.
- [ ] Review the files and changes being committed before pushing.
- [ ] Verify the deployed application is using the intended Google OAuth client, admission Sheet and database.
- [ ] Test login, logout, unauthorised access and administrator access after deployment.

## 9. Current project structure

```text
project-root/
├── manual-tests/
│   ├── test-db.js
│   ├── test-sheet.js
│   └── test-users.js
├── public/
│   ├── css/
│   │   └── site-banner.css
│   ├── frontends/
│   │   ├── admin/
│   │   │   └── index.html
│   │   └── user/
│   │       └── index.html
│   ├── js/
│   │   ├── auth.js
│   │   ├── frontend-auth.js
│   │   └── site-banner.js
│   └── index.html
├── scripts/
│   └── copyMigrations.js
├── src/
│   ├── config/
│   │   ├── 001_create_users.sql
│   │   ├── 002_add_user_roles.sql
│   │   ├── 003_create_user_sessions.sql
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

The `src` directory contains the TypeScript application source and SQL migration files. TypeScript is compiled into `dist`, and the build script copies the SQL migration files into the corresponding compiled directory.

The `public` directory contains browser-side static assets served by Express. The login page is public; the role-specific frontend directories are protected by backend authentication and role checks.

The `.env` file is intentionally omitted from this project tree because it contains local credentials and must not be committed to Git. `.env.example` documents the required configuration keys without containing actual credentials.

The tests and manual tests remain JavaScript files and load the compiled application modules from `dist`.

## 10. Important implementation files

| File                                     | Responsibility                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/server.ts`                          | Loads environment configuration and starts Express                                   |
| `src/app.ts`                             | Configures Express middleware, static files and routes                               |
| `src/routes/auth.ts`                     | Authentication, session restoration and logout endpoints                             |
| `src/routes/config.ts`                   | Provides the public Google Client ID configuration                                   |
| `src/routes/adminUsers.ts`               | Administrator user-list and user-detail endpoints                                    |
| `src/controllers/authController.ts`      | Handles authentication requests, session restoration and logout                      |
| `src/services/authService.ts`            | Authentication and admission decisions                                               |
| `src/repositories/usersRepository.ts`    | Database operations for users                                                        |
| `src/integrations/google/publicSheet.ts` | Public Google Sheet CSV retrieval and parsing                                        |
| `src/config/database.ts`                 | Runtime PostgreSQL connection pool                                                   |
| `src/config/migrationDatabase.ts`        | Separate migration PostgreSQL connection pool                                        |
| `src/config/runMigrations.ts`            | Ordered, transactional database migration runner                                     |
| `src/config/session.ts`                  | PostgreSQL-backed session configuration                                              |
| `src/middleware/requireAuth.ts`          | Requires a valid authenticated user                                                  |
| `src/middleware/requireRole.ts`          | Enforces database-managed roles                                                      |
| `src/middleware/requireSameOrigin.ts`    | Validates request origin                                                             |
| `src/types/express.d.ts`                 | Adds application-specific types to Express request objects                           |
| `scripts/copyMigrations.js`              | Copies SQL migration files into the compiled output directory                        |
| `public/js/auth.js`                      | Retrieves public sign-in configuration and runs the browser-side Google Sign-In flow |
| `tsconfig.json`                          | Configures TypeScript compilation and strict type checking                           |
| `package.json`                           | Defines dependencies, development scripts, build, migration and test commands        |

The application source is TypeScript. The build process compiles it into JavaScript in `dist`, which is what Node.js executes.

The JavaScript files in `tests`, `manual-tests`, `public` and `scripts` serve separate purposes and are not leftover application source files.

## 11. API endpoints

| Method | Endpoint               | Purpose                                                                 |
| ------ | ---------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/api/config`          | Return the public Google Client ID configuration                        |
| `POST` | `/api/auth/google`     | Verify Google ID token and establish a session                          |
| `GET`  | `/api/auth/me`         | Return the current authenticated user                                   |
| `POST` | `/api/auth/logout`     | Destroy the current session                                             |
| `GET`  | `/api/admin/users`     | Return a paginated administrator user list                              |
| `GET`  | `/api/admin/users/:id` | Return an individual user to an administrator                           |
| `GET`  | `/health`              | Application liveness check; does not query PostgreSQL                   |
| `GET`  | `/health/ready`        | Database readiness check; returns HTTP 503 if PostgreSQL is unavailable |

`GET /api/config` is public and read-only. The authentication and administrator endpoints have their own access requirements.

## 12. Tests and current baseline

The latest verified automated test run completed successfully:

- 66 automated tests passed.
- No automated tests failed.
- The build completed successfully.
- The test command exited with code 0.

The test suite covers authentication routes, authentication service behaviour, session lifecycle, spreadsheet parsing, public configuration, administrator user routes, database port validation, database readiness, authentication middleware, role middleware, same-origin protection and error handling.

These results describe the latest verified development baseline, not a guarantee that future changes remain correct. Run the tests again after making changes.

A passing automated test suite does not, by itself, prove that a live Google OAuth login or production database deployment is correctly configured.

## 13. Known follow-up work

The following are known or potential improvements, not features that should be assumed to exist:

- Handle simultaneous first-time logins without an unhandled duplicate-user error. This has been deferred because simultaneous first-time logins are expected to be uncommon in the initial private application.
- Consider rejecting duplicate email addresses in the authorised-user spreadsheet rather than silently accepting the first match.
- Review redirect behaviour when retrieving the public Google Sheet.
- Add production deployment configuration for Cloud Run and Cloud SQL.
- Remove original application-specific naming and make the starter fully configurable.

Do not implement these automatically without considering the requested task.

---

# Instructions to future AI agents

When working on this repository:

1. Read this README and inspect the actual source files before making architectural assumptions.
2. Treat the repository as a reusable authentication foundation, not as a complete business application.
3. Preserve the separation between Google identity verification, authentication decisions, database access and HTTP routes.
4. Preserve the separate runtime and migration database accounts.
5. Never put credentials, tokens or secrets in source code, browser code, logs or Git.
6. Never trust browser-supplied identity, email, role or administrator status.
7. Use the database as the authoritative source for user roles.
8. Preserve the distinction between an absent multiplier (`NULL`) and a numeric multiplier of `1`.
9. Use parameterised SQL queries.
10. Add or update automated tests when changing behaviour.
11. Explain security implications when proposing architectural changes.
12. Do not silently change the existing API contract, database schema or authentication flow.
13. Do not introduce unrelated application features.
14. When adding code, use clear comments explaining what it does, why it exists and important security decisions.
15. Identify assumptions and uncertainties rather than inventing missing requirements.

**First task for an agent:** inspect the repository and compare the actual implementation against this README. Report discrepancies, security concerns and unfinished work before proposing changes.
