// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './client.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, 'schema.sql');
const migrationsDir = join(__dirname, 'migrations');

/**
 * Run database migrations:
 * 1. Execute schema.sql (idempotent — uses IF NOT EXISTS)
 * 2. Execute all migrations/*.sql in alphabetical order
 *
 * Each migration is run inside its own transaction where possible.
 * Migrations use IF NOT EXISTS / IF EXISTS guards for idempotency.
 */
export async function migrate() {
  // Step 1: Run the base schema
  const schemaSql = readFileSync(schemaPath, 'utf-8');
  try {
    await db.query(schemaSql);
    logger.info('Base schema applied');
  } catch (err) {
    if (err.code === '42P07') {
      // 42P07 = duplicate_table — tables already exist
      logger.info('Base tables already exist');
    } else {
      throw err;
    }
  }

  // Step 2: Run migration files in order
  if (existsSync(migrationsDir)) {
    const migrationFiles = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Alphabetical = chronological with numbered prefixes

    for (const file of migrationFiles) {
      const filePath = join(migrationsDir, file);
      const sql = readFileSync(filePath, 'utf-8');
      try {
        await db.query(sql);
        logger.info(`Migration applied: ${file}`);
      } catch (err) {
        // Common idempotency errors we can skip
        if (err.code === '42701') {
          // 42701 = duplicate_column — column already exists
          logger.info(`Migration already applied (column exists): ${file}`);
        } else if (err.code === '42P07') {
          // 42P07 = duplicate_table
          logger.info(`Migration already applied (table exists): ${file}`);
        } else if (err.code === '42710') {
          // 42710 = duplicate_object (index, trigger, etc.)
          logger.info(`Migration already applied (object exists): ${file}`);
        } else {
          logger.error(`Migration failed: ${file}`, { error: err.message, code: err.code });
          throw err;
        }
      }
    }
  }

  logger.info('Database migration complete');
}

// Allow running directly: node src/db/migrate.js
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('migrate.js') ||
  process.argv[1].replace(/\\/g, '/').endsWith('db/migrate.js')
);

if (isDirectRun) {
  migrate()
    .then(() => {
      logger.info('Migration finished successfully');
      return db.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Migration failed', { error: err.message });
      process.exit(1);
    });
}
