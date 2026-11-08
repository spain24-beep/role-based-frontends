/*
 * EXPRESS TYPE AUGMENTATION
 *
 * Add application-specific properties to Express Request
 * and express-session SessionData.
 *
 * This allows middleware and route handlers to access the
 * authenticated user and session user ID without type casts.
 */

import type { User } from "../repositories/usersRepository";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

export {};
