/**
 * node scripts/migrate.js
 * Applique tous les scripts/migrate*.sql (triés) sur la base des variables d'env.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(__dirname).filter((f) => /^migrate.*\.sql$/.test(f)).sort();

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

try {
  for (const file of files) {
    console.log(`[migrate] ${file}...`);
    await conn.query(readFileSync(join(__dirname, file), 'utf8'));
  }
  console.log('[migrate] ✓ Terminé');
} finally {
  await conn.end();
}
