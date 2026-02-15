// cleanup_non_english.js

const fs = require('fs');
const path = require('path');

/**
 * Scans the specified format directories and deletes non-English files.
 * Dry run mode and confirmation prompts included.
 *
 * @param {string} dir - The directory to scan.
 */
function cleanupNonEnglishFiles(dir) {
    fs.readdir(dir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return;
        }
        files.forEach(file => {
            const filePath = path.join(dir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error getting file stats:', err);
                    return;
                }
                if (stats.isFile()) {
                    // Check if file is non-English
                    if (!isEnglishFile(file)) {
                        console.log(`Non-English file found: ${filePath}`);
                        // Dry run mode:
                        console.log('Would delete:', filePath);
                        // prompt for confirmation before deletion
                        confirmDeletion(filePath);
                    }
                } else if (stats.isDirectory()) {
                    // Recursively scan subdirectories
                    cleanupNonEnglishFiles(filePath);
                }
            });
        });
    });
}

/**
 * Checks whether a file is English or not.
 * Dummy implementation; you can enhance this function.
 *
 * @param {string} fileName - The name of the file to check.
 * @returns {boolean} - True if the file is English, false otherwise.
 */
function isEnglishFile(fileName) {
    // Example criteria: return true if the file uses English characters
    return /^[\x00-\x7F]*$/.test(fileName);
}

/**
 * Prompts for confirmation before deletion.
 *
 * @param {string} filePath - The path of the file to potentially delete.
 */
function confirmDeletion(filePath) {
    const prompt = require('prompt-sync')();
    const answer = prompt(`Delete ${filePath}? (y/n): `);
    if (answer.toLowerCase() === 'y') {
        fs.unlink(filePath, err => {
            if (err) {
                console.error('Error deleting file:', err);
            } else {
                console.log(`Deleted: ${filePath}`);
            }
        });
    } else {
        console.log(`Skipped: ${filePath}`);
    }
}

// Usage example: cleanupNonEnglishFiles('path/to/your/directory');
