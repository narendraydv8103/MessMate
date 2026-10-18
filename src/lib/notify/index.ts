import webpush from 'web-push';
import { ReminderType, NotificationDeliveryStatus } from '@/types';
import { query } from '@/lib/db';
import {
  getVapidPublicKey,
  getVapidPrivateKey,
  getVapidSubject,
  isVapidConfigured,
} from '@/lib/env';

export { isVapidConfigured };

/**
 * Push payload strictly restricted to title, body, and tag.
 * No phone numbers or private data per specification.
 */
export interface NotificationPayload {
  title: string;
  body: string;
  tag: string;
}

export interface NotificationResult {
  status: NotificationDeliveryStatus;
  detail?: string;
  error?: string;
  counts?: {
    accepted: number;
    failed: number;
    removed: number;
  };
}

export interface Notifier {
  readonly name: string;
  notify(
    group: { id: string; name: string },
    type: ReminderType,
    payload?: Partial<NotificationPayload>
  ): Promise<NotificationResult>;
}

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

/**
 * Standardized Hinglish message copy generator per specification.
 */
export function getStandardNotificationPayload(type: ReminderType): NotificationPayload {
  switch (type) {
    case 'DAILY_REMINDER':
      return {
        title: 'Mess Reminder',
        body: 'Aaj khana khane jaoge? Decision daal do.',
        tag: 'messmate-daily-reminder',
      };
    case 'URGENT_INITIAL':
      return {
        title: 'Aunty ko batana baaki hai!',
        body: 'Abhi call ya WhatsApp karo.',
        tag: 'messmate-urgent',
      };
    case 'URGENT_ESCALATION_1':
    case 'URGENT_ESCALATION_2':
    case 'URGENT_ESCALATION_3':
      return {
        title: 'Mess Alert',
        body: 'Reminder: Aunty ko abhi tak nahi bataya.',
        tag: 'messmate-urgent',
      };
  }
}

/**
 * Production Web Push Notifier using VAPID and web-push.
 * Never claims "delivered" or "read", only "sent".
 */
export class WebPushNotifier implements Notifier {
  readonly name = 'web-push';

  async notify(
    group: { id: string; name: string },
    type: ReminderType,
    customPayload?: Partial<NotificationPayload>
  ): Promise<NotificationResult> {
    // 1. Check if VAPID keys are configured
    if (!isVapidConfigured()) {
      return {
        status: 'NOT_CONFIGURED',
        detail: 'VAPID keys not configured. Run npm run vapid:generate to set up Web Push.',
      };
    }

    const publicKey = getVapidPublicKey()!;
    const privateKey = getVapidPrivateKey()!;
    const subject = getVapidSubject();

    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } catch (err) {
      return {
        status: 'NOT_CONFIGURED',
        detail: `Failed to configure VAPID details: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 2. Determine default message copy (strictly title, body, tag)
    const basePayload = getStandardNotificationPayload(type);
    const finalPayload: NotificationPayload = {
      title: customPayload?.title || basePayload.title,
      body: customPayload?.body || basePayload.body,
      tag: customPayload?.tag || basePayload.tag,
    };

    // 3. Query group's current call_job status to enforce:
    // URGENT_* notifications cannot be disabled while call_job is ACTION_REQUIRED
    let isActionRequired = false;
    try {
      const jobRes = await query<{ status: string }>(
        `SELECT status FROM call_jobs WHERE group_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [group.id]
      );
      isActionRequired = jobRes.rows[0]?.status === 'ACTION_REQUIRED';
    } catch {
      // Table might be unavailable or empty
      isActionRequired = type.startsWith('URGENT_');
    }

    // 4. Query members and their preferences
    const membersRes = await query<{
      id: string;
      name: string;
      notification_preferences: { push_enabled?: boolean; reminders?: boolean } | null;
    }>(
      `SELECT id, name, notification_preferences FROM members WHERE group_id = $1`,
      [group.id]
    );

    const eligibleMemberIds = new Set<string>();
    for (const member of membersRes.rows) {
      const prefs = member.notification_preferences || {};
      const pushEnabled = prefs.push_enabled !== false;
      const remindersEnabled = prefs.reminders !== false;

      if (type.startsWith('URGENT_')) {
        // URGENT_* notifications CANNOT be disabled while call_job is ACTION_REQUIRED
        if (isActionRequired || pushEnabled) {
          eligibleMemberIds.add(member.id);
        }
      } else {
        // DAILY_REMINDER respects member preferences
        if (pushEnabled && remindersEnabled) {
          eligibleMemberIds.add(member.id);
        }
      }
    }

