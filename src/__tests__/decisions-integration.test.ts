import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, query } from '@/lib/db';
import { submitDecision, getCurrentMealStatus, getDecisionHistory, DecisionError } from '@/lib/decisions';
import { MockClock } from '@/lib/scheduler/timezone';

const TEST_SCHEMA = 'messmate_test_schema';

describe('Decisions DB Service & Rules Integration (Isolated Schema)', () => {
  let isDbAvailable = false;
  let testGroupId: string;
  let member1Id: string;
  let member2Id: string;

  beforeAll(async () => {
    try {
      const pool = getPool();
      const testConn = await pool.query('SELECT 1');
      if (testConn) {
        isDbAvailable = true;
      }
    } catch {
      console.warn('PostgreSQL database not available for live integration test; skipping DB test.');
      return;
    }

    // 1. Create and isolate in a separate test schema so real group data is NEVER touched!
    await query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`);
    await query(`SET search_path TO ${TEST_SCHEMA}, public;`);

    // 2. Initialize schema tables inside the test schema
    await query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.groups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          mess_phone VARCHAR(20) NOT NULL,
          passcode_hash VARCHAR(255) NOT NULL,
          timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
          settings JSONB NOT NULL DEFAULT '{"notifications_enabled": true, "urgent_escalation_interval_min": 10}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.groups(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          avatar_color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
          notification_preferences JSONB NOT NULL DEFAULT '{"push_enabled": true, "reminders": true}'::jsonb,
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

      CREATE INDEX IF NOT EXISTS idx_decisions_test_latest 
      ON ${TEST_SCHEMA}.decisions(group_id, meal_date, meal_period, seq DESC);

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
          CONSTRAINT unique_test_group_meal UNIQUE (group_id, meal_date, meal_period)
      );
    `);

    // 3. Insert test group and test members
    const groupRes = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.groups (name, mess_phone, passcode_hash)
       VALUES ('Test Group', '+919999999999', 'fake_hash')
       RETURNING id`
    );
    testGroupId = groupRes.rows[0].id;

    const m1Res = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.members (group_id, name) VALUES ($1, 'Roommate 1') RETURNING id`,
      [testGroupId]
    );
    member1Id = m1Res.rows[0].id;

    const m2Res = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.members (group_id, name) VALUES ($1, 'Roommate 2') RETURNING id`,
      [testGroupId]
    );
    member2Id = m2Res.rows[0].id;
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    try {
      // Cleanly teardown test schema
      await query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`);
    } catch (err) {
      console.error('Error cleaning up test schema:', err);
    }
  });

  it('submitting NAHI_JAAYENGE creates pending call_job and returns "Call Scheduled"', async () => {
    if (!isDbAvailable) return;

    // Mon 8:30 PM (before 9:30 PM deadline)
    const clock = new MockClock('2026-10-19T20:30:00');

    const result = await submitDecision({
      groupId: testGroupId,
      memberId: member1Id,
      memberName: 'Roommate 1',
      decision: 'NAHI_JAAYENGE',
      idempotencyKey: 'idemp-1',
      clock,
    });

    expect(result.success).toBe(true);
    expect(result.decision.decision).toBe('NAHI_JAAYENGE');
    expect(result.callJob.status).toBe('PENDING');
    expect(result.statusLabel).toBe('Call Scheduled');
  });

  it('decision flip: submitting JAAYENGE cancels the call_job and returns "Decision Saved"', async () => {
    if (!isDbAvailable) return;

    const clock = new MockClock('2026-10-19T20:45:00');

    // Roommate 2 flips decision to JAAYENGE
    const result = await submitDecision({
      groupId: testGroupId,
      memberId: member2Id,
      memberName: 'Roommate 2',
      decision: 'JAAYENGE',
      idempotencyKey: 'idemp-2',
      clock,
    });

    expect(result.success).toBe(true);
    expect(result.decision.decision).toBe('JAAYENGE');
    expect(result.callJob.status).toBe('CANCELLED');
    expect(result.statusLabel).toBe('Decision Saved');
  });

  it('decision flip back: submitting NAHI_JAAYENGE again recreates PENDING call_job', async () => {
    if (!isDbAvailable) return;

    const clock = new MockClock('2026-10-19T21:00:00');

    const result = await submitDecision({
      groupId: testGroupId,
      memberId: member1Id,
      memberName: 'Roommate 1',
      decision: 'NAHI_JAAYENGE',
      idempotencyKey: 'idemp-3',
      clock,
    });

    expect(result.success).toBe(true);
    expect(result.decision.decision).toBe('NAHI_JAAYENGE');
    expect(result.callJob.status).toBe('PENDING');
    expect(result.statusLabel).toBe('Call Scheduled');
  });

  it('duplicate idempotency_key returns original result without adding a duplicate row', async () => {
    if (!isDbAvailable) return;

    const clock = new MockClock('2026-10-19T21:05:00');

    // Submit with existing idemp-3
    const duplicate = await submitDecision({
      groupId: testGroupId,
      memberId: member1Id,
      memberName: 'Roommate 1',
      decision: 'NAHI_JAAYENGE',
      idempotencyKey: 'idemp-3',
      clock,
    });

    expect(duplicate.success).toBe(true);
    expect(duplicate.isDuplicateSubmission).toBe(true);
    expect(duplicate.decision.idempotencyKey).toBe('idemp-3');

    // Verify row count in decisions table for idemp-3 is strictly 1
    const countRes = await query<{ count: string }>(
      `SELECT count(*) FROM ${TEST_SCHEMA}.decisions WHERE idempotency_key = 'idemp-3'`
    );
    expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
  });

  it('deadline race: accepted 1 second before deadline, rejected at deadline with 422', async () => {
    if (!isDbAvailable) return;

    // 1 second before deadline (9:29:59 PM IST)
    const clockBefore = new MockClock('2026-10-19T21:29:59');

    const resBefore = await submitDecision({
      groupId: testGroupId,
      memberId: member1Id,
      memberName: 'Roommate 1',
      decision: 'JAAYENGE',
      idempotencyKey: 'idemp-race-1',
      clock: clockBefore,
    });
    expect(resBefore.success).toBe(true);

    // Exactly at deadline (9:30:00 PM IST) -> Must be rejected!
    const clockAtDeadline = new MockClock('2026-10-19T21:30:00');

    await expect(
      submitDecision({
        groupId: testGroupId,
        memberId: member1Id,
        memberName: 'Roommate 1',
        decision: 'NAHI_JAAYENGE',
        idempotencyKey: 'idemp-race-2',
        clock: clockAtDeadline,
      })
    ).rejects.toThrowError(DecisionError);

    // After deadline (9:30:05 PM IST) -> Must be rejected with 422!
    const clockAfter = new MockClock('2026-10-19T21:30:05');

    try {
      await submitDecision({
        groupId: testGroupId,
        memberId: member1Id,
        memberName: 'Roommate 1',
        decision: 'NAHI_JAAYENGE',
        idempotencyKey: 'idemp-race-3',
        clock: clockAfter,
      });
      expect.fail('Expected DecisionError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DecisionError);
      expect((err as DecisionError).statusCode).toBe(422);
      expect((err as DecisionError).message).toContain('Deadline of 09:30 PM IST has passed');
    }
  });

  it('rejects decisions if call_job is already in ACTION_REQUIRED or MESS_INFORMED', async () => {
    if (!isDbAvailable) return;

    // Simulate Sunday meal (2026-10-25)
    const clock = new MockClock('2026-10-25T13:00:00'); // 1:00 PM (before 2:00 PM deadline)

    // Manually set call_job to ACTION_REQUIRED in test schema
    await query(
      `INSERT INTO ${TEST_SCHEMA}.call_jobs (group_id, meal_date, meal_period, status, scheduled_for)
       VALUES ($1, '2026-10-25', 'LUNCH', 'ACTION_REQUIRED', '2026-10-25T14:00:00Z')
       ON CONFLICT (group_id, meal_date, meal_period) DO UPDATE SET status = 'ACTION_REQUIRED'`,
      [testGroupId]
    );

    await expect(
      submitDecision({
        groupId: testGroupId,
        memberId: member1Id,
        memberName: 'Roommate 1',
        decision: 'JAAYENGE',
        idempotencyKey: 'idemp-action-req',
        clock,
      })
    ).rejects.toThrowError('Decisions are closed for this meal period because action was already initiated or the mess was informed.');
  });

  it('getCurrentMealStatus returns accurate active status and prefilled URLs', async () => {
    if (!isDbAvailable) return;

    const clock = new MockClock('2026-10-19T18:00:00');
    const status = await getCurrentMealStatus(testGroupId, clock);

    expect(status.mealDate).toBe('2026-10-19');
    expect(status.mealPeriod).toBe('DINNER');
    expect(status.messPhone).toBe('+919999999999');
    expect(status.whatsappUrl).toContain('wa.me');
    expect(status.telUrl).toBe('tel:+919999999999');
  });

  it('getDecisionHistory returns chronological audit log', async () => {
    if (!isDbAvailable) return;

    const history = await getDecisionHistory(testGroupId);
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].seq).toBeDefined();
  });
});
