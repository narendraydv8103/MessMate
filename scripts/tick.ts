import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { runSchedulerTick } from '../src/lib/scheduler';
import { SystemClock } from '../src/lib/scheduler/timezone';
import { getPool } from '../src/lib/db';

async function main() {
  console.log('⏰ Running local scheduler tick...');
  const clock = new SystemClock();

  try {
    const summary = await runSchedulerTick(clock);
    console.log('✅ Tick completed successfully:');
    console.dir(summary, { depth: null });
  } catch (err) {
    console.error('❌ Scheduler tick failed:', err);
    process.exit(1);
  } finally {
    try {
      const pool = getPool();
      await pool.end();
    } catch {
      // Ignore if pool was already closed
    }
  }
}

main();
