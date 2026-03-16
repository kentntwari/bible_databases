import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as readline from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration from environment variables (used in --direct mode)
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'bible_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSLMODE === 'require' ? { rejectUnauthorized: false } : false,
};

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
    if (!text) return '';
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
 * Generate PostgreSQL dump file with normalized schema
 */
function generateDumpFile(sourceDirectory, formatDirectory, language, translation, dryRun = false) {
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
    
    // Enable UUID extension
    sqlContent += `-- Enable UUID extension\n`;
    sqlContent += `CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n\n`;
    
    // Create translation table
    sqlContent += `-- Translation table\n`;
    sqlContent += `CREATE TABLE translation (\n`;
    sqlContent += `    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
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
    sqlContent += `    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
    sqlContent += `    translation_id UUID NOT NULL,\n`;
    sqlContent += `    name VARCHAR(255) NOT NULL,\n`;
    sqlContent += `    book_number INTEGER NOT NULL,\n`;
    sqlContent += `    FOREIGN KEY (translation_id) REFERENCES translation(id) ON DELETE CASCADE\n`;
    sqlContent += `);\n\n`;
    
    // Create chapter table
    sqlContent += `-- Chapter table\n`;
    sqlContent += `CREATE TABLE chapter (\n`;
    sqlContent += `    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
    sqlContent += `    book_id UUID NOT NULL,\n`;
    sqlContent += `    chapter_number INTEGER NOT NULL,\n`;
    sqlContent += `    FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE\n`;
    sqlContent += `);\n\n`;
    
    // Create verse table
    sqlContent += `-- Verse table\n`;
    sqlContent += `CREATE TABLE verse (\n`;
    sqlContent += `    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
    sqlContent += `    chapter_id UUID NOT NULL,\n`;
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

/**
 * Directly import a translation into a live PostgreSQL database
 */
async function generateDirect(sourceDirectory, language, translation) {
    const client = new Client(dbConfig);
    
    try {
        await client.connect();
        console.log('✅ Connected to PostgreSQL database\n');
        
        const data = loadJson(sourceDirectory, language, translation);
        const translationName = getReadmeTitle(sourceDirectory, language, translation);
        const licenseInfo = getLicenseInfo(sourceDirectory, language, translation);
        
        // Begin transaction
        await client.query('BEGIN');

        // Enable pgcrypto extension for UUID generation
        await client.query(`
            CREATE EXTENSION IF NOT EXISTS "pgcrypto"
        `);
        
        // Create tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS translation (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                code VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                language VARCHAR(50),
                license TEXT
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS book (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                translation_id UUID NOT NULL,
                name VARCHAR(255) NOT NULL,
                book_number INTEGER NOT NULL,
                FOREIGN KEY (translation_id) REFERENCES translation(id) ON DELETE CASCADE
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS chapter (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                book_id UUID NOT NULL,
                chapter_number INTEGER NOT NULL,
                FOREIGN KEY (book_id) REFERENCES book(id) ON DELETE CASCADE
            )
        `);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS verse (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                chapter_id UUID NOT NULL,
                verse_number INTEGER NOT NULL,
                text TEXT NOT NULL,
                FOREIGN KEY (chapter_id) REFERENCES chapter(id) ON DELETE CASCADE
            )
        `);
        
        // Insert translation
        const translationResult = await client.query(
            'INSERT INTO translation (code, name, language, license) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO UPDATE SET name = $2, language = $3, license = $4 RETURNING id',
            [translation, translationName, language, licenseInfo]
        );
        const translationId = translationResult.rows[0].id;
        
        console.log(`📝 Inserting data for ${translationName}...`);
        
        let totalVerses = 0;
        
        // Insert books, chapters, and verses with batched verse inserts
        for (let bookIndex = 0; bookIndex < data.books.length; bookIndex++) {
            const book = data.books[bookIndex];
            
            const bookResult = await client.query(
                'INSERT INTO book (translation_id, name, book_number) VALUES ($1, $2, $3) RETURNING id',
                [translationId, book.name, bookIndex + 1]
            );
            const bookId = bookResult.rows[0].id;
            
            for (const chapter of book.chapters) {
                const chapterResult = await client.query(
                    'INSERT INTO chapter (book_id, chapter_number) VALUES ($1, $2) RETURNING id',
                    [bookId, chapter.chapter]
                );
                const chapterId = chapterResult.rows[0].id;
                
                // Batch insert verses for this chapter
                if (chapter.verses && chapter.verses.length > 0) {
                    const values = [];
                    const params = [];
                    let paramIndex = 1;
                    
                    for (const verse of chapter.verses) {
                        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
                        params.push(chapterId, verse.verse, normalizeText(verse.text));
                        paramIndex += 3;
                        totalVerses++;
                    }
                    
                    await client.query(
                        `INSERT INTO verse (chapter_id, verse_number, text) VALUES ${values.join(', ')}`,
                        params
                    );
                }
            }
            
            process.stdout.write(`\r   Progress: ${bookIndex + 1}/${data.books.length} books (${totalVerses} verses)`);
        }
        
        console.log('\n');
        
        // Commit transaction
        await client.query('COMMIT');
        
        console.log(`✅ Successfully imported ${translationName} into database!`);
        console.log(`   Total verses: ${totalVerses}\n`);
        
    } catch (error) {
        console.error('\n❌ Error during import:', error.message);
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            // Connection may already be closed
        }
        throw error;
    } finally {
        try {
            await client.end();
        } catch (endError) {
            // Connection may already be closed
        }
    }
}

