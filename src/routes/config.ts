// PUBLIC CONFIGURATION ROUTE
//
// Purpose:
// Provide the browser with configuration values that are safe
// to expose publicly.
//
// The Google Client ID is public by design. The Google Client
// Secret and all other private server configuration must never
// be returned by this endpoint.

import { Router, type Request, type Response } from "express";

const router = Router();

// GET /api/config
//
// The browser cannot read the server's .env file directly.
// This endpoint provides the public Google Client ID so that
// the browser and backend use the same configured value.
router.get("/", (req: Request, res: Response) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();

  // Fail clearly if Google sign-in has not been configured.
  if (!googleClientId) {
    res.status(500).json({
      success: false,
      error: {
        code: "CONFIGURATION_ERROR",
        message: "Google sign-in is not configured",
      },
    });
    return;
  }

  // Return only the public Client ID.
  // Never include GOOGLE_CLIENT_SECRET or other server secrets.
  res.status(200).json({
    success: true,
    data: {
      googleClientId,
    },
  });
});

export default router;
