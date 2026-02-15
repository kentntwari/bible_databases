// cleanup_non_english.js

const fs = require("fs");
const path = require("path");

// Known English Bible translation codes (from sources/en/)
const ENGLISH_TRANSLATIONS = new Set([
  "ACV",
  "AKJV",
  "Anderson",
  "ASV",
  "BBE",
  "BSB",
  "CPDV",
  "Darby",
  "DRC",
  "Geneva1599",
  "Haweis",
  "JPS",
  "Jubilee2000",
  "KJV",
  "KJVA",
  "KJVPCE",
  "LEB",
  "LITV",
  "MKJV",
  "NHEB",
  "NHEBJE",
  "NHEBME",
  "Noyes",
  "OEB",
  "OEBcth",
  "RLT",
  "RNKJV",
  "Rotherham",
  "RWebster",
  "Twenty",
  "Tyndale",
  "UKJV",
  "Webster",
  "YLT",
  "Wycliffe",
]);

/**
 * Scans the specified format directories and deletes non-English files.
 * Dry run mode and confirmation prompts included.
 *
 * @param {string} dir - The directory to scan.
 */
function cleanupNonEnglishFiles(dir, dryRun = false, force = false) {
  fs.readdir(dir, (err, files) => {
    if (err) {
      console.error("Error reading directory:", err);
      return;
    }
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error("Error getting file stats:", err);
          return;
        }
        if (stats.isFile()) {
          // Check if file is non-English
          if (!isEnglishFile(file)) {
            console.log(`Non-English file found: ${filePath}`);
            // Dry run mode:
            console.log("Would delete:", filePath);
            // prompt for confirmation before deletion
            confirmDeletion(filePath, dryRun, force);
          }
        } else if (stats.isDirectory()) {
          // Recursively scan subdirectories
          cleanupNonEnglishFiles(filePath, dryRun, force);
        }
      });
    });
  });
}

/**
 * Checks whether a file is an English translation.
 *
 * @param {string} fileName - The name of the file to check.
 * @returns {boolean} - True if the file is English, false otherwise.
 */
function isEnglishFile(fileName) {
  // Extract the translation code (filename without extension)
  const translationCode = path.parse(fileName).name;
  return ENGLISH_TRANSLATIONS.has(translationCode);
}

/**
 * Prompts for confirmation before deletion.
 *
 * @param {string} filePath - The path of the file to potentially delete.
 * @param {boolean} dryRun - If true, skip actual deletion.
 * @param {boolean} force - If true, delete without prompting.
 */
function confirmDeletion(filePath, dryRun = false, force = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would delete: ${filePath}`);
    return;
  }
  if (force) {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
      } else {
        console.log(`Deleted: ${filePath}`);
      }
    });
    return;
  }
  const prompt = require("prompt-sync")();
  const answer = prompt(`Delete ${filePath}? (y/n): `);
  if (answer.toLowerCase() === "y") {
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("Error deleting file:", err);
      } else {
        console.log(`Deleted: ${filePath}`);
      }
    });
  } else {
    console.log(`Skipped: ${filePath}`);
  }
}

// CLI support
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run") || args.includes("-d");
  const force = args.includes("--force") || args.includes("-f");
  const targetDir =
    args.find((arg) => !arg.startsWith("-")) || path.join(__dirname, "..", "formats");

  console.log(`Scanning: ${targetDir}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}${force ? " (FORCE)" : ""}\n`);

  cleanupNonEnglishFiles(targetDir, dryRun, force);
}
