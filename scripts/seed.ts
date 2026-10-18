import bcrypt from 'bcryptjs';
import { getPool, runMigrations, query } from '../src/lib/db';

const DEFAULT_MEMBERS = [
  { name: 'Aarav', avatarColor: '#3b82f6' },
  { name: 'Kabir', avatarColor: '#10b981' },
  { name: 'Rohan', avatarColor: '#f59e0b' },
  { name: 'Vivaan', avatarColor: '#ec4899' },
];

async function seed() {
  console.log('🌱 Starting MessMate database seed...');

  // 1. Strict Environment Checks: No defaults or fake numbers allowed!
  const seedPasscode = process.env.SEED_PASSCODE;
  if (!seedPasscode || seedPasscode.trim().length === 0) {
    throw new Error(
      'Missing required environment variable: SEED_PASSCODE.\n' +
      'Please define SEED_PASSCODE in your environment or .env.local before running the seed script.'
    );
  }

  const auntyPhone = process.env.AUNTY_PHONE;
  if (!auntyPhone || auntyPhone.trim().length === 0) {
    throw new Error(
      'Missing required environment variable: AUNTY_PHONE.\n' +
      'Please define AUNTY_PHONE in your environment or .env.local (e.g. AUNTY_PHONE=+91XXXXXXXXXX) before running the seed script.'
    );
  }

  // 2. Initialize schema & versioned migrations
  console.log('📦 Running database migrations...');
  const applied = await runMigrations();
  if (applied.length > 0) {
    console.log(`✅ Applied ${applied.length} migration(s): ${applied.join(', ')}`);
  } else {
    console.log('✅ Database schema is already up to date.');
  }

  // 3. Check or create default group
  const existingGroups = await query('SELECT * FROM groups LIMIT 1');
  let groupId: string;

  const hashedPasscode = await bcrypt.hash(seedPasscode.trim(), 10);

  if (existingGroups.rows.length > 0) {
    groupId = existingGroups.rows[0].id;
    console.log(`ℹ️ Group already exists: "${existingGroups.rows[0].name}" (${groupId})`);
  } else {
    const groupInsert = await query<{ id: string }>(
      `INSERT INTO groups (name, aunty_phone, passcode_hash) 
       VALUES ($1, $2, $3) 
       RETURNING id`,
      ['MessMate Group', auntyPhone.trim(), hashedPasscode]
    );
    groupId = groupInsert.rows[0].id;
    console.log(`✅ Created default group: "MessMate Group" (${groupId})`);
    console.log(`   - Aunty Phone: ${auntyPhone.trim()}`);
    console.log(`   - Passcode securely hashed and stored.`);
  }

  // 4. Seed 4 roommates
  const existingMembers = await query<{ id: string; name: string }>(
    'SELECT id, name FROM members WHERE group_id = $1',
    [groupId]
  );

  const existingNames = new Set(existingMembers.rows.map((m) => m.name));

  for (const m of DEFAULT_MEMBERS) {
    if (!existingNames.has(m.name)) {
      await query(
        `INSERT INTO members (group_id, name, avatar_color) 
         VALUES ($1, $2, $3)`,
        [groupId, m.name, m.avatarColor]
      );
      console.log(`✅ Seeded roommate: ${m.name} (${m.avatarColor})`);
    } else {
      console.log(`ℹ️ Roommate already exists: ${m.name}`);
    }
  }

  console.log('\n🎉 Seed completed successfully!');
  console.log(`Group ID: ${groupId}`);
  console.log('You can now log in as any of the 4 roommates with the group passcode.');
}

seed()
  .catch((err) => {
    console.error('\n❌ Seed failed:', err.message);
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
