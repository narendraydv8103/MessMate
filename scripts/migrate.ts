import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runMigrations, getPool } from '../src/lib/db';

async function migrate() {
  console.log('📦 Running database migrations...');
  const applied = await runMigrations();
  if (applied.length > 0) {
    console.log(`✅ Applied ${applied.length} migration(s): ${applied.join(', ')}`);
  } else {
    console.log('✅ Database schema is already up to date.');
  }
}

migrate()
  .catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const pool = getPool();
      await pool.end();
    } catch {
      // Ignore if pool was not initialized
    }
  });
