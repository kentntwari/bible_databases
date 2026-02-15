import pg from 'pg';
import dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSLMODE === 'require' ? { rejectUnauthorized: false } : false,
};

/**
 * Prompt user for input
 */
function prompt(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * List all translations in database
 */
async function listTranslations(client) {
    const result = await client.query('SELECT code, name FROM translation ORDER BY code');
    return result.rows;
}

async function deleteTranslation(client, code) {
    // Check if translation exists
    const check = await client.query('SELECT id, name FROM translation WHERE code = $1', [code]);
    if (check.rowCount === 0) {
        console.log(`❌ Translation '${code}' not found in database`);
        return false;
    }
    
    console.log(`📖 Found: ${check.rows[0].name}`);
    
    // Delete (cascades to books, chapters, verses)
    const result = await client.query('DELETE FROM translation WHERE code = $1', [code]);
    console.log(`✅ Deleted '${code}' (${result.rowCount} translation removed, cascaded to all related data)\n`);
    return true;
}

async function main() {
    const client = new pg.Client(dbConfig);
    
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  Bible Translation Delete Utility          ║');
    console.log('╚════════════════════════════════════════════╝\n');
    
    try {
        await client.connect();
        console.log('🔌 Connected to database\n');
        
        // Check for CLI arguments first
        const cliCodes = process.argv.slice(2);
        
        if (cliCodes.length > 0) {
            // Use CLI arguments
            for (const code of cliCodes) {
                await deleteTranslation(client, code);
            }
        } else {
            // Interactive mode
            const translations = await listTranslations(client);
            
            if (translations.length === 0) {
                console.log('📭 No translations found in database.');
                return;
            }
            
            console.log('📚 Available translations:\n');
            translations.forEach((t, i) => {
                console.log(`  ${i + 1}. ${t.code} - ${t.name}`);
            });
            
            console.log('\n💡 Enter numbers separated by commas to delete multiple (e.g., 1,3,5)');
            console.log('   Or enter "q" to quit\n');
            
            const answer = await prompt('👉 Enter selection: ');
            
            if (answer.toLowerCase() === 'q') {
                console.log('👋 Cancelled.');
                return;
            }
            
            const selections = answer.split(',').map(s => parseInt(s.trim()) - 1);
            const validSelections = selections.filter(i => i >= 0 && i < translations.length);
            
            if (validSelections.length === 0) {
                console.log('❌ No valid selections.');
                return;
            }
            
            const toDelete = validSelections.map(i => translations[i]);
            
            console.log('\n⚠️  You are about to delete:');
            toDelete.forEach(t => console.log(`   - ${t.code}: ${t.name}`));
            
            const confirm = await prompt('\n🗑️  Confirm deletion? (yes/no): ');
            
            if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
                console.log('👋 Cancelled.');
                return;
            }
            
            console.log('');
            for (const t of toDelete) {
                await deleteTranslation(client, t.code);
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await client.end();
        console.log('🔌 Database connection closed.');
    }
}

main();
