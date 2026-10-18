import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, query } from '@/lib/db';
import { submitDecision } from '@/lib/decisions';
import { MockClock } from '@/lib/scheduler/timezone';

const TEST_SCHEMA = 'messmate_concurrency_test_schema';

describe('Concurrent Decisions via Promise.all (Advisory Locking)', () => {
  let isDbAvailable = false;
  let testGroupId: string;
  let member1Id: string;
  let member2Id: string;

  beforeAll(async () => {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      isDbAvailable = true;
    } catch {
      console.warn('PostgreSQL database not available for concurrency test; skipping DB test.');
      return;
    }

    // Isolate in separate test schema
    await query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`);
    await query(`SET search_path TO ${TEST_SCHEMA}, public;`);

    // Create schema tables inside the isolated test schema
    await query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.groups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          mess_phone VARCHAR(20) NOT NULL,
          passcode_hash VARCHAR(255) NOT NULL,
          timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
          settings JSONB NOT NULL DEFAULT '{"notifications_enabled": true}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.groups(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          avatar_color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
          notification_preferences JSONB NOT NULL DEFAULT '{"push_enabled": true}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.decisions (
          seq BIGSERIAL PRIMARY KEY,
          id UUID NOT NULL DEFAULT gen_random_uuid(),
          idempotency_key VARCHAR(100) NOT NULL UNIQUE,
          group_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.groups(id) ON DELETE CASCADE,
          meal_date DATE NOT NULL,
          meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
          decision VARCHAR(20) NOT NULL CHECK (decision IN ('JAAYENGE', 'NAHI_JAAYENGE')),
          submitted_by_member_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.members(id),
          submitted_by_name VARCHAR(100) NOT NULL,
          notes TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.call_jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.groups(id) ON DELETE CASCADE,
          meal_date DATE NOT NULL,
          meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
          status VARCHAR(30) NOT NULL DEFAULT 'PENDING' 
              CHECK (status IN ('PENDING', 'CANCELLED', 'ACTION_REQUIRED', 'MESS_INFORMED', 'NOT_CONFIGURED')),
          scheduled_for TIMESTAMPTZ NOT NULL,
          action_required_at TIMESTAMPTZ NULL,
          informed_by_member_id UUID NULL REFERENCES ${TEST_SCHEMA}.members(id),
          informed_by_name VARCHAR(100) NULL,
          informed_at TIMESTAMPTZ NULL,
          escalation_count INT NOT NULL DEFAULT 0,
          last_escalated_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT unique_concurrency_group_meal UNIQUE (group_id, meal_date, meal_period)
      );
    `);

    const groupRes = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.groups (name, mess_phone, passcode_hash)
       VALUES ('Concurrency Test Group', '+919999999999', 'fake_hash')
       RETURNING id`
    );
    testGroupId = groupRes.rows[0].id;

    const m1Res = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.members (group_id, name) VALUES ($1, 'Aarav') RETURNING id`,
      [testGroupId]
    );
    member1Id = m1Res.rows[0].id;

    const m2Res = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.members (group_id, name) VALUES ($1, 'Kabir') RETURNING id`,
      [testGroupId]
    );
    member2Id = m2Res.rows[0].id;
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    try {
      await query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`);
    } catch (err) {
      console.error('Error dropping concurrency test schema:', err);
    }
  });

  it('two simultaneous decisions via Promise.all ensure call_jobs status matches decision with highest seq', async () => {
    if (!isDbAvailable) return;

    // Mon 8:45 PM (before 9:30 PM deadline)
    const clock = new MockClock('2026-10-19T20:45:00');

    // Launch both simultaneously
    const [res1, res2] = await Promise.all([
      submitDecision({
        groupId: testGroupId,
        memberId: member1Id,
        memberName: 'Aarav',
        decision: 'NAHI_JAAYENGE',
        idempotencyKey: 'concurrent-nahi',
        clock,
      }),
      submitDecision({
        groupId: testGroupId,
        memberId: member2Id,
        memberName: 'Kabir',
        decision: 'JAAYENGE',
        idempotencyKey: 'concurrent-jaayenge',
        clock,
      }),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);

    // Query highest seq decision from DB
    const latestDecisionRes = await query<{ seq: string; decision: string }>(
      `SELECT seq, decision FROM ${TEST_SCHEMA}.decisions 
       WHERE group_id = $1 AND meal_date = '2026-10-19' AND meal_period = 'DINNER' 
       ORDER BY seq DESC LIMIT 1`,
      [testGroupId]
    );
    const highestDecision = latestDecisionRes.rows[0];

    // Query actual call_jobs row in DB
    const callJobRes = await query<{ status: string }>(
      `SELECT status FROM ${TEST_SCHEMA}.call_jobs 
       WHERE group_id = $1 AND meal_date = '2026-10-19' AND meal_period = 'DINNER'`,
      [testGroupId]
    );
    const finalJob = callJobRes.rows[0];

    // Verify consistency:
    if (highestDecision.decision === 'JAAYENGE') {
      expect(finalJob.status).toBe('CANCELLED');
    } else {
      expect(finalJob.status).toBe('PENDING');
    }
  });
});
