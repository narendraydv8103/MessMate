import { DateTime } from 'luxon';
import { query, withTransaction } from '@/lib/db';
import { ReminderType } from '@/types';
import {
  Clock,
  SystemClock,
  getMealDate,
  getMealPeriod,
  getDeadline,
  getReminderTime,
} from './timezone';
import { getMealLockKey } from '@/lib/decisions';
import { getNotifier, recordNotificationDelivery, Notifier } from '@/lib/notify';

export interface TickSummary {
  success: boolean;
  timestamp: string;
  heartbeatUpdated: boolean;
  actions: {
    remindersClaimed: number;
    remindersDispatched: number;
    transitionsToActionRequired: number;
    transitionsToMissed: number;
    escalationsClaimed: number;
    escalationsDispatched: number;
    finalizedMissedDays: number;
  };
}

/**
 * Executes a single idempotent tick of the scheduler.
 * Designed to execute in under 5 seconds with zero long-held transactions around network calls.
 */
export async function runSchedulerTick(
  clock: Clock = new SystemClock(),
  notifier: Notifier = getNotifier()
): Promise<TickSummary> {
  const now = clock.now();
  const summary: TickSummary = {
    success: true,
    timestamp: now.toISO()!,
    heartbeatUpdated: false,
    actions: {
      remindersClaimed: 0,
      remindersDispatched: 0,
      transitionsToActionRequired: 0,
      transitionsToMissed: 0,
      escalationsClaimed: 0,
      escalationsDispatched: 0,
      finalizedMissedDays: 0,
    },
  };

  // 1. Update scheduler heartbeat table on every tick
  try {
    await query(
      `INSERT INTO scheduler_heartbeat (id, last_tick_at)
       VALUES (1, NOW())
       ON CONFLICT (id) DO UPDATE SET last_tick_at = NOW()`
    );
    summary.heartbeatUpdated = true;
  } catch (err) {
    console.error('Error updating scheduler heartbeat:', err);
  }

  // 2. Meal identifiers for today and yesterday
  const todayDate = getMealDate(now);
  const todayPeriod = getMealPeriod(now);
  const todayDeadline = getDeadline(now);
  const todayReminder = getReminderTime(now);

  const yesterday = now.minus({ days: 1 });
  const yesterdayDate = getMealDate(yesterday);
  const yesterdayPeriod = getMealPeriod(yesterday);
  const yesterdayDeadline = getDeadline(yesterday);

  const isTodayReminderWindow = now.toMillis() >= todayReminder.toMillis() && now.toMillis() < todayDeadline.toMillis();
  const isPastTodayDeadline = now.toMillis() >= todayDeadline.toMillis();

  // Quick check: if not in today's window, check if yesterday still has unfinalized work
  if (!isTodayReminderWindow && !isPastTodayDeadline) {
    // Check if yesterday is already finalized
    const unfinalizedCheck = await query<{ count: string }>(
      `SELECT count(*) FROM call_jobs 
       WHERE meal_date = $1 AND status IN ('PENDING', 'ACTION_REQUIRED')`,
      [yesterdayDate]
    );
    if (parseInt(unfinalizedCheck.rows[0]?.count || '0', 10) === 0) {
      // Nothing to do for today or yesterday; return quickly
      return summary;
    }
  }

  // 3. Fetch all groups
  const groupsRes = await query<{ id: string; name: string; aunty_phone: string }>(
    'SELECT id, name, aunty_phone FROM groups'
  );
  const groups = groupsRes.rows;

  for (const group of groups) {
    // -------------------------------------------------------------------------
    // Phase 1: Daily Reminder (Today only: reminderTime <= now < deadline)
    // -------------------------------------------------------------------------
    if (isTodayReminderWindow) {
      // Set send_status='PENDING' on claim
      const claimReminderRes = await query<{ id: string }>(
        `INSERT INTO reminder_log (group_id, meal_date, meal_period, reminder_type, sent_at, send_status)
         VALUES ($1, $2, $3, 'DAILY_REMINDER', NOW(), 'PENDING')
         ON CONFLICT (group_id, meal_date, meal_period, reminder_type) DO NOTHING
         RETURNING id`,
        [group.id, todayDate, todayPeriod]
      );

      if (claimReminderRes.rows.length > 0) {
        summary.actions.remindersClaimed += 1;
        const reminderLogId = claimReminderRes.rows[0].id;

        // Dispatch outside of DB transaction
        const notifyResult = await notifier.notify(group, 'DAILY_REMINDER', {
          title: 'Mess Reminder',
          body: 'Aaj khana khane jaoge? Decision daal do.',
          tag: 'messmate-daily-reminder',
        });

        // Update send_status after notify returns
        await recordNotificationDelivery(reminderLogId, notifyResult);
        summary.actions.remindersDispatched += 1;
      }
    }

    // -------------------------------------------------------------------------
    // Phase 2 & 3: Process Targets (Today if past deadline, and Yesterday)
    // -------------------------------------------------------------------------
    const targets: Array<{
      mealDate: string;
      mealPeriod: 'DINNER' | 'LUNCH';
      deadline: DateTime;
      isMissedDay: boolean;
    }> = [];

    if (isPastTodayDeadline) {
      targets.push({
        mealDate: todayDate,
        mealPeriod: todayPeriod,
        deadline: todayDeadline,
        isMissedDay: false,
      });
    }

    targets.push({
      mealDate: yesterdayDate,
      mealPeriod: yesterdayPeriod,
      deadline: yesterdayDeadline,
      isMissedDay: true,
    });

    for (const target of targets) {
      await processMealFinalizeAndEscalate({
        group,
        mealDate: target.mealDate,
        mealPeriod: target.mealPeriod,
        deadline: target.deadline,
        now,
        notifier,
        summary,
        isMissedDay: target.isMissedDay,
      });
    }
  }

  return summary;
}

