/*
 * FRONTEND ROLE DISCOVERY
 *
 * Purpose:
 * Determine which application roles are actually deployed.
 *
 * The directory structure under public/frontends is the single
 * source of truth for available frontend roles. A role is available
 * only when its directory exists and contains index.html.
 *
 * This avoids maintaining a second list of roles in configuration
 * or database code. Adding a new role therefore means deploying
 * its frontend directory.
 */

import path from "node:path";
import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";

// The public frontend directory is outside the compiled dist directory.
// __dirname points to src/utils during development and dist/utils after
// TypeScript compilation, so moving two levels up reaches the project root.
const publicFrontendsDirectory = path.join(
  __dirname,
  "../../public/frontends",
);

// Only permit role names that can safely appear in a URL path segment.
// This matches the validation already used by app.ts.
const validRolePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Return every deployed frontend role.
//
// A directory counts as a role only when:
// - its name is a valid role URL segment;
// - it is actually a directory;
// - it contains an index.html entry page.
export function getFrontendRoles(): string[] {
  if (!existsSync(publicFrontendsDirectory)) {
    return [];
  }

  return readdirSync(publicFrontendsDirectory)
    .filter((entry) => {
      if (!validRolePattern.test(entry)) {
        return false;
      }

      const frontendDirectory = path.join(
        publicFrontendsDirectory,
        entry,
      );

      if (!statSync(frontendDirectory).isDirectory()) {
        return false;
      }

      return existsSync(path.join(frontendDirectory, "index.html"));
    })
    .sort();
}

// Check whether one particular role has a deployed frontend.
export function hasFrontendRole(role: string): boolean {
  if (!validRolePattern.test(role)) {
    return false;
  }

  return existsSync(
    path.join(publicFrontendsDirectory, role, "index.html"),
  );
}
