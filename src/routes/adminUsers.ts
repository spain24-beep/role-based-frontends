/*
 * ADMIN USER ROUTES
 *
 * Purpose:
 * Provide administrator-only endpoints for listing users,
 * retrieving individual users, discovering available frontend
 * roles, changing user roles, editing names and editing multipliers.
 *
 * Authentication and authorisation are applied when this
 * router is mounted in app.ts.
 *
 * Available roles are discovered from public/frontends.
 * A role is valid only when its frontend directory exists
 * and contains an index.html entry page.
 *
 * API contract:
 * Successful responses use { success: true, data: {} }.
 * Error responses use { success: false, error: { code, message } }.
 */

import express, { type Request, type Response } from "express";

import usersRepository, { type User } from "../repositories/usersRepository";
import {
  getFrontendRoles,
  hasFrontendRole,
} from "../utils/frontendRoles";

// Create a router for administrator user-management endpoints.
const router = express.Router();

// Return only fields intended to be visible through the API.
// Google's internal account identifier is deliberately excluded.
function toPublicUser(user: User) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    role: user.role,
    multiplier: user.multiplier,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at,
  };
}

// Read a query parameter only when it is a single string.
function getSingleQueryValue(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  return value;
}

// Parse a non-negative integer query parameter.
function parseIntegerQuery(
  value: unknown,
  defaultValue: number,
): number | null {
  const rawValue = getSingleQueryValue(value);

  if (rawValue === undefined) {
    return defaultValue;
  }

  if (rawValue === null || !/^\d+$/.test(rawValue)) {
    return null;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isSafeInteger(parsedValue)) {
    return null;
  }

  return parsedValue;
}

// ---------------------------------------------------------
// GET /api/admin/users/roles
//
// Return the roles for which a frontend is actually deployed.
// ---------------------------------------------------------

router.get("/roles", (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    data: {
      roles: getFrontendRoles(),
    },
  });
});

// ---------------------------------------------------------
// GET /api/admin/users
//
// List users with pagination and optional filtering.
// ---------------------------------------------------------

router.get("/", async (req: Request, res: Response) => {
  const limit = parseIntegerQuery(req.query.limit, 25);
  const offset = parseIntegerQuery(req.query.offset, 0);

  if (limit === null || limit < 1 || limit > 100 || offset === null) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "Invalid pagination parameters",
      },
    });
  }

  const role = getSingleQueryValue(req.query.role);
  const search = getSingleQueryValue(req.query.search);

  if (
    role === null ||
    (role !== undefined &&
      (role.trim().length === 0 || role.trim().length > 64))
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "Invalid role filter",
      },
    });
  }

  if (search === null || (search !== undefined && search.length > 200)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_QUERY",
        message: "Invalid email search",
      },
    });
  }

  const result = await usersRepository.listUsers({
    limit,
    offset,
    role: role?.trim(),
    search: search?.trim(),
  });

  return res.status(200).json({
    success: true,
    data: {
      users: result.users.map(toPublicUser),
      totalAccounts: result.totalAccounts,
      pagination: {
        limit,
        offset,
        total: result.total,
      },
    },
  });
});

// ---------------------------------------------------------
// PATCH /api/admin/users/:id/names
//
// Explicitly update a user's first and last names.
// Google login never calls this endpoint.
// ---------------------------------------------------------

router.patch("/:id/names", async (req: Request, res: Response) => {
  const userId = req.params.id;

  if (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_USER_ID",
        message: "A valid user ID is required",
      },
    });
  }

  const firstName = req.body?.firstName;
  const lastName = req.body?.lastName;

  if (typeof firstName !== "string" || typeof lastName !== "string") {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_NAMES",
        message: "First name and last name must both be supplied as text",
      },
    });
  }

  const normalisedFirstName = firstName.trim();
  const normalisedLastName = lastName.trim();

  if (
    normalisedFirstName.length > 100 ||
    normalisedLastName.length > 100
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_NAMES",
        message: "First name and last name must not exceed 100 characters each",
      },
    });
  }

  const existingUser = await usersRepository.findById(userId);

  if (!existingUser) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  const updatedUser = await usersRepository.updateNames(userId, {
    firstName: normalisedFirstName,
    lastName: normalisedLastName,
  });

  if (!updatedUser) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      user: toPublicUser(updatedUser),
    },
  });
});

