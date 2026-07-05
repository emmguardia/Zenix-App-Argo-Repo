import mysql from 'mysql2/promise';

let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.DB_HOST,
      user:               process.env.DB_USER,
      password:           process.env.DB_PASSWORD,
      database:           process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit:    10,
      timezone:           'Z',
      charset:            'utf8mb4',
    });
  }
  return pool;
}
