/**
 * node scripts/migrate.js
 * Applique migrate.sql sur la base définie par les variables d'env.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = readFileSync(join(__dirname, 'migrate.sql'), 'utf8');

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: true,
});

try {
  console.log('[migrate] Application du schéma...');
  await conn.query(sql);
  console.log('[migrate] ✓ Terminé');
} finally {
  await conn.end();
}