async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const directMode = args.includes('--direct') || args.includes('-D');
    const dryRun = !directMode && (args.includes('--dry-run') || args.includes('-d'));
    const wantsAll = args.includes('--all') || args.includes('-a');
    const allTranslations = directMode && wantsAll;
    const languageArg = args.find(a => a.startsWith('--language=') || a.startsWith('-l='));
    const translationArg = args.find(a => a.startsWith('--translation=') || a.startsWith('-t='));

    // --all only makes sense with --direct
    if (wantsAll && !directMode) {
        console.error('❌ --all / -a can only be used together with --direct / -D.');
        process.exit(1);
    }
    
    const cliLanguage = languageArg ? languageArg.split('=')[1] : null;
    const cliTranslation = translationArg ? translationArg.split('=')[1] : null;
    
    if (directMode) {
        console.log('╔════════════════════════════════════════════╗');
        console.log('║  Bible PostgreSQL Direct Database Import  ║');
        console.log('╚════════════════════════════════════════════╝\n');

        // Validate database config
        if (!dbConfig.user || !dbConfig.password) {
            console.error('❌ Missing database credentials. Set DB_USER and DB_PASSWORD in .env file.');
            process.exit(1);
        }

        console.log(`📡 Database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
        console.log(`👤 User: ${dbConfig.user}`);
        console.log(`🔒 SSL: ${dbConfig.ssl ? 'enabled' : 'disabled'}\n`);
    } else {
        console.log('╔════════════════════════════════════════╗');
        console.log('║  Bible PostgreSQL Database Generator  ║');
        console.log('╚════════════════════════════════════════╝\n');

        if (dryRun) {
            console.log('🔍 Running in DRY RUN mode - no files will be written\n');
        }
    }
    
    // Set base directories relative to the script location
    const baseDir = resolve(__dirname, '..');
    const sourceDirectory = join(baseDir, 'sources');
    const formatDirectory = join(baseDir, 'formats');

    let language;
    
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

    // Step 2: Select Translation(s)
    const translationPath = join(sourceDirectory, language);
    const translations = readdirSync(translationPath)
        .filter(d => {
            const fullPath = join(translationPath, d);
            return statSync(fullPath).isDirectory();
        })
        .sort();
    
    let translationsToProcess = [];

    if (directMode && allTranslations) {
        translationsToProcess = translations;
        console.log(`✓ Importing ALL ${translations.length} translations\n`);
    } else if (cliTranslation && translations.includes(cliTranslation)) {
        translationsToProcess = [cliTranslation];
        console.log(`✓ Using translation from CLI: ${cliTranslation}`);
    } else {
        console.log(`📖 Choose your translation for ${language}:`);
        const translation = await listOptions(translations, '\n👉 Enter the number corresponding to your translation: ');
        translationsToProcess = [translation];
        console.log(`\n✓ Selected translation: ${translation}`);
    }

    // Step 3: Generate output
    if (directMode) {
        for (const trans of translationsToProcess) {
            try {
                console.log(`\n${'═'.repeat(50)}`);
                await generateDirect(sourceDirectory, language, trans);
            } catch (error) {
                console.error(`\n❌ Error importing ${trans}:`, error.message);
                if (!allTranslations) {
                    process.exit(1);
                }
            }
        }
        console.log('═'.repeat(50));
        console.log(`\n✅ Import complete! ${translationsToProcess.length} translation(s) processed.\n`);
    } else {
        const trans = translationsToProcess[0];
        try {
            generateDumpFile(sourceDirectory, formatDirectory, language, trans, dryRun);
            
            if (!dryRun) {
                console.log('═══════════════════════════════════════');
                console.log('Next steps:');
                console.log('1. Create your database: createdb bible_db');
                console.log('2. Run the SQL file: psql bible_db < ' + join(formatDirectory, 'psql', `${trans}.sql`));
                console.log('═══════════════════════════════════════\n');
            }
        } catch (error) {
            console.error('\n❌ Error generating SQL:', error.message);
            process.exit(1);
        }
    }
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});