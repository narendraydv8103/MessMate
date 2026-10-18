import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { withTransaction } from '@/lib/db';
import { SystemClock, getMealDate, getMealPeriod } from '@/lib/scheduler/timezone';
import { getMealLockKey } from '@/lib/decisions';

export async function POST(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clock = new SystemClock();
  const now = clock.now();
  const mealDate = getMealDate(now);
  const mealPeriod = getMealPeriod(now);
  const lockKey = getMealLockKey(session.groupId, mealDate, mealPeriod);

  try {
    const result = await withTransaction(async (client) => {
      // 1. Take advisory transaction lock
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

      // 2. Select call_job FOR UPDATE
      const jobRes = await client.query<{
        id: string;
        status: string;
        informed_by_member_id: string | null;
        informed_by_name: string | null;
        informed_at: Date | null;
      }>(
        `SELECT id, status, informed_by_member_id, informed_by_name, informed_at 
         FROM call_jobs 
         WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
         FOR UPDATE`,
        [session.groupId, mealDate, mealPeriod]
      );

      if (jobRes.rows.length === 0) {
        return {
          status: 409,
          body: { error: 'No call action is required for this meal period.' },
        };
      }

      const job = jobRes.rows[0];

      // If already AUNTY_INFORMED, return existing record idempotently
      if (job.status === 'AUNTY_INFORMED') {
        return {
          status: 200,
          body: {
            success: true,
            alreadyInformed: true,
            informedBy: job.informed_by_name,
            informedAt: job.informed_at,
          },
        };
      }

      // Allowed ONLY when status is ACTION_REQUIRED
      if (job.status !== 'ACTION_REQUIRED') {
        return {
          status: 409,
          body: {
            error: `Cannot mark Aunty informed when status is ${job.status}. Action is only allowed when status is ACTION_REQUIRED.`,
          },
        };
      }

      // Update to AUNTY_INFORMED
      const updateRes = await client.query<{
        informed_by_name: string;
        informed_at: Date;
      }>(
        `UPDATE call_jobs 
         SET status = 'AUNTY_INFORMED',
             informed_by_member_id = $4,
             informed_by_name = $5,
             informed_at = NOW(),
             updated_at = NOW()
         WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3
         RETURNING informed_by_name, informed_at`,
        [session.groupId, mealDate, mealPeriod, session.memberId, session.memberName]
      );

      return {
        status: 200,
        body: {
          success: true,
          informedBy: updateRes.rows[0].informed_by_name,
          informedAt: updateRes.rows[0].informed_at,
        },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error in /api/aunty/informed:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred while recording Aunty informed.' },
      { status: 500 }
    );
  }
}
