import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import bcrypt from 'bcryptjs';
import { getPool, runMigrations, query } from '../src/lib/db';

const TARGET_MEMBERS = [
  { oldName: 'Aarav', name: 'Sujeet Yadav', avatarColor: '#3b82f6' },
  { oldName: 'Kabir', name: 'Mahendra Singh Yadav', avatarColor: '#10b981' },
  { oldName: 'Rohan', name: 'Neeraj Yadav', avatarColor: '#f59e0b' },
  { oldName: 'Vivaan', name: 'Devansh Tiwari', avatarColor: '#ec4899' },
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

  const rawMessPhone = process.env.MESS_PHONE;
  if (!rawMessPhone || rawMessPhone.trim().length === 0) {
    throw new Error(
      'Missing required environment variable: MESS_PHONE.\n' +
      'Please define MESS_PHONE in your environment or .env.local (e.g. MESS_PHONE=+91XXXXXXXXXX) before running the seed script.'
    );
  }
  const messPhone = rawMessPhone.trim().replace(/\s+/g, '');

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
    await query(
      `UPDATE groups SET mess_name = COALESCE(NULLIF(mess_name, ''), 'Mishra Tiffin Centre') WHERE id = $1`,
      [groupId]
    );
    console.log(`ℹ️ Group already exists: "${existingGroups.rows[0].name}" (${groupId})`);
  } else {
    const groupInsert = await query<{ id: string }>(
      `INSERT INTO groups (name, mess_name, mess_phone, passcode_hash) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      ['MessMate Group', 'Mishra Tiffin Centre', messPhone.trim(), hashedPasscode]
    );
    groupId = groupInsert.rows[0].id;
    console.log(`✅ Created default group: "MessMate Group" (${groupId})`);
    console.log(`   - Mess Name: Mishra Tiffin Centre`);
    console.log(`   - Mess Phone: ${messPhone.trim()}`);
    console.log(`   - Passcode securely hashed and stored.`);
  }

  // 4. Seed 4 roommates (renaming placeholders in-place if they exist, or creating anew)
  for (const m of TARGET_MEMBERS) {
    const existingTarget = await query<{ id: string }>(
      'SELECT id FROM members WHERE group_id = $1 AND name = $2',
      [groupId, m.name]
    );

    if (existingTarget.rows.length > 0) {
      console.log(`ℹ️ Roommate already exists: ${m.name}`);
      continue;
    }

    const existingOld = await query<{ id: string }>(
      'SELECT id FROM members WHERE group_id = $1 AND name = $2',
      [groupId, m.oldName]
    );

    if (existingOld.rows.length > 0) {
      await query(
        'UPDATE members SET name = $1, avatar_color = $2 WHERE id = $3',
        [m.name, m.avatarColor, existingOld.rows[0].id]
      );
      await query(
        'UPDATE decisions SET submitted_by_name = $1 WHERE group_id = $2 AND submitted_by_member_id = $3',
        [m.name, groupId, existingOld.rows[0].id]
      );
      await query(
        'UPDATE call_jobs SET informed_by_name = $1 WHERE group_id = $2 AND informed_by_member_id = $3',
        [m.name, groupId, existingOld.rows[0].id]
      );
      console.log(`🔄 Renamed placeholder "${m.oldName}" -> "${m.name}" in place.`);
    } else {
      await query(
        `INSERT INTO members (group_id, name, avatar_color) 
         VALUES ($1, $2, $3)`,
        [groupId, m.name, m.avatarColor]
      );
      console.log(`✅ Seeded roommate: ${m.name} (${m.avatarColor})`);
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