    if (eligibleMemberIds.size === 0) {
      return {
        status: 'FAILED',
        error: 'No eligible members found based on notification preferences.',
        counts: { accepted: 0, failed: 0, removed: 0 },
      };
    }

    // 5. Query active push subscriptions for eligible members
    const subRes = await query<{
      id: string;
      member_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      `SELECT id, member_id, endpoint, p256dh, auth 
       FROM push_subscriptions 
       WHERE group_id = $1 AND member_id = ANY($2::uuid[])`,
      [group.id, Array.from(eligibleMemberIds)]
    );

    const subscriptions = subRes.rows;
    if (subscriptions.length === 0) {
      return {
        status: 'FAILED',
        error: 'No active push subscriptions registered for eligible members.',
        counts: { accepted: 0, failed: 0, removed: 0 },
      };
    }

    // 6. Send web push to all subscriptions with parallel Promise.allSettled & 5s timeout
    const isUrgent = type.startsWith('URGENT_');
    const pushOptions: webpush.RequestOptions = {
      TTL: isUrgent ? 15 * 60 : 60 * 60, // 15 min for urgent, 1 hour for reminder
      urgency: isUrgent ? 'high' : 'normal',
    };

    let acceptedCount = 0;
    let failedCount = 0;
    let removedCount = 0;
    const errors: string[] = [];

    // Strictly send title, body, and tag only
    const payloadString = JSON.stringify({
      title: finalPayload.title,
      body: finalPayload.body,
      tag: finalPayload.tag,
    });

    const pushPromises = subscriptions.map((sub) => {
      return withTimeout(
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payloadString,
          pushOptions
        ),
        5000,
        'Push dispatch timed out after 5s'
      ).catch(async (err: unknown) => {
        const webPushErr = err as { statusCode?: number; message?: string };
        // On 404 Not Found or 410 Gone: unsubscribe / delete dead subscription
        if (webPushErr.statusCode === 404 || webPushErr.statusCode === 410) {
          try {
            await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
          } catch (delErr) {
            console.error('Failed to remove expired subscription:', delErr);
          }
          throw { isRemoved: true, message: webPushErr.message };
        }
        throw err;
      });
    });

    // Keep the entire push notification batch under 8 seconds (well under the 10-second tick budget)
    const settledResults = await withTimeout(
      Promise.allSettled(pushPromises),
      8000,
      'Batch push notifications timed out after 8s'
    ).catch(() => [] as PromiseSettledResult<void>[]);

    for (const res of settledResults) {
      if (res.status === 'fulfilled') {
        acceptedCount += 1;
      } else {
        const reason = res.reason as { isRemoved?: boolean; message?: string };
        if (reason?.isRemoved) {
          removedCount += 1;
        } else {
          failedCount += 1;
          errors.push(reason?.message || 'Push dispatch failed');
        }
      }
    }

    // 7. Aggregate result: SENT only if at least one accepted
    const counts = { accepted: acceptedCount, failed: failedCount, removed: removedCount };

    if (acceptedCount > 0) {
      return {
        status: 'SENT',
        detail: `Push sent successfully. Accepted: ${acceptedCount}, Failed: ${failedCount}, Removed: ${removedCount}`,
        counts,
      };
    }

    return {
      status: 'FAILED',
      error: `All push dispatches failed (Accepted: 0, Failed: ${failedCount}, Removed: ${removedCount}). ${errors[0] || ''}`.trim(),
      counts,
    };
  }
}

/**
 * Placeholder notifier for development/testing before real Web Push is wired.
 */
export class PlaceholderNotifier implements Notifier {
  readonly name = 'placeholder';

  async notify(
    group: { id: string; name: string },
    type: ReminderType,
    payload?: Partial<NotificationPayload>
  ): Promise<NotificationResult> {
    console.log(`[PlaceholderNotifier] Notification simulated for group "${group.name}" (${group.id}):`, {
      type,
      payload,
    });
    return {
      status: 'SENT',
      detail: `Simulated notification for group ${group.name}`,
    };
  }
}

/**
 * Updates reminder_log with the actual delivery status and detail from Notifier.
 */
export async function recordNotificationDelivery(
  reminderLogId: string,
  result: NotificationResult
): Promise<void> {
  const detail = result.detail || result.error || null;
  await query(
    `UPDATE reminder_log 
     SET send_status = $2, error_detail = $3, updated_at = NOW() 
     WHERE id = $1`,
    [reminderLogId, result.status, detail]
  );
}

let activeNotifier: Notifier = new WebPushNotifier();

export function getNotifier(): Notifier {
  return activeNotifier;
}

export function setNotifier(notifier: Notifier): void {
  activeNotifier = notifier;
}