interface ProcessTargetParams {
  group: { id: string; name: string };
  mealDate: string;
  mealPeriod: 'DINNER' | 'LUNCH';
  deadline: DateTime;
  now: DateTime;
  notifier: Notifier;
  summary: TickSummary;
  isMissedDay: boolean;
}

async function processMealFinalizeAndEscalate(params: ProcessTargetParams): Promise<void> {
  const { group, mealDate, mealPeriod, deadline, now, notifier, summary, isMissedDay } = params;
  const lockKey = getMealLockKey(group.id, mealDate, mealPeriod);

  // If now > deadline + 2 hours: mark MISSED, send NO notification
  const isPastTwoHourCutoff = now.toMillis() > deadline.plus({ hours: 2 }).toMillis();

  let urgentInitialClaimId: string | null = null;
  let escalationDueType: ReminderType | null = null;
  let escalationClaimId: string | null = null;

  await withTransaction(async (client) => {
    // 1. Advisory transaction lock
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

    // 2. Query latest decision
    const decisionRes = await client.query<{ decision: string }>(
      `SELECT decision FROM decisions 
       WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
       ORDER BY seq DESC LIMIT 1`,
      [group.id, mealDate, mealPeriod]
    );

    const latestDecision = decisionRes.rows[0]?.decision || null;

    if (latestDecision === 'JAAYENGE') {
      // Ensure call_jobs is CANCELLED (never overwrite AUNTY_INFORMED)
      await client.query(
        `INSERT INTO call_jobs (group_id, meal_date, meal_period, status, scheduled_for, updated_at)
         VALUES ($1, $2, $3, 'CANCELLED', $4, NOW())
         ON CONFLICT (group_id, meal_date, meal_period)
         DO UPDATE SET status = 'CANCELLED', updated_at = NOW()
         WHERE call_jobs.status NOT IN ('AUNTY_INFORMED', 'CANCELLED', 'MISSED')`,
        [group.id, mealDate, mealPeriod, deadline.toJSDate()]
      );
      return;
    }

    // NAHI_JAAYENGE or NO_DECISION:
    // Check 2-hour cutoff rule:
    if (isPastTwoHourCutoff) {
      // Set status = 'MISSED' instead of ACTION_REQUIRED, and send NO notification
      const updateMissedRes = await client.query<{ id: string }>(
        `UPDATE call_jobs 
         SET status = 'MISSED', updated_at = NOW()
         WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
           AND status = 'PENDING'
         RETURNING id`,
        [group.id, mealDate, mealPeriod]
      );

      let markedMissed = updateMissedRes.rows.length > 0;
      if (!markedMissed) {
        const insertMissedRes = await client.query<{ id: string }>(
          `INSERT INTO call_jobs (group_id, meal_date, meal_period, status, scheduled_for, updated_at)
           VALUES ($1, $2, $3, 'MISSED', $4, NOW())
           ON CONFLICT (group_id, meal_date, meal_period) DO NOTHING
           RETURNING id`,
          [group.id, mealDate, mealPeriod, deadline.toJSDate()]
        );
        markedMissed = insertMissedRes.rows.length > 0;
      }

      if (markedMissed) {
        summary.actions.transitionsToMissed += 1;
        if (isMissedDay) {
          summary.actions.finalizedMissedDays += 1;
        }
      }
      return; // Do NOT proceed to action_required or escalations
    }

    // Still within 2 hours: transition to ACTION_REQUIRED
    const updateRes = await client.query<{ id: string }>(
      `UPDATE call_jobs 
       SET status = 'ACTION_REQUIRED', 
           action_required_at = COALESCE(action_required_at, NOW()),
           updated_at = NOW()
       WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
         AND status = 'PENDING'
       RETURNING id`,
      [group.id, mealDate, mealPeriod]
    );

    let transitioned = updateRes.rows.length > 0;

    if (!transitioned) {
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO call_jobs (group_id, meal_date, meal_period, status, scheduled_for, action_required_at, updated_at)
         VALUES ($1, $2, $3, 'ACTION_REQUIRED', $4, NOW(), NOW())
         ON CONFLICT (group_id, meal_date, meal_period) DO NOTHING
         RETURNING id`,
        [group.id, mealDate, mealPeriod, deadline.toJSDate()]
      );
      transitioned = insertRes.rows.length > 0;
    }

    if (transitioned) {
      summary.actions.transitionsToActionRequired += 1;
      if (isMissedDay) {
        summary.actions.finalizedMissedDays += 1;
      }

      // Claim URGENT_INITIAL in reminder_log with send_status='PENDING'
      const claimUrgentRes = await client.query<{ id: string }>(
        `INSERT INTO reminder_log (group_id, meal_date, meal_period, reminder_type, sent_at, send_status)
         VALUES ($1, $2, $3, 'URGENT_INITIAL', NOW(), 'PENDING')
         ON CONFLICT (group_id, meal_date, meal_period, reminder_type) DO NOTHING
         RETURNING id`,
        [group.id, mealDate, mealPeriod]
      );

      if (claimUrgentRes.rows.length > 0) {
        urgentInitialClaimId = claimUrgentRes.rows[0].id;
      }
    }

    // -------------------------------------------------------------------------
    // Phase 3: Escalation Check (Only if ACTION_REQUIRED, not informed, AND now < deadline + 2 hours)
    // -------------------------------------------------------------------------
    if (!isPastTwoHourCutoff) {
      const jobRes = await client.query<{
        status: string;
        action_required_at: Date | null;
        escalation_count: number;
      }>(
        `SELECT status, action_required_at, escalation_count 
         FROM call_jobs 
         WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3`,
        [group.id, mealDate, mealPeriod]
      );

      const job = jobRes.rows[0];
      if (job && job.status === 'ACTION_REQUIRED' && job.action_required_at) {
        const actionTime = new Date(job.action_required_at).getTime();
        const elapsedMinutes = Math.floor((now.toMillis() - actionTime) / (60 * 1000));
        const count = Number(job.escalation_count || 0);

        let candidateType: ReminderType | null = null;
        let previousUrgentType: ReminderType | null = null;

        if (count === 0 && elapsedMinutes >= 10) {
          candidateType = 'URGENT_ESCALATION_1';
          previousUrgentType = 'URGENT_INITIAL';
        } else if (count === 1 && elapsedMinutes >= 20) {
          candidateType = 'URGENT_ESCALATION_2';
          previousUrgentType = 'URGENT_ESCALATION_1';
        } else if (count === 2 && elapsedMinutes >= 30) {
          candidateType = 'URGENT_ESCALATION_3';
          previousUrgentType = 'URGENT_ESCALATION_2';
        }

        if (candidateType && previousUrgentType) {
          // Check previous urgent reminder in reminder_log:
          // Escalation is allowed only if previous urgent send_status was SENT or its 10-minute time has passed
          const prevLogRes = await client.query<{ send_status: string; sent_at: Date }>(
            `SELECT send_status, sent_at FROM reminder_log 
             WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 AND reminder_type = $4`,
            [group.id, mealDate, mealPeriod, previousUrgentType]
          );

          const prevLog = prevLogRes.rows[0];
          let canEscalate = false;
          if (prevLog) {
            const prevSentAtMs = new Date(prevLog.sent_at).getTime();
            const prevElapsedMs = now.toMillis() - prevSentAtMs;
            if (prevLog.send_status === 'SENT' || prevElapsedMs >= 10 * 60 * 1000) {
              canEscalate = true;
            }
          }

          if (canEscalate) {
            escalationDueType = candidateType;
          }
        }

        if (escalationDueType) {
          // Claim with send_status='PENDING'
          const claimEscRes = await client.query<{ id: string }>(
            `INSERT INTO reminder_log (group_id, meal_date, meal_period, reminder_type, sent_at, send_status)
             VALUES ($1, $2, $3, $4, NOW(), 'PENDING')
             ON CONFLICT (group_id, meal_date, meal_period, reminder_type) DO NOTHING
             RETURNING id`,
            [group.id, mealDate, mealPeriod, escalationDueType]
          );

          if (claimEscRes.rows.length > 0) {
            escalationClaimId = claimEscRes.rows[0].id;

            await client.query(
              `UPDATE call_jobs 
               SET escalation_count = escalation_count + 1,
                   last_escalated_at = NOW(),
                   updated_at = NOW()
               WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
                 AND status = 'ACTION_REQUIRED'`,
              [group.id, mealDate, mealPeriod]
            );
          }
        }
      }
    }
  });

  // Dispatch external notifications outside of DB transaction
  if (urgentInitialClaimId) {
    const notifyRes = await notifier.notify(group, 'URGENT_INITIAL', {
      title: 'Aunty ko batana baaki hai!',
      body: 'Abhi call ya WhatsApp karo.',
      tag: 'messmate-urgent',
    });
    await recordNotificationDelivery(urgentInitialClaimId, notifyRes);
  }

  if (escalationClaimId && escalationDueType) {
    summary.actions.escalationsClaimed += 1;
    const notifyRes = await notifier.notify(group, escalationDueType, {
      title: 'Mess Alert',
      body: 'Reminder: Aunty ko abhi tak nahi bataya.',
      tag: 'messmate-urgent',
    });
    await recordNotificationDelivery(escalationClaimId, notifyRes);
    summary.actions.escalationsDispatched += 1;
  }
}
