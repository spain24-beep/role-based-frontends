/*
 * AUTHENTICATION SERVICE
 *
 * Purpose:
 * Authenticate a verified Google identity and determine whether
 * that person is authorised to use the application.
 *
 * This service coordinates the user repository and public
 * Google Sheet integration. It does not handle HTTP requests
 * or sessions; those responsibilities belong to the route.
 */

import usersRepository, { type User } from "../repositories/usersRepository";

import publicSheet from "../integrations/google/publicSheet";

// Verified identity supplied by the Google authentication route.
// Google may not provide given_name or family_name, so both are nullable.
export interface GoogleIdentity {
  googleSub: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
}

// Result returned to the authentication route.
export interface AuthenticationResult {
  user: User;
  isAdmin: boolean;
  isNewUser: boolean;
}

// Record a successful login and ensure the user still exists.
// A null result means the account disappeared during authentication.
async function recordLogin(userId: string): Promise<User> {
  const updatedUser = await usersRepository.updateLastLogin(userId);

  if (!updatedUser) {
    throw new Error("User account could not be updated");
  }

  return updatedUser;
}

// Authenticate a Google identity and determine whether
// that person is authorised to use the application.
async function authenticateGoogleUser(
  googleIdentity: GoogleIdentity,
): Promise<AuthenticationResult> {
  // Extract the verified identity supplied by Google.
  const {
    googleSub,
    email,
    givenName,
    familyName,
  } = googleIdentity;

  // Normalise the email so comparisons are consistent.
  const normalisedEmail = email.trim().toLowerCase();

  // Reject incomplete Google identity information.
  if (!googleSub) {
    throw new Error("Google account identifier is missing");
  }

  if (!normalisedEmail) {
    throw new Error("Google account email is missing");
  }

  // Read the failsafe administrator email from the environment.
  // This account can be admitted without appearing in the Sheet.
  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();

  // ---------------------------------------------------------
  // 1. Check whether this Google account already exists.
  // ---------------------------------------------------------

  const existingUser = await usersRepository.findByGoogleSub(googleSub);

  if (existingUser) {
    // Make sure the email has not been linked to another
    // database account.
    const emailOwner = await usersRepository.findByEmail(normalisedEmail);

    if (emailOwner && emailOwner.id !== existingUser.id) {
      throw new Error("Email address is linked to another account");
    }

    // Existing users retain the names saved when their account
    // was first created. Google profile changes must not overwrite
    // first_name or last_name during subsequent logins.

    // Record the successful login and retrieve the latest user.
    const updatedUser = await recordLogin(existingUser.id);

    return {
      user: updatedUser,
      isAdmin: updatedUser.role === "admin",
      isNewUser: false,
    };
  }

  // ---------------------------------------------------------
  // TODO: Consider concurrency hardening for simultaneous
  // first-time logins that could attempt to create the same user.
  // ---------------------------------------------------------

  // 2. Check the failsafe administrator account.
  // ---------------------------------------------------------

  if (adminEmail && normalisedEmail === adminEmail) {
    // Do not allow this email to be linked to a different
    // Google account already stored in the database.
    const emailOwner = await usersRepository.findByEmail(normalisedEmail);

    if (emailOwner) {
      throw new Error("Email address is linked to another account");
    }

    // Create the failsafe administrator.
    // The Google names are saved once, at account creation.
    // This account does not need to appear in the Sheet.
    const adminUser = await usersRepository.createUser({
      googleSub,
      email: normalisedEmail,
      firstName: givenName,
      lastName: familyName,
      multiplier: null,
      role: "admin",
    });

    // Record the first successful login.
    const updatedAdmin = await recordLogin(adminUser.id);

    return {
      user: updatedAdmin,
      isAdmin: updatedAdmin.role === "admin",
      isNewUser: true,
    };
  }

  // ---------------------------------------------------------
  // 3. Check the public Google Sheet for ordinary users.
  // ---------------------------------------------------------

  const authorisedUsers = await publicSheet.readAuthorisedUsers();

  // Find an exact email match in the authorised-user list.
  const authorisedUser = authorisedUsers.find(
    (sheetUser) => sheetUser.email === normalisedEmail,
  );

  // Reject accounts that are neither existing users,
  // the failsafe administrator, nor listed in the Sheet.
  if (!authorisedUser) {
    throw new Error("Your Google account is not authorised");
  }

  // Ensure the email is not already attached to another
  // Google account in the database.
  const emailOwner = await usersRepository.findByEmail(normalisedEmail);

  if (emailOwner) {
    throw new Error("Email address is linked to another account");
  }

  // Create the ordinary application user.
  // Their multiplier comes directly from the Sheet.
  // A blank multiplier remains null.
  // Their Google names are saved once, at account creation.
  const newUser = await usersRepository.createUser({
    googleSub,
    email: normalisedEmail,
    firstName: givenName,
    lastName: familyName,
    multiplier: authorisedUser.multiplier,
    role: "user",
  });

  // Record the first successful login.
  const updatedUser = await recordLogin(newUser.id);

  return {
    user: updatedUser,
    isAdmin: updatedUser.role === "admin",
    isNewUser: true,
  };
}

// Export the authentication service for use by the route.
const authService = {
  authenticateGoogleUser,
};

export default authService;
