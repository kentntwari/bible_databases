import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Display numbered options and get user selection
 */
function listOptions(options, prompt) {
    options.forEach((option, index) => {
        console.log(`${index + 1}. ${option}`);
    });
    
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        rl.question(prompt, (answer) => {
            rl.close();
            const choice = parseInt(answer) - 1;
            resolve(options[choice]);
        });
    });
}

/**
 * Escape strings for PostgreSQL
 */
function escapeString(text) {
    if (text === null || text === undefined) {
        return 'NULL';
    }
    return text.replace(/'/g, "''");
}

/**
 * Normalize text (replace special characters)
 */
function normalizeText(text) {
    // Replace common characters
    text = text.replace(/Æ/g, "'");
    // You can add more normalization logic here
    return text.normalize('NFKD');
}

/**
 * Load JSON file for translation
 */
function loadJson(sourceDirectory, language, translation) {
    const jsonPath = join(sourceDirectory, language, translation, `${translation}.json`);
    const content = readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content);
}

/**
 * Get translation name from README
 */
function getReadmeTitle(sourceDirectory, language, translation) {
    const readmePath = join(sourceDirectory, language, translation, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');
    return content.split('\n')[0].trim();
}

/**
 * Get license info from README
 */
function getLicenseInfo(sourceDirectory, language, translation) {
    const readmePath = join(sourceDirectory, language, translation, 'README.md');
    const content = readFileSync(readmePath, 'utf-8');
    const lines = content.split('\n');
    
    for (const line of lines) {
        if (line.startsWith('**License:**')) {
            return line.split('**License:** ')[1].trim();
        }
    }
    return 'Unknown';
}

/**
 * Generate PostgreSQL dump with normalized schema
 */
function generatePostgreSQL(sourceDirectory, formatDirectory, language, translation, dryRun = false) {
    console.log(`\n📖 Loading data for ${translation}...`);
    
    const data = loadJson(sourceDirectory, language, translation);
    const translationName = getReadmeTitle(sourceDirectory, language, translation);
    const licenseInfo = getLicenseInfo(sourceDirectory, language, translation);
    
    const sqlPath = join(formatDirectory, 'psql', `${translation}.sql`);
    
    // Ensure psql directory exists
    const psqlDir = join(formatDirectory, 'psql');
    if (!existsSync(psqlDir)) {
        mkdirSync(psqlDir, { recursive: true });
    }
    
    let sqlContent = '';
    
    // Header
    sqlContent += `-- SQL Dump for ${translationName} (${translation})\n`;
    sqlContent += `-- License: ${licenseInfo}\n`;
    sqlContent += `-- Generated: ${new Date().toISOString()}\n\n`;
    
    // Drop existing tables (in reverse order of dependencies)
    sqlContent += `DROP TABLE IF EXISTS verse CASCADE;\n`;
    sqlContent += `DROP TABLE IF EXISTS chapter CASCADE;\n`;
    sqlContent += `DROP TABLE IF EXISTS book CASCADE;\n`;
    sqlContent += `DROP TABLE IF EXISTS translation CASCADE;\n\n`;
    
    // Create translation table
    sqlContent += `-- Translation table\n`;
    sqlContent += `CREATE TABLE translation (\n`;
    sqlContent += `    id SERIAL PRIMARY KEY,\n`;
    sqlContent += `    code VARCHAR(50) UNIQUE NOT NULL,\n`;
    sqlContent += `    name VARCHAR(255) NOT NULL,\n`;
    sqlContent += `    language VARCHAR(50),\n`;
    sqlContent += `    license TEXT\n`;
    sqlContent += `);\n\n`;
    
    // Insert translation
    const escapedTranslation = escapeString(translation);
    const escapedName = escapeString(translationName);
    const escapedLicense = escapeString(licenseInfo);
    const escapedLanguage = escapeString(language);
    
    sqlContent += `INSERT INTO translation (code, name, language, license)\n`;
    sqlContent += `VALUES ('${escapedTranslation}', '${escapedName}', '${escapedLanguage}', '${escapedLicense}');\n\n`;
    
    // Create book table
    sqlContent += `-- Book table\n`;
    sqlContent += `CREATE TABLE book (\n`;
    sqlContent += `    id SERIAL PRIMARY KEY,\n`;
    sqlContent += `    translation_id INTEGER NOT NULL,\n`;
    sqlContent += `    name VARCHAR(255) NOT NULL,\n`;
    sqlContent += `    book_number INTEGER NOT NULL,\n`;
    sqlContent += `    FOREIGN KEY (translation_id) REFERENCES translation(id) ON DELETE CASCADE\n`;
    sqlContent += `);\n\n`;
    
    // Create chapter table
    sqlContent += `-- Chapter table\n`;
    sqlContent += `CREATE TABLE chapter (\n`;
    sqlContent += `    id SERIAL PRIMARY KEY,\n`;
    sqlContent += `    book_id INTEGER NOT NULL,\n`;
    sqlContent += `    chapter_number INTEGER NOT NULL,\n`;
    sqlContent += `    FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE\n`;
    sqlContent += `);\n\n`;
    
    // Create verse table
    sqlContent += `-- Verse table\n`;
    sqlContent += `CREATE TABLE verse (\n`;
    sqlContent += `    id SERIAL PRIMARY KEY,\n`;
    sqlContent += `    chapter_id INTEGER NOT NULL,\n`;
    sqlContent += `    verse_number INTEGER NOT NULL,\n`;
    sqlContent += `    text TEXT NOT NULL,\n`;
    sqlContent += `    FOREIGN KEY (chapter_id) REFERENCES chapter(id) ON DELETE CASCADE\n`;
    sqlContent += `);\n\n`;
    
    // Create indexes for performance
    sqlContent += `-- Indexes\n`;
    sqlContent += `CREATE INDEX idx_book_translation ON book(translation_id);\n`;
    sqlContent += `CREATE INDEX idx_chapter_book ON chapter(book_id);\n`;
    sqlContent += `CREATE INDEX idx_verse_chapter ON verse(chapter_id);\n\n`;
    
    console.log(`📝 Generating SQL statements...`);
    
    // Insert data
    if (data.books && Array.isArray(data.books)) {
        for (let bookIndex = 0; bookIndex < data.books.length; bookIndex++) {
            const book = data.books[bookIndex];
            const escapedBookName = escapeString(book.name);
            
            sqlContent += `-- Book: ${book.name}\n`;
            sqlContent += `INSERT INTO book (translation_id, name, book_number)\n`;
            sqlContent += `VALUES ((SELECT id FROM translation WHERE code = '${escapedTranslation}'), '${escapedBookName}', ${bookIndex + 1});\n\n`;
            
            if (book.chapters && Array.isArray(book.chapters)) {
                for (const chapter of book.chapters) {
                    const chapterNumber = chapter.chapter;
                    
                    sqlContent += `INSERT INTO chapter (book_id, chapter_number)\n`;
                    sqlContent += `VALUES ((SELECT id FROM book WHERE name = '${escapedBookName}' AND translation_id = (SELECT id FROM translation WHERE code = '${escapedTranslation}')), ${chapterNumber});\n\n`;
                    
                    if (chapter.verses && Array.isArray(chapter.verses)) {
                        for (const verse of chapter.verses) {
                            const verseNumber = verse.verse;
                            const verseText = escapeString(normalizeText(verse.text));
                            
                            sqlContent += `INSERT INTO verse (chapter_id, verse_number, text)\n`;
                            sqlContent += `VALUES ((SELECT c.id FROM chapter c\n`;
                            sqlContent += `        JOIN book b ON c.book_id = b.id\n`;
                            sqlContent += `        WHERE b.name = '${escapedBookName}' AND c.chapter_number = ${chapterNumber}\n`;
                            sqlContent += `        AND b.translation_id = (SELECT id FROM translation WHERE code = '${escapedTranslation}')),\n`;
                            sqlContent += `        ${verseNumber}, '${verseText}');\n`;
                        }
                        sqlContent += '\n';
                    }
                }
            }
        }
    }
    
    // Write to file
    if (dryRun) {
        console.log(`\n[DRY RUN] Would write SQL to: ${sqlPath}`);
        console.log(`[DRY RUN] SQL content length: ${sqlContent.length} characters`);
        console.log(`[DRY RUN] First 500 characters:\n${sqlContent.substring(0, 500)}...`);
    } else {
        writeFileSync(sqlPath, sqlContent, 'utf-8');
    }
    
    console.log(`\n✅ SQL dump generated successfully!`);
    console.log(`📍 Location: ${sqlPath}`);
    console.log(`\n📊 Statistics:`);
    console.log(`   - Books: ${data.books?.length || 0}`);
    console.log(`   - Translation: ${translationName}`);
    console.log(`   - License: ${licenseInfo}\n`);
}

async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const languageArg = args.find(a => a.startsWith('--language=') || a.startsWith('-l='));
    const translationArg = args.find(a => a.startsWith('--translation=') || a.startsWith('-t='));
    
    const cliLanguage = languageArg ? languageArg.split('=')[1] : null;
    const cliTranslation = translationArg ? translationArg.split('=')[1] : null;
    
    console.log('╔════════════════════════════════════════╗');
    console.log('║  Bible PostgreSQL Database Generator  ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    if (dryRun) {
        console.log('🔍 Running in DRY RUN mode - no files will be written\n');
    }
    
    // Set base directories relative to the script location
    const baseDir = resolve(__dirname, '..');
    const sourceDirectory = join(baseDir, 'sources');
    const formatDirectory = join(baseDir, 'formats');

    let language, translation;
    
    // Step 1: Select Language
    const languages = readdirSync(sourceDirectory)
        .filter(d => {
            const fullPath = join(sourceDirectory, d);
            return statSync(fullPath).isDirectory() && d !== 'extras';
        })
        .sort();
    
    if (cliLanguage && languages.includes(cliLanguage)) {
        language = cliLanguage;
        console.log(`✓ Using language from CLI: ${language}\n`);
    } else {
        console.log('📚 Choose your language:');
        language = await listOptions(languages, '\n👉 Enter the number corresponding to your language: ');
        console.log(`\n✓ Selected language: ${language}\n`);
    }

    // Step 2: Select Translation
    const translationPath = join(sourceDirectory, language);
    const translations = readdirSync(translationPath)
        .filter(d => {
            const fullPath = join(translationPath, d);
            return statSync(fullPath).isDirectory();
        })
        .sort();
    
    if (cliTranslation && translations.includes(cliTranslation)) {
        translation = cliTranslation;
        console.log(`✓ Using translation from CLI: ${translation}`);
    } else {
        console.log(`📖 Choose your translation for ${language}:`);
        translation = await listOptions(translations, '\n👉 Enter the number corresponding to your translation: ');
        console.log(`\n✓ Selected translation: ${translation}`);
    }

    // Step 3: Generate PostgreSQL Dump
    try {
        generatePostgreSQL(sourceDirectory, formatDirectory, language, translation, dryRun);
        
        if (!dryRun) {
            console.log('═══════════════════════════════════════');
            console.log('Next steps:');
            console.log('1. Create your database: createdb bible_db');
            console.log('2. Run the SQL file: psql bible_db < ' + join(formatDirectory, 'psql', `${translation}.sql`));
            console.log('═══════════════════════════════════════\n');
        }
    } catch (error) {
        console.error('\n❌ Error generating SQL:', error.message);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});