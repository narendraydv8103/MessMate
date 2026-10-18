import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query<{
      id: string;
      name: string;
      avatar_color: string;
    }>('SELECT id, name, avatar_color FROM members ORDER BY name ASC');

    const members = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatarColor: row.avatar_color,
    }));

    return NextResponse.json({ members });
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json(
      { error: 'Failed to fetch members.' },
      { status: 500 }
    );
  }
}
