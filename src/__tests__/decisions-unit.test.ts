import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dbModule from '@/lib/db';
import { PoolClient } from 'pg';
import { submitDecision, DecisionError } from '@/lib/decisions';
import { MockClock } from '@/lib/scheduler/timezone';

describe('Decisions Unit Rules & Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock withTransaction for unit tests so they execute without requiring a live Postgres instance
    vi.spyOn(dbModule, 'withTransaction').mockImplementation(async (cb) => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as PoolClient;
      return cb(mockClient);
    });
  });

  it('throws 400 when idempotencyKey is missing or blank', async () => {
    await expect(
      submitDecision({
        groupId: 'grp-1',
        memberId: 'mem-1',
        memberName: 'Aarav',
        decision: 'JAAYENGE',
        idempotencyKey: '',
      })
    ).rejects.toThrowError('idempotency_key is required.');
  });

  it('throws 400 when decision string is invalid', async () => {
    await expect(
      submitDecision({
        groupId: 'grp-1',
        memberId: 'mem-1',
        memberName: 'Aarav',
        // @ts-expect-error Testing runtime validation for invalid decision input
        decision: 'MAYBE',
        idempotencyKey: 'key-1',
      })
    ).rejects.toThrowError('Invalid decision. Must be JAAYENGE or NAHI_JAAYENGE.');
  });

  it('strictly rejects decision at Mon-Sat 9:30:00 PM deadline with 422', async () => {
    // 2026-10-19 is a Monday. Exactly at 21:30:00
    const clock = new MockClock('2026-10-19T21:30:00');

    try {
      await submitDecision({
        groupId: 'grp-1',
        memberId: 'mem-1',
        memberName: 'Aarav',
        decision: 'NAHI_JAAYENGE',
        idempotencyKey: 'deadline-test-1',
        clock,
      });
      expect.fail('Should have thrown DecisionError');
    } catch (err) {
      expect(err).toBeInstanceOf(DecisionError);
      expect((err as DecisionError).statusCode).toBe(422);
      expect((err as DecisionError).message).toContain('Deadline of 09:30 PM IST has passed for DINNER');
    }
  });

  it('strictly rejects decision at Sunday 2:00:00 PM deadline with 422', async () => {
    // 2026-10-25 is a Sunday. Exactly at 14:00:00
    const clock = new MockClock('2026-10-25T14:00:00');

    try {
      await submitDecision({
        groupId: 'grp-1',
        memberId: 'mem-1',
        memberName: 'Aarav',
        decision: 'JAAYENGE',
        idempotencyKey: 'sunday-deadline-test',
        clock,
      });
      expect.fail('Should have thrown DecisionError');
    } catch (err) {
      expect(err).toBeInstanceOf(DecisionError);
      expect((err as DecisionError).statusCode).toBe(422);
      expect((err as DecisionError).message).toContain('Deadline of 02:00 PM IST has passed for LUNCH');
    }
  });

  it('strictly rejects decision after deadline has passed with 422', async () => {
    const clock = new MockClock('2026-10-19T22:15:00'); // 10:15 PM

    try {
      await submitDecision({
        groupId: 'grp-1',
        memberId: 'mem-1',
        memberName: 'Aarav',
        decision: 'JAAYENGE',
        idempotencyKey: 'after-deadline-test',
        clock,
      });
      expect.fail('Should have thrown DecisionError');
    } catch (err) {
      expect(err).toBeInstanceOf(DecisionError);
      expect((err as DecisionError).statusCode).toBe(422);
      expect((err as DecisionError).message).toContain('Decisions are closed');
    }
  });

  it('returns existing decision for duplicate idempotencyKey even after deadline', async () => {
    const clock = new MockClock('2026-10-19T23:00:00'); // Well after 9:30 PM deadline!

    const existingDecisionRow = {
      seq: 12,
      id: 'dec-12',
      idempotency_key: 'prior-key',
      group_id: 'grp-1',
      meal_date: '2026-10-19',
      meal_period: 'DINNER',
      decision: 'NAHI_JAAYENGE',
      submitted_by_member_id: 'mem-1',
      submitted_by_name: 'Aarav',
      notes: null,
      created_at: new Date('2026-10-19T20:00:00Z'),
    };

    const existingJobRow = {
      id: 'job-1',
      group_id: 'grp-1',
      meal_date: '2026-10-19',
      meal_period: 'DINNER',
      status: 'ACTION_REQUIRED',
      scheduled_for: new Date('2026-10-19T21:30:00Z'),
      action_required_at: new Date('2026-10-19T21:30:00Z'),
      escalation_count: 0,
      created_at: new Date('2026-10-19T20:00:00Z'),
      updated_at: new Date('2026-10-19T21:30:00Z'),
    };

    vi.spyOn(dbModule, 'withTransaction').mockImplementation(async (cb) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('SELECT * FROM decisions WHERE idempotency_key')) {
            return Promise.resolve({ rows: [existingDecisionRow] });
          }
          if (sql.includes('SELECT * FROM call_jobs')) {
            return Promise.resolve({ rows: [existingJobRow] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as PoolClient;
      return cb(mockClient);
    });

    const result = await submitDecision({
      groupId: 'grp-1',
      memberId: 'mem-1',
      memberName: 'Aarav',
      decision: 'NAHI_JAAYENGE',
      idempotencyKey: 'prior-key',
      clock,
    });

    expect(result.success).toBe(true);
    expect(result.isDuplicateSubmission).toBe(true);
    expect(result.decision.idempotencyKey).toBe('prior-key');
    expect(result.callJob.status).toBe('ACTION_REQUIRED');
  });
});
