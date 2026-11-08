/*
 * PUBLIC GOOGLE SHEET INTEGRATION
 *
 * Purpose:
 * Read the public Google Auth Starter authorisation spreadsheet.
 *
 * The spreadsheet is publicly shared, so this integration uses
 * an ordinary HTTP request. No Google service account or API
 * credentials are required.
 *
 * Required spreadsheet column:
 * - Email address
 *
 * Optional spreadsheet column:
 * - multiplier
 *
 * Additional columns are permitted to support future extensions.
 * A missing, blank or invalid multiplier is returned as null.
 */

import { parse } from "csv-parse/sync";

// Type describing one row returned by the CSV parser.
// Spreadsheet cells are read as strings.
// Multiplier is optional because it is not essential to authorisation.
interface SpreadsheetRow {
  "Email address"?: string;
  multiplier?: string;
}

// Type describing the data returned to the application.
export interface AuthorisedUser {
  email: string;
  multiplier: number | null;
}

// Read the public Google Auth Starter authorisation spreadsheet.
async function readAuthorisedUsers(): Promise<AuthorisedUser[]> {
  // Read the public CSV export URL from the environment.
  // Keeping the URL in .env avoids hardcoding configuration here.
  const sheetUrl = process.env.GOOGLE_SHEET_URL;

  // Fail clearly if the environment variable is missing.
  if (!sheetUrl) {
    throw new Error("GOOGLE_SHEET_URL is not configured");
  }

  // Parse and validate the spreadsheet URL before making a request.
  // This prevents the integration from fetching arbitrary external URLs.
  let parsedSheetUrl: URL;

  try {
    parsedSheetUrl = new URL(sheetUrl);
  } catch {
    throw new Error("GOOGLE_SHEET_URL is not a valid URL");
  }

  // Only accept HTTPS URLs hosted on Google Sheets.
  if (
    parsedSheetUrl.protocol !== "https:" ||
    parsedSheetUrl.hostname !== "docs.google.com" ||
    !parsedSheetUrl.pathname.startsWith("/spreadsheets/")
  ) {
    throw new Error("GOOGLE_SHEET_URL must be a valid Google Sheets URL");
  }

  // Fetch the latest published spreadsheet data.
  // Node.js 26 provides fetch natively.
  const response = await fetch(sheetUrl, {
    signal: AbortSignal.timeout(15000),
  });

  // Reject unsuccessful HTTP responses.
  if (!response.ok) {
    throw new Error(
      `Could not read public spreadsheet: HTTP ${response.status}`,
    );
  }

  // Limit the spreadsheet download to 1 MB.
  // This prevents an unexpectedly large response from consuming
  // excessive application memory.
  const MAX_CSV_SIZE = 1024 * 1024;

  // Reject the response immediately if the server reports
  // a content length larger than our permitted limit.
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > MAX_CSV_SIZE) {
    await response.body?.cancel();

    throw new Error("Spreadsheet CSV exceeds the 1 MB size limit");
  }

  // Read the response in chunks so we can enforce the limit
  // even when the server does not provide a content length.
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("Spreadsheet response has no readable body");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > MAX_CSV_SIZE) {
      await reader.cancel();
      throw new Error("Spreadsheet CSV exceeds the 1 MB size limit");
    }

    chunks.push(value);
  }

  // Combine the downloaded chunks and decode them as UTF-8 text.
  const csvBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    csvBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const csvText = new TextDecoder("utf-8").decode(csvBytes);

  // Track whether the CSV parser encountered and validated a header row.
  let headersValidated = false;

  // Parse the CSV and validate its schema before accepting any rows.
  // Only Email address is mandatory. Additional columns are allowed.
  const rows = parse(csvText, {
    columns: (headers: string[]) => {
      // Count occurrences so a duplicated email header cannot
      // silently overwrite another column during CSV parsing.
      const emailHeaderCount = headers.filter(
        (header) => header === "Email address",
      ).length;

      if (emailHeaderCount === 0) {
        throw new Error(
          "Google Sheet is missing required column: Email address",
        );
      }

      if (emailHeaderCount > 1) {
        throw new Error(
          "Google Sheet contains duplicate column: Email address",
        );
      }

      headersValidated = true;

      // Return all original headers.
      // Optional and future columns are preserved.
      return headers;
    },
    skip_empty_lines: true,
    bom: true,
    trim: true,
  }) as SpreadsheetRow[];

  // An empty file or a file without a header row is not a valid Sheet.
  if (!headersValidated) {
    throw new Error("Google Sheet is empty or does not contain a header row");
  }

  // TODO: Consider rejecting duplicate email addresses in the
  // authorisation spreadsheet rather than silently accepting the first match.

  // Convert spreadsheet rows into the structure
  // that the application needs.
  return rows
    .filter((row) => row["Email address"])
    .map((row) => {
      // Normalise email addresses so comparisons
      // are not affected by capitalisation or spaces.
      const email = row["Email address"]!.trim().toLowerCase();

      // Read the optional multiplier from the spreadsheet.
      const rawMultiplier = row.multiplier;

      // Missing, blank or invalid values default to null.
      // Valid values must be finite numbers between 0 and 20.
      let multiplier: number | null = null;

      if (
        rawMultiplier !== undefined &&
        rawMultiplier !== null &&
        rawMultiplier.trim() !== ""
      ) {
        const parsedMultiplier = Number(rawMultiplier);

        if (
          Number.isFinite(parsedMultiplier) &&
          parsedMultiplier >= 0 &&
          parsedMultiplier <= 20
        ) {
          multiplier = parsedMultiplier;
        }
      }

      return {
        email,
        multiplier,
      };
    });
}

// Export the function so application services can use it.
const publicSheet = {
  readAuthorisedUsers,
};

export default publicSheet;
