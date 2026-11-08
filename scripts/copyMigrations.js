// Copy SQL migration files into the compiled output directory.
// TypeScript compiles .ts files but does not copy .sql assets.
// The compiled migration runner expects these files beside itself in dist/config.

const fs = require("node:fs");
const path = require("node:path");

// Resolve paths from the project root, not from the current working directory.
const sourceDirectory = path.join(__dirname, "..", "src", "config");
const destinationDirectory = path.join(__dirname, "..", "dist", "config");

// Ensure the compiled configuration directory exists.
fs.mkdirSync(destinationDirectory, { recursive: true });

// Copy only files that match the migration filename convention.
const migrationFiles = fs
  .readdirSync(sourceDirectory)
  .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error("No SQL migration files were found.");
}

for (const filename of migrationFiles) {
  fs.copyFileSync(
    path.join(sourceDirectory, filename),
    path.join(destinationDirectory, filename),
  );

  console.log(`[BUILD] Copied migration: ${filename}`);
}
