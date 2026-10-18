import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, withTransaction } from '@/lib/db';
import { SystemClock } from '@/lib/scheduler/timezone';
import { isVapidConfigured } from '@/lib/notify';

// Validates +91 followed by 10 Indian mobile digits (starting with 6, 7, 8, or 9)
const AUNTY_PHONE_REGEX = /^\+91[6-9]\d{9}$/;

export async function GET(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const groupRes = await query<{
      id: string;
      name: string;
      mess_name: string;
      aunty_phone: string;
      settings: Record<string, unknown>;
    }>('SELECT id, name, mess_name, aunty_phone, settings FROM groups WHERE id = $1', [session.groupId]);

    if (groupRes.rows.length === 0) {
      return NextResponse.json({ error: 'Group not found.' }, { status: 404 });
    }

    const membersRes = await query<{
      id: string;
      name: string;
      avatar_color: string;
      notification_preferences: Record<string, unknown>;
    }>('SELECT id, name, avatar_color, notification_preferences FROM members WHERE group_id = $1 ORDER BY name ASC', [
      session.groupId,
    ]);

    const heartbeatRes = await query<{ last_tick_at: Date }>(
      'SELECT last_tick_at FROM scheduler_heartbeat WHERE id = 1'
    );
    const lastTickAt = heartbeatRes.rows[0]?.last_tick_at ? new Date(heartbeatRes.rows[0].last_tick_at) : null;
    const now = new SystemClock().now();
    const isSchedulerStale = !lastTickAt || (now.toMillis() - lastTickAt.getTime() > 5 * 60 * 1000);

    // Count subscriptions for the logged-in member
    let memberSubscriptionsCount = 0;
    try {
      const subRes = await query<{ count: string }>(
        'SELECT count(*) FROM push_subscriptions WHERE member_id = $1',
        [session.memberId]
      );
      memberSubscriptionsCount = parseInt(subRes.rows[0]?.count || '0', 10);
    } catch {
      // Table might not exist yet before migration
      memberSubscriptionsCount = 0;
    }

    const group = groupRes.rows[0];

    return NextResponse.json({
      group: {
        id: group.id,
        name: group.name,
        messName: group.mess_name || 'Mishra Tiffin Centre',
        auntyPhone: group.aunty_phone,
        settings: group.settings,
      },
      members: membersRes.rows.map((m) => ({
        id: m.id,
        name: m.name,
        avatarColor: m.avatar_color,
        notificationPreferences: m.notification_preferences,
      })),
      scheduler: {
        lastTickAt: lastTickAt?.toISOString() || null,
        isSchedulerStale,
      },
      push: {
        isConfigured: isVapidConfigured(),
        memberSubscriptionsCount,
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { auntyPhone, messName, members } = body;

    // Validate mess name if provided
    if (messName !== undefined) {
      if (typeof messName !== 'string' || messName.trim().length < 1 || messName.trim().length > 40) {
        return NextResponse.json(
          { error: 'Mess name must be between 1 and 40 characters.' },
          { status: 400 }
        );
      }
    }

    // Validate Aunty phone if provided
    if (auntyPhone !== undefined) {
      if (typeof auntyPhone !== 'string' || !AUNTY_PHONE_REGEX.test(auntyPhone.trim())) {
        return NextResponse.json(
          {
            error:
              'Invalid Aunty phone number. Must be a valid Indian phone number starting with +91 followed by 10 digits (e.g. +919876543210).',
          },
          { status: 400 }
        );
      }
    }

    // Validate members if provided
    if (members !== undefined) {
      if (!Array.isArray(members)) {
        return NextResponse.json({ error: 'members must be an array.' }, { status: 400 });
      }

      // Check nickname lengths (1 to 20 chars) and uniqueness within group
      const seenNames = new Set<string>();
      for (const m of members) {
        if (!m || typeof m.id !== 'string') continue;
        if (typeof m.name !== 'string') {
          return NextResponse.json({ error: 'Nickname must be a string.' }, { status: 400 });
        }
        const trimmed = m.name.trim();
        if (trimmed.length < 1 || trimmed.length > 20) {
          return NextResponse.json(
            { error: `Nickname "${trimmed}" must be between 1 and 20 characters.` },
            { status: 400 }
          );
        }

        const normalized = trimmed.toLowerCase();
        if (seenNames.has(normalized)) {
          return NextResponse.json(
            { error: `Roommate nicknames must be unique within the group. Duplicate found: "${trimmed}".` },
            { status: 400 }
          );
        }
        seenNames.add(normalized);
      }
    }

    await withTransaction(async (client) => {
      // 1. Update messName if provided
      if (messName) {
        await client.query('UPDATE groups SET mess_name = $1, updated_at = NOW() WHERE id = $2', [
          messName.trim(),
          session.groupId,
        ]);
      }

      // 2. Update auntyPhone if provided
      if (auntyPhone) {
        await client.query('UPDATE groups SET aunty_phone = $1, updated_at = NOW() WHERE id = $2', [
          auntyPhone.trim(),
          session.groupId,
        ]);
      }

      // 3. Update member nicknames if provided
      if (Array.isArray(members)) {
        for (const m of members) {
          if (m.id && typeof m.name === 'string') {
            await client.query(
              'UPDATE members SET name = $1 WHERE id = $2 AND group_id = $3',
              [m.name.trim(), m.id, session.groupId]
            );
          }
        }
      }
    });

    return NextResponse.json({ success: true, message: 'Settings updated successfully.' });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Failed to update settings.' }, { status: 500 });
  }
}
