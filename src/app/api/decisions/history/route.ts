import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db';
import { DecisionType, MealPeriod } from '@/types';

interface DecisionHistoryDbRow {
  seq: number | string;
  id: string;
  meal_date: Date | string;
  meal_period: MealPeriod;
  decision: DecisionType;
  submitted_by_member_id: string;
  submitted_by_name: string;
  created_at: Date | string;
  current_member_name: string | null;
  avatar_color: string | null;
  photo_mime: string | null;
  photo_updated_at: Date | string | null;
  is_final: boolean;
}

export async function GET(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const mealDate = url.searchParams.get('meal_date') || url.searchParams.get('mealDate');
  const mealPeriod = url.searchParams.get('meal_period') || url.searchParams.get('mealPeriod');

  try {
    const queryParams: (string | number)[] = [session.groupId];
    let filterSql = 'WHERE d.group_id = $1';

    if (mealDate) {
      queryParams.push(mealDate);
      filterSql += ` AND d.meal_date = $${queryParams.length}`;
    }

    if (mealPeriod) {
      queryParams.push(mealPeriod);
      filterSql += ` AND d.meal_period = $${queryParams.length}`;
    }

    // Query all decisions for the group ordered by seq ASC.
    // Window function marks whether each decision is the final one for that meal.
    const result = await query<DecisionHistoryDbRow>(
      `SELECT 
         d.seq,
         d.id,
         d.meal_date,
         d.meal_period,
         d.decision,
         d.submitted_by_member_id,
         d.submitted_by_name,
         d.created_at,
         m.name AS current_member_name,
         m.avatar_color,
         m.photo_mime,
         m.photo_updated_at,
         (d.seq = MAX(d.seq) OVER (PARTITION BY d.group_id, d.meal_date, d.meal_period)) AS is_final
       FROM decisions d
       LEFT JOIN members m ON d.submitted_by_member_id = m.id
       ${filterSql}
       ORDER BY d.seq ASC`,
      queryParams
    );

    const history = result.rows.map((row) => {
      const memberName = row.current_member_name || row.submitted_by_name || 'Roommate';
      const hasPhoto = Boolean(row.photo_mime);
      const photoVersion = row.photo_updated_at ? new Date(row.photo_updated_at).getTime() : null;
      const createdAtIso = row.created_at ? new Date(row.created_at).toISOString() : '';
      const mealDateStr =
        row.meal_date instanceof Date
          ? row.meal_date.toISOString().split('T')[0]
          : String(row.meal_date).split('T')[0];
      const isFinal = Boolean(row.is_final);

      return {
        seq: Number(row.seq),
        id: String(row.id),
        memberId: String(row.submitted_by_member_id),
        member_id: String(row.submitted_by_member_id),
        memberName,
        member_name: memberName,
        avatarColor: row.avatar_color || '#3b82f6',
        hasPhoto,
        photoVersion,
        decision: row.decision,
        createdAt: createdAtIso,
        created_at: createdAtIso,
        mealDate: mealDateStr,
        meal_date: mealDateStr,
        mealPeriod: row.meal_period,
        meal_period: row.meal_period,
        isFinal,
        is_final: isFinal,
      };
    });

    return NextResponse.json({ history, decisions: history });
  } catch (error) {
    console.error('Error fetching decision change history:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve decision change history.' },
      { status: 500 }
    );
  }
}
