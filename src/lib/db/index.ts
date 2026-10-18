import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import fs from 'fs';
import path from 'path';

declare global {
  var __messmate_pg_pool: Pool | undefined;
}

/**
 * Returns a connection pool configured for Supabase & Neon.
 * - SSL enabled for cloud databases.
 * - Small max connections (1-3) in production to respect serverless limits.
 * - No named prepared statements (compatible with Supabase transaction pooler).
 */
export function getPool(): Pool {
  if (globalThis.__messmate_pg_pool) {
    return globalThis.__messmate_pg_pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const isProduction = process.env.NODE_ENV === 'production';

  const pool = new Pool({
    connectionString,
    // Small pool size in production for serverless instances
    max: isProduction ? 3 : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Supabase requires SSL with rejectUnauthorized: false for pooled endpoints
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });

  if (!isProduction) {
    globalThis.__messmate_pg_pool = pool;
  }

  return pool;
}

/**
 * Executes a single parameterized query against the pool.
 * Note: Never uses named prepared statements for Supabase transaction pooler compatibility.
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R>> {
  const pool = getPool();
  return pool.query<R>(text, params);
}

/**
 * Executes a series of operations inside a single, stateful PostgreSQL transaction.
 *
 * CRITICAL FOR SUPABASE TRANSACTION POOLER:
 * In Supabase's transaction pooler (port 6543), connections are scoped per-transaction.
 * All locking operations (`pg_try_advisory_xact_lock`, `SELECT ... FOR UPDATE`)
 * must take place on the single checked-out client strictly between `BEGIN` and `COMMIT`.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Error rolling back transaction:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs versioned SQL migrations from the migrations folder in sequence.
 * Tracks applied migrations in the schema_migrations table.
 */
export async function runMigrations(): Promise<string[]> {
  const migrationsDir = path.resolve(import.meta.dirname, 'migrations');

  // 1. Ensure migrations tracking table exists
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Read all .sql files
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // 3. Fetch already applied migrations
  const appliedResult = await query<{ name: string }>(
    'SELECT name FROM schema_migrations'
  );
  const appliedSet = new Set(appliedResult.rows.map((r) => r.name));

  const newlyApplied: string[] = [];

  // 4. Apply pending migrations sequentially in transactions
  for (const file of files) {
    if (!appliedSet.has(file)) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [file]
        );
      });

      newlyApplied.push(file);
      console.log(`Applied migration: ${file}`);
    }
  }

  return newlyApplied;
}

/**
 * Backward compatibility alias for runMigrations.
 */
export async function initSchema(): Promise<void> {
  await runMigrations();
}
