import fs from 'fs';
import path from 'path';
import { pool } from './pool';
import dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  const client = await pool.connect();
  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id        SERIAL PRIMARY KEY,
        filename  TEXT NOT NULL UNIQUE,
        run_at    TIMESTAMPTZ DEFAULT now()
      )
    `);

    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`[migrate] Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`[migrate] Applying ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );
      console.log(`[migrate] Applied ${file}`);
    }

    console.log('[migrate] All migrations applied successfully');
  } catch (err) {
    console.error('[migrate] Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
