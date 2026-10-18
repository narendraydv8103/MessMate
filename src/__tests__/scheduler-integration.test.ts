import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPool, query } from '@/lib/db';
import { runSchedulerTick } from '@/lib/scheduler';
import { submitDecision, DecisionError } from '@/lib/decisions';
import { MockClock } from '@/lib/scheduler/timezone';
import { ReminderType } from '@/types';
import { Notifier, NotificationPayload, NotificationResult } from '@/lib/notify';

const TEST_SCHEMA = 'messmate_scheduler_test_schema';

class TestMockNotifier implements Notifier {
  readonly name = 'test-mock-notifier';
  public dispatched: Array<{ type: ReminderType; payload: NotificationPayload }> = [];

  async notify(
    group: { id: string; name: string },
    type: ReminderType,
    payload: NotificationPayload
  ): Promise<NotificationResult> {
    this.dispatched.push({ type, payload });
    return { status: 'NOT_CONFIGURED', detail: 'Mock notified' };
  }

  reset() {
    this.dispatched = [];
  }
}

describe('Scheduler Engine & Informed Flow Integration (Isolated Schema)', () => {
  let isDbAvailable = false;
  let testGroupId: string;
  let member1Id: string;
  const mockNotifier = new TestMockNotifier();

  beforeAll(async () => {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      isDbAvailable = true;
    } catch {
      console.warn('PostgreSQL database not available for scheduler integration tests; skipping.');
      return;
    }

    // 1. Isolate in dedicated test schema
    await query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`);
    await query(`SET search_path TO ${TEST_SCHEMA}, public;`);

    // 2. Initialize schema tables
    await query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.groups (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          aunty_phone VARCHAR(20) NOT NULL,
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
              CHECK (status IN ('PENDING', 'CANCELLED', 'ACTION_REQUIRED', 'AUNTY_INFORMED', 'NOT_CONFIGURED', 'MISSED')),
          scheduled_for TIMESTAMPTZ NOT NULL,
          action_required_at TIMESTAMPTZ NULL,
          informed_by_member_id UUID NULL REFERENCES ${TEST_SCHEMA}.members(id),
          informed_by_name VARCHAR(100) NULL,
          informed_at TIMESTAMPTZ NULL,
          escalation_count INT NOT NULL DEFAULT 0,
          last_escalated_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT unique_sched_group_meal UNIQUE (group_id, meal_date, meal_period)
      );

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.reminder_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id UUID NOT NULL REFERENCES ${TEST_SCHEMA}.groups(id) ON DELETE CASCADE,
          meal_date DATE NOT NULL,
          meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
          reminder_type VARCHAR(50) NOT NULL,
          sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          send_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED',
          error TEXT NULL,
          CONSTRAINT unique_sched_reminder UNIQUE (group_id, meal_date, meal_period, reminder_type)
      );

      CREATE TABLE IF NOT EXISTS ${TEST_SCHEMA}.scheduler_heartbeat (
          id INT PRIMARY KEY DEFAULT 1,
          last_tick_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const groupRes = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.groups (name, aunty_phone, passcode_hash)
       VALUES ('Scheduler Test Group', '+919999999999', 'fake_hash')
       RETURNING id`
    );
    testGroupId = groupRes.rows[0].id;

    const m1Res = await query<{ id: string }>(
      `INSERT INTO ${TEST_SCHEMA}.members (group_id, name) VALUES ($1, 'Aarav') RETURNING id`,
      [testGroupId]
    );
    member1Id = m1Res.rows[0].id;
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    try {
      await query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`);
    } catch (err) {
      console.error('Error dropping scheduler test schema:', err);
    }
  });

  it('sends reminder once across multiple ticks during reminder window, never after deadline', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    // 8:05 PM (reminder window: 8:00 PM to 9:30 PM)
    const clock = new MockClock('2026-10-19T20:05:00');

    // First tick claims and dispatches
    const tick1 = await runSchedulerTick(clock, mockNotifier);
    expect(tick1.actions.remindersClaimed).toBe(1);
    expect(mockNotifier.dispatched.length).toBe(1);
    expect(mockNotifier.dispatched[0].type).toBe('DAILY_REMINDER');

    // Second tick: already claimed, does not re-send
    const tick2 = await runSchedulerTick(clock, mockNotifier);
    expect(tick2.actions.remindersClaimed).toBe(0);
    expect(mockNotifier.dispatched.length).toBe(1);

    // After deadline (9:35 PM): reminder must NOT be sent
    const clockAfter = new MockClock('2026-10-19T21:35:00');
    const tickAfter = await runSchedulerTick(clockAfter, mockNotifier);
    expect(tickAfter.actions.remindersClaimed).toBe(0);
  });

  it('two concurrent ticks produce exactly one reminder claim and one transition', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    // Reset reminder log for test date
    await query(`DELETE FROM ${TEST_SCHEMA}.reminder_log WHERE meal_date = '2026-10-20'`);
    await query(`DELETE FROM ${TEST_SCHEMA}.call_jobs WHERE meal_date = '2026-10-20'`);

    // Tue 8:15 PM
    const clock = new MockClock('2026-10-20T20:15:00');

    const [t1, t2] = await Promise.all([
      runSchedulerTick(clock, mockNotifier),
      runSchedulerTick(clock, mockNotifier),
    ]);

    const totalClaimed = t1.actions.remindersClaimed + t2.actions.remindersClaimed;
    expect(totalClaimed).toBe(1);
  });

  it('NAHI_JAAYENGE before deadline transitions to ACTION_REQUIRED at deadline, not before', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    const date = '2026-10-21'; // Wednesday
    const clock = new MockClock(`${date}T20:30:00`); // 8:30 PM

    await submitDecision({
      groupId: testGroupId,
      memberId: member1Id,
      memberName: 'Aarav',
      decision: 'NAHI_JAAYENGE',
      idempotencyKey: 'sched-nahi-1',
      clock,
    });

    // Tick before deadline (9:00 PM) -> call_job must stay PENDING
    clock.setTime(`${date}T21:00:00`);
    const tickBefore = await runSchedulerTick(clock, mockNotifier);
    expect(tickBefore.actions.transitionsToActionRequired).toBe(0);

    const jobBeforeRes = await query<{ status: string }>(
      `SELECT status FROM ${TEST_SCHEMA}.call_jobs WHERE group_id = $1 AND meal_date = $2`,
      [testGroupId, date]
    );
    expect(jobBeforeRes.rows[0].status).toBe('PENDING');

    // Tick at deadline (9:30 PM) -> transitions to ACTION_REQUIRED and sends URGENT_INITIAL
    clock.setTime(`${date}T21:30:00`);
    const tickDeadline = await runSchedulerTick(clock, mockNotifier);
    expect(tickDeadline.actions.transitionsToActionRequired).toBe(1);

    const jobAtDeadlineRes = await query<{ status: string }>(
      `SELECT status FROM ${TEST_SCHEMA}.call_jobs WHERE group_id = $1 AND meal_date = $2`,
      [testGroupId, date]
    );
    expect(jobAtDeadlineRes.rows[0].status).toBe('ACTION_REQUIRED');

    // Verify urgent notification was dispatched
    const urgentSent = mockNotifier.dispatched.find((d) => d.type === 'URGENT_INITIAL');
    expect(urgentSent).toBeDefined();
  });

  it('no decision before deadline: row created and transitioned to ACTION_REQUIRED at deadline', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    const date = '2026-10-22'; // Thursday
    // 0 decisions submitted!

    // Tick at deadline (9:30 PM)
    const clock = new MockClock(`${date}T21:30:00`);
    const tickRes = await runSchedulerTick(clock, mockNotifier);

    expect(tickRes.actions.transitionsToActionRequired).toBe(1);

    const jobRes = await query<{ status: string }>(
      `SELECT status FROM ${TEST_SCHEMA}.call_jobs WHERE group_id = $1 AND meal_date = $2`,
      [testGroupId, date]
    );
    expect(jobRes.rows[0].status).toBe('ACTION_REQUIRED');
  });

  it('JAAYENGE: ensures call_job is CANCELLED at deadline and no action is required', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    const date = '2026-10-23'; // Friday
    const clock = new MockClock(`${date}T20:30:00`);

    await submitDecision({
      groupId: testGroupId,
      memberId: member1Id,
      memberName: 'Aarav',
      decision: 'JAAYENGE',
      idempotencyKey: 'sched-jaayenge-1',
      clock,
    });

    // Advance to deadline
    clock.setTime(`${date}T21:30:00`);
    const tickRes = await runSchedulerTick(clock, mockNotifier);

    expect(tickRes.actions.transitionsToActionRequired).toBe(0);

    const jobRes = await query<{ status: string }>(
      `SELECT status FROM ${TEST_SCHEMA}.call_jobs WHERE group_id = $1 AND meal_date = $2`,
      [testGroupId, date]
    );
    expect(jobRes.rows[0].status).toBe('CANCELLED');
  });

  it('escalates at +10/+20/+30 min, capped at 3, no burst on late tick', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    const date = '2026-10-24'; // Saturday
    const clock = new MockClock(`${date}T21:30:00`);

    // Deadline tick sets ACTION_REQUIRED
    await runSchedulerTick(clock, mockNotifier);
    mockNotifier.reset();

    // Advance to +10 min (9:40 PM) -> Escalation 1
    clock.setTime(`${date}T21:40:00`);
    const tick10 = await runSchedulerTick(clock, mockNotifier);
    expect(tick10.actions.escalationsClaimed).toBe(1);
    expect(mockNotifier.dispatched[0].type).toBe('URGENT_ESCALATION_1');

    // Advance to +20 min (9:50 PM) -> Escalation 2
    clock.setTime(`${date}T21:50:00`);
    const tick20 = await runSchedulerTick(clock, mockNotifier);
    expect(tick20.actions.escalationsClaimed).toBe(1);
    expect(mockNotifier.dispatched[1].type).toBe('URGENT_ESCALATION_2');

    // Advance directly to +45 min (late tick!) -> Sends ONLY Escalation 3, never a burst!
    clock.setTime(`${date}T22:15:00`);
    const tick45 = await runSchedulerTick(clock, mockNotifier);
    expect(tick45.actions.escalationsClaimed).toBe(1);
    expect(mockNotifier.dispatched[2].type).toBe('URGENT_ESCALATION_3');

    // Advance further to +60 min -> Capped at 3, no more escalations sent
    clock.setTime(`${date}T22:30:00`);
    const tick60 = await runSchedulerTick(clock, mockNotifier);
    expect(tick60.actions.escalationsClaimed).toBe(0);
    expect(mockNotifier.dispatched.length).toBe(3);
  });

  it('missed cutoff: if now > deadline + 2 hours, sets MISSED and sends NO notification', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    const yesterdayDate = '2026-10-26'; // Monday (deadline was Monday 9:30 PM)
    // Cron was completely down on Monday night!
    // Now it's Tuesday 2:00 AM (> deadline + 2 hours)
    const clockTuesdayMorning = new MockClock('2026-10-27T02:00:00');

    const tickRes = await runSchedulerTick(clockTuesdayMorning, mockNotifier);

    expect(tickRes.actions.finalizedMissedDays).toBeGreaterThanOrEqual(1);
    expect(tickRes.actions.transitionsToMissed).toBeGreaterThanOrEqual(1);
    // Crucial: NO notification sent!
    expect(mockNotifier.dispatched.length).toBe(0);

    const yesterdayJob = await query<{ status: string }>(
      `SELECT status FROM ${TEST_SCHEMA}.call_jobs WHERE group_id = $1 AND meal_date = $2`,
      [testGroupId, yesterdayDate]
    );
    expect(yesterdayJob.rows[0].status).toBe('MISSED');
  });

  it('no escalations happen if now >= deadline + 2 hours', async () => {
    if (!isDbAvailable) return;
    mockNotifier.reset();

    const testDate = '2026-10-25'; // Sunday
    // Insert an existing ACTION_REQUIRED job with action_required_at 9:30 PM
    await query(
      `INSERT INTO ${TEST_SCHEMA}.call_jobs (group_id, meal_date, meal_period, status, scheduled_for, action_required_at)
       VALUES ($1, $2, 'DINNER', 'ACTION_REQUIRED', '2026-10-25T21:30:00+05:30', '2026-10-25T21:30:00+05:30')
       ON CONFLICT (group_id, meal_date, meal_period) DO NOTHING`,
      [testGroupId, testDate]
    );

    // Now it is 11:35 PM (which is > 9:30 PM + 2 hours)
    const clockLate = new MockClock('2026-10-25T23:35:00');
    const tickRes = await runSchedulerTick(clockLate, mockNotifier);

    // Escalations must NOT be claimed or dispatched
    expect(tickRes.actions.escalationsClaimed).toBe(0);
    expect(tickRes.actions.escalationsDispatched).toBe(0);
    expect(mockNotifier.dispatched.length).toBe(0);
  });

  it('rejects decisions once status is ACTION_REQUIRED or MISSED', async () => {
    if (!isDbAvailable) return;

    // Try submitting decision for yesterday's meal which is MISSED
    const clock = new MockClock('2026-10-27T02:05:00');

    await expect(
      submitDecision({
        groupId: testGroupId,
        memberId: member1Id,
        memberName: 'Aarav',
        decision: 'JAAYENGE',
        idempotencyKey: 'try-after-action-req',
        clock,
      })
    ).rejects.toThrowError(DecisionError);
  });
});
