import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'bible_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSLMODE === 'require' ? { rejectUnauthorized: false } : false,
};

/**
 * Escape strings for SQL
 */
function escapeString(text) {
    if (text === null || text === undefined) return 'NULL';
    return text.replace(/'/g, "''");
}

/**
 * Generate SQL file for cross references
 */
function generateSQLFile(jsonPath, sqlDir) {
    const content = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(content);
    const fileName = jsonPath.split(/[/\\]/).pop().replace('.json', '.sql');
    const sqlPath = join(sqlDir, fileName);
    
    let sqlContent = '-- SQL Dump for Cross References\n';
    sqlContent += `-- Generated: ${new Date().toISOString()}\n\n`;
    
    // Create table
    sqlContent += `CREATE TABLE IF NOT EXISTS cross_references (
    id SERIAL PRIMARY KEY,
    from_book VARCHAR(255),
    from_chapter INTEGER,
    from_verse INTEGER,
    to_book VARCHAR(255),
    to_chapter INTEGER,
    to_verse_start INTEGER,
    to_verse_end INTEGER,
    votes INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cross_references_from_book ON cross_references(from_book);
CREATE INDEX IF NOT EXISTS idx_cross_references_to_book ON cross_references(to_book);

`;
    
    // Insert data
    for (const ref of data.cross_references) {
        const fromVerse = ref.from_verse;
        for (const toVerse of ref.to_verse) {
            sqlContent += `INSERT INTO cross_references (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end, votes)
VALUES ('${escapeString(fromVerse.book)}', ${fromVerse.chapter}, ${fromVerse.verse}, '${escapeString(toVerse.book)}', ${toVerse.chapter}, ${toVerse.verse_start}, ${toVerse.verse_end}, ${ref.votes});\n`;
        }
    }
    
    writeFileSync(sqlPath, sqlContent, 'utf-8');
    console.log(`✅ SQL dump generated: ${sqlPath}`);
}

/**
 * Insert cross references directly into database
 */
async function insertCrossReferences(jsonPath, client) {
    const content = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(content);
    const fileName = jsonPath.split(/[/\\]/).pop();
    
    console.log(`📝 Processing ${fileName}...`);
    
    let insertCount = 0;
    const batchSize = 100;
    let values = [];
    let params = [];
    let paramIndex = 1;
    
    for (const ref of data.cross_references) {
        const fromVerse = ref.from_verse;
        for (const toVerse of ref.to_verse) {
            values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`);
            params.push(
                fromVerse.book, fromVerse.chapter, fromVerse.verse,
                toVerse.book, toVerse.chapter, toVerse.verse_start, toVerse.verse_end,
                ref.votes
            );
            paramIndex += 8;
            insertCount++;
            
            // Batch insert every 100 rows
            if (values.length >= batchSize) {
                await client.query(
                    `INSERT INTO cross_references (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end, votes) VALUES ${values.join(', ')}`,
                    params
                );
                values = [];
                params = [];
                paramIndex = 1;
                process.stdout.write(`\r   Inserted: ${insertCount} references`);
            }
        }
    }
    
    // Insert remaining rows
    if (values.length > 0) {
        await client.query(
            `INSERT INTO cross_references (from_book, from_chapter, from_verse, to_book, to_chapter, to_verse_start, to_verse_end, votes) VALUES ${values.join(', ')}`,
            params
        );
    }
    
    console.log(`\r   Inserted: ${insertCount} references ✓`);
    return insertCount;
}

async function main() {
    const args = process.argv.slice(2);
    const execute = args.includes('--execute') || args.includes('-e');
    const generateOnly = args.includes('--generate') || args.includes('-g');
    
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  Cross References Generator (PostgreSQL)   ║');
    console.log('╚════════════════════════════════════════════╝\n');
    
    const baseDir = join(__dirname, '..');
    const sourceDir = join(baseDir, 'sources', 'extras');
    const sqlDir = join(baseDir, 'formats', 'psql', 'extras');
    
    // Ensure output directory exists
    if (!existsSync(sqlDir)) {
        mkdirSync(sqlDir, { recursive: true });
    }
    
    // Find all cross reference JSON files
    const crossRefFiles = readdirSync(sourceDir)
        .filter(f => f.startsWith('cross_references') && f.endsWith('.json'))
        .map(f => join(sourceDir, f));
    
    console.log(`📁 Found ${crossRefFiles.length} cross reference file(s)\n`);
    
    if (execute) {
        // Direct database insertion
        if (!dbConfig.user || !dbConfig.password) {
            console.error('❌ Missing database credentials. Set DB_USER and DB_PASSWORD in .env file.');
            process.exit(1);
        }
        
        console.log(`📡 Database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
        console.log(`👤 User: ${dbConfig.user}`);
        console.log(`🔒 SSL: ${dbConfig.ssl ? 'enabled' : 'disabled'}\n`);
        
        const client = new pg.Client(dbConfig);
        
        try {
            await client.connect();
            console.log('✅ Connected to PostgreSQL database\n');
            
            await client.query('BEGIN');
            
            // Create table
            await client.query(`
                CREATE TABLE IF NOT EXISTS cross_references (
                    id SERIAL PRIMARY KEY,
                    from_book VARCHAR(255),
                    from_chapter INTEGER,
                    from_verse INTEGER,
                    to_book VARCHAR(255),
                    to_chapter INTEGER,
                    to_verse_start INTEGER,
                    to_verse_end INTEGER,
                    votes INTEGER
                )
            `);
            
            // Create indexes
            await client.query('CREATE INDEX IF NOT EXISTS idx_cross_references_from_book ON cross_references(from_book)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_cross_references_to_book ON cross_references(to_book)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_cross_references_from ON cross_references(from_book, from_chapter, from_verse)');
            await client.query('CREATE INDEX IF NOT EXISTS idx_cross_references_to ON cross_references(to_book, to_chapter, to_verse_start)');
            
            let totalInserted = 0;
            for (const file of crossRefFiles) {
                totalInserted += await insertCrossReferences(file, client);
            }
            
            await client.query('COMMIT');
            
            console.log(`\n✅ Import complete! Total cross references: ${totalInserted.toLocaleString()}`);
            
        } catch (error) {
            console.error('\n❌ Error:', error.message);
            try { await client.query('ROLLBACK'); } catch (e) {}
            process.exit(1);
        } finally {
            await client.end();
            console.log('🔌 Database connection closed.');
        }
        
    } else {
        // Generate SQL files
        console.log('📝 Generating SQL files...\n');
        
        for (const file of crossRefFiles) {
            generateSQLFile(file, sqlDir);
        }
        
        console.log(`\n✅ SQL files generated in: ${sqlDir}`);
        console.log('\n💡 Tip: Use --execute (-e) to insert directly into database');
    }
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
