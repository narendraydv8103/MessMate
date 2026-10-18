import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db';
import {
  getVapidPublicKey,
  getVapidPrivateKey,
  getVapidSubject,
  isVapidConfigured,
} from '@/lib/env';

const TEST_COOLDOWN_SECONDS = 60; // 1 minute per member

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function POST(request: Request) {
  const session = requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Enforce 1 test per minute rate limit per member via database
  try {
    const memberRes = await query<{ last_test_push_at: Date | null }>(
      `SELECT last_test_push_at FROM members WHERE id = $1`,
      [session.memberId]
    );

    if (memberRes.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
    }

    const lastTestPushAt = memberRes.rows[0].last_test_push_at
      ? new Date(memberRes.rows[0].last_test_push_at).getTime()
      : null;

    if (lastTestPushAt) {
      const elapsedMs = Date.now() - lastTestPushAt;
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      if (elapsedSeconds < TEST_COOLDOWN_SECONDS) {
        const remainingSeconds = TEST_COOLDOWN_SECONDS - elapsedSeconds;
        return NextResponse.json(
          {
            error: `Please wait ${remainingSeconds} seconds before sending another test push.`,
            retryAfterSeconds: remainingSeconds,
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(remainingSeconds),
            },
          }
        );
      }
    }

    // 2. Check VAPID configuration
    if (!isVapidConfigured()) {
      return NextResponse.json(
        {
          error: 'Web Push is NOT configured on this server (missing VAPID keys).',
        },
        { status: 503 }
      );
    }

    // 3. Query active subscriptions for the current member
    const subRes = await query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      `SELECT id, endpoint, p256dh, auth 
       FROM push_subscriptions 
       WHERE member_id = $1`,
      [session.memberId]
    );

    const subscriptions = subRes.rows;
    if (subscriptions.length === 0) {
      return NextResponse.json(
        {
          error: 'No active push subscriptions found for this device. Please tap "Enable Notifications" first.',
        },
        { status: 400 }
      );
    }

    // Update last_test_push_at in DB
    await query(`UPDATE members SET last_test_push_at = NOW() WHERE id = $1`, [session.memberId]);

    const publicKey = getVapidPublicKey()!;
    const privateKey = getVapidPrivateKey()!;
    const subject = getVapidSubject();
    webpush.setVapidDetails(subject, publicKey, privateKey);

    // Payload MUST contain ONLY title, body, and tag per specification
    const payload = JSON.stringify({
      title: 'MessMate Test Alert',
      body: 'Badiya! Web push is working correctly on this device.',
      tag: 'messmate-test',
    });

    let accepted = 0;
    let failed = 0;
    let removed = 0;
    const errors: string[] = [];

    // Parallel send with Promise.allSettled and 5-second timeout per push
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        return withTimeout(
          webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
            { TTL: 60 }
          ),
          5000,
          'Push send timeout (5s)'
        ).catch(async (err: unknown) => {
          const webPushErr = err as { statusCode?: number; message?: string };
          if (webPushErr.statusCode === 404 || webPushErr.statusCode === 410) {
            await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
            throw { isRemoved: true, message: webPushErr.message };
          }
          throw err;
        });
      })
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        accepted += 1;
      } else {
        const reason = res.reason as { isRemoved?: boolean; message?: string };
        if (reason?.isRemoved) {
          removed += 1;
        } else {
          failed += 1;
          errors.push(reason?.message || 'Push dispatch failed');
        }
      }
    }

    if (accepted > 0) {
      return NextResponse.json({
        success: true,
        message: `Test push sent! (Accepted: ${accepted}, Failed: ${failed}, Expired removed: ${removed})`,
        accepted,
        failed,
        removed,
      });
    }

    return NextResponse.json(
      {
        error: `Push service rejected delivery (${errors[0] || 'Unknown error'}). Expired subscriptions removed: ${removed}.`,
        accepted,
        failed,
        removed,
      },
      { status: 502 }
    );
  } catch (error) {
    console.error('Error sending test push:', error);
    return NextResponse.json(
      { error: 'Internal error while sending test notification.' },
      { status: 500 }
    );
  }
}
