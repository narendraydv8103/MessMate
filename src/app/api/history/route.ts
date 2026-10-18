import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { mapStatusLabel } from '@/lib/decisions';
import { SystemClock, isBeforeDeadline } from '@/lib/scheduler/timezone';
import { DecisionType, CallJobStatus, MealPeriod } from '@/types';

export async function GET(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clock = new SystemClock();
    const now = clock.now();

    // Query decisions and call jobs for this group
    const res = await query<{
      meal_date: string;
      meal_period: MealPeriod;
      decision: DecisionType | null;
      submitted_by_member_id: string | null;
      submitted_by_name: string | null;
      created_at: Date | null;
      status: CallJobStatus | null;
      scheduled_for: Date | null;
      informed_by_member_id: string | null;
      informed_by_name: string | null;
      informed_at: Date | null;
    }>(
      `SELECT 
         COALESCE(c.meal_date::text, d.meal_date::text) as meal_date,
         COALESCE(c.meal_period, d.meal_period) as meal_period,
         d.decision,
         d.submitted_by_member_id,
         d.submitted_by_name,
         d.created_at,
         c.status,
         c.scheduled_for,
         c.informed_by_member_id,
         c.informed_by_name,
         c.informed_at
       FROM call_jobs c
       FULL OUTER JOIN (
         SELECT DISTINCT ON (group_id, meal_date, meal_period)
           group_id, meal_date, meal_period, decision, submitted_by_member_id, submitted_by_name, created_at
         FROM decisions
         WHERE group_id = $1
         ORDER BY group_id, meal_date, meal_period, seq DESC
       ) d ON c.group_id = d.group_id AND c.meal_date = d.meal_date AND c.meal_period = d.meal_period
       WHERE COALESCE(c.group_id, d.group_id) = $1
       ORDER BY COALESCE(c.meal_date, d.meal_date) DESC, COALESCE(c.scheduled_for, d.created_at) DESC
       LIMIT 50`,
      [session.groupId]
    );

    const groupRes = await query<{ mess_name: string }>(
      'SELECT mess_name FROM groups WHERE id = $1',
      [session.groupId]
    );
    const messName = groupRes.rows[0]?.mess_name || 'Mishra Tiffin Centre';

    // Fetch member metadata to populate avatars
    const membersRes = await query<{
      id: string;
      name: string;
      avatar_color: string;
      photo_mime: string | null;
      photo_updated_at: Date | null;
    }>(
      'SELECT id, name, avatar_color, photo_mime, photo_updated_at FROM members WHERE group_id = $1',
      [session.groupId]
    );
    const membersMap = new Map<
      string,
      {
        id: string;
        name: string;
        avatarColor: string;
        hasPhoto: boolean;
        photoVersion: number | null;
      }
    >();
    membersRes.rows.forEach((m) => {
      membersMap.set(m.id, {
        id: m.id,
        name: m.name,
        avatarColor: m.avatar_color,
        hasPhoto: Boolean(m.photo_mime),
        photoVersion: m.photo_updated_at ? new Date(m.photo_updated_at).getTime() : null,
      });
    });

    const history = res.rows.map((row) => {
      const beforeDeadline = isBeforeDeadline(now);
      const displayLabel = mapStatusLabel(row.decision, row.status, beforeDeadline, messName);

      const submittedByMember = row.submitted_by_member_id
        ? membersMap.get(row.submitted_by_member_id) || {
            id: row.submitted_by_member_id,
            name: row.submitted_by_name || 'Roommate',
            avatarColor: '#3b82f6',
            hasPhoto: false,
            photoVersion: null,
          }
        : row.submitted_by_name
        ? {
            name: row.submitted_by_name,
            avatarColor: '#3b82f6',
            hasPhoto: false,
            photoVersion: null,
          }
        : null;

      const informedByMember = row.informed_by_member_id
        ? membersMap.get(row.informed_by_member_id) || {
            id: row.informed_by_member_id,
            name: row.informed_by_name || 'Roommate',
            avatarColor: '#10b981',
            hasPhoto: false,
            photoVersion: null,
          }
        : row.informed_by_name
        ? {
            name: row.informed_by_name,
            avatarColor: '#10b981',
            hasPhoto: false,
            photoVersion: null,
          }
        : null;

      return {
        date: row.meal_date,
        mealPeriod: row.meal_period,
        decision: row.decision,
        submittedByName: row.submitted_by_name,
        submittedByMember,
        submittedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
        callJobStatus: row.status,
        statusLabel: displayLabel,
        informedByName: row.informed_by_name,
        informedByMember,
        informedAt: row.informed_at ? new Date(row.informed_at).toISOString() : null,
      };
    });

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json({ error: 'Failed to fetch history.' }, { status: 500 });
  }
}