// ---------------------------------------------------------
// PATCH /api/admin/users/:id/multiplier
//
// Explicitly update or clear a user's multiplier.
//
// Accepted values:
// - A number from 0 to 20.
// - A numeric string from 0 to 20.
// - null or an empty string to clear the multiplier.
// ---------------------------------------------------------

router.patch("/:id/multiplier", async (req: Request, res: Response) => {
  const userId = req.params.id;

  if (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_USER_ID",
        message: "A valid user ID is required",
      },
    });
  }

  const suppliedMultiplier = req.body?.multiplier;

  // Treat a blank field or explicit null as no multiplier.
  let normalisedMultiplier: string | null = null;

  if (
    suppliedMultiplier !== null &&
    suppliedMultiplier !== undefined &&
    suppliedMultiplier !== ""
  ) {
    // Accept a number or a plain decimal string.
    // Reject booleans, objects, arrays and other unexpected values.
    if (
      typeof suppliedMultiplier !== "number" &&
      typeof suppliedMultiplier !== "string"
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_MULTIPLIER",
          message: "Multiplier must be a number between 0 and 20, or blank",
        },
      });
    }

    const rawMultiplier = String(suppliedMultiplier).trim();

    // Require a conventional decimal number rather than accepting
    // JavaScript-specific formats such as hexadecimal or Infinity.
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawMultiplier)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_MULTIPLIER",
          message: "Multiplier must be a valid decimal number",
        },
      });
    }

    const parsedMultiplier = Number(rawMultiplier);

    if (
      !Number.isFinite(parsedMultiplier) ||
      parsedMultiplier < 0 ||
      parsedMultiplier > 20
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_MULTIPLIER",
          message: "Multiplier must be between 0 and 20",
        },
      });
    }

    // Store a normalised decimal representation.
    normalisedMultiplier = String(parsedMultiplier);
  }

  const existingUser = await usersRepository.findById(userId);

  if (!existingUser) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  const updatedUser = await usersRepository.updateMultiplier(
    userId,
    normalisedMultiplier,
  );

  if (!updatedUser) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      user: toPublicUser(updatedUser),
    },
  });
});

// ---------------------------------------------------------
// PATCH /api/admin/users/:id/role
//
// Change a user's application role.
//
// The requested role must have a deployed frontend.
// An administrator cannot remove their own administrator role.
// ---------------------------------------------------------

router.patch("/:id/role", async (req: Request, res: Response) => {
  const userId = req.params.id;

  if (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_USER_ID",
        message: "A valid user ID is required",
      },
    });
  }

  const requestedRole = req.body?.role;

  if (
    typeof requestedRole !== "string" ||
    !hasFrontendRole(requestedRole)
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_ROLE",
        message: "The requested role does not have a deployed frontend",
      },
    });
  }

  if (
    requestedRole !== "admin" &&
    req.user &&
    String(req.user.id) === userId
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "SELF_DEMOTION_FORBIDDEN",
        message: "An administrator cannot remove their own administrator role",
      },
    });
  }

  const existingUser = await usersRepository.findById(userId);

  if (!existingUser) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  if (existingUser.role === requestedRole) {
    return res.status(200).json({
      success: true,
      data: {
        user: toPublicUser(existingUser),
      },
    });
  }

  const updatedUser = await usersRepository.updateRole(
    userId,
    requestedRole,
  );

  if (!updatedUser) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      user: toPublicUser(updatedUser),
    },
  });
});

// ---------------------------------------------------------
// GET /api/admin/users/:id
//
// Retrieve one user using their internal database ID.
// ---------------------------------------------------------

router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.params.id;

  if (typeof userId !== "string" || !/^[1-9]\d*$/.test(userId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_USER_ID",
        message: "A valid user ID is required",
      },
    });
  }

  const user = await usersRepository.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found",
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      user: toPublicUser(user),
    },
  });
});

// Export the router for mounting in app.ts.
export default router;