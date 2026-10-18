import { DecisionType, CallJobStatus, DecisionLogEntry, CallJob, MealPeriod } from '@/types';
import { withTransaction, query } from '@/lib/db';
import {
  Clock,
  SystemClock,
  getMealDate,
  getMealPeriod,
  getDeadline,
  getReminderTime,
  isBeforeDeadline,
} from '@/lib/scheduler/timezone';

export class DecisionError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'DecisionError';
  }
}

/**
 * Generates the standardized advisory lock key string for a group's meal period:
 * groupId || meal_date || meal_period
 */
export function getMealLockKey(groupId: string, mealDate: string, mealPeriod: string): string {
  return `${groupId}${mealDate}${mealPeriod}`;
}

/**
 * Status label mapping rules:
 * - Decision Saved: when decision is JAAYENGE (and call_job is CANCELLED)
 * - [Mess Name] alert scheduled: when decision is NAHI_JAAYENGE and call_job is PENDING before deadline
 * - Action Required: when call_job is in ACTION_REQUIRED status
 * - [Mess Name] Informed: when call_job is in AUNTY_INFORMED status
 * - No Decision: when no decision has been entered yet before deadline
 */
export function mapStatusLabel(
  decision: DecisionType | null,
  jobStatus: CallJobStatus | null,
  beforeDeadline: boolean,
  messName: string = 'Mishra Tiffin Centre'
): string {
  if (jobStatus === 'MISSED') {
    return 'Missed';
  }
  if (jobStatus === 'AUNTY_INFORMED') {
    return `${messName} Informed`;
  }
  if (jobStatus === 'ACTION_REQUIRED') {
    return 'Action Required';
  }
  if (decision === 'NAHI_JAAYENGE') {
    return `${messName} alert scheduled`;
  }
  if (decision === 'JAAYENGE') {
    return 'Decision Saved';
  }
  return 'No Decision';
}

export interface SubmitDecisionParams {
  groupId: string;
  memberId: string;
  memberName: string;
  decision: DecisionType;
  idempotencyKey: string;
  notes?: string;
  clock?: Clock;
}

export interface SubmitDecisionResult {
  success: boolean;
  decision: DecisionLogEntry;
  callJob: CallJob;
  isDuplicateSubmission?: boolean;
  statusLabel: string;
}

/**
 * Transactional submission of a group decision.
 *
 * Strict execution order:
 * 1. Open transaction and take pg_advisory_xact_lock(hashtext(groupId || meal_date || meal_period)).
 * 2. Idempotency-key lookup (scoped to group: returns original result even after deadline).
 * 3. Deadline check using the Clock (rejects submissions at or after deadline with 422).
 * 4. Ensure call_jobs row exists (INSERT ... ON CONFLICT DO NOTHING) before SELECT ... FOR UPDATE.
 * 5. Verify call_jobs is not already ACTION_REQUIRED or AUNTY_INFORMED.
 * 6. Write decision and update call_jobs.
 */
export async function submitDecision(
  params: SubmitDecisionParams
): Promise<SubmitDecisionResult> {
  const {
    groupId,
    memberId,
    memberName,
    decision,
    idempotencyKey,
    notes,
    clock = new SystemClock(),
  } = params;

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    throw new DecisionError('idempotency_key is required.', 400);
  }

  if (decision !== 'JAAYENGE' && decision !== 'NAHI_JAAYENGE') {
    throw new DecisionError('Invalid decision. Must be JAAYENGE or NAHI_JAAYENGE.', 400);
  }

  const trimmedKey = idempotencyKey.trim();

  return withTransaction(async (client) => {
    // Determine server IST time & meal identifiers
    const now = clock.now();
    const mealDate = getMealDate(now);
    const mealPeriod = getMealPeriod(now);
    const deadline = getDeadline(now);
    const lockKey = getMealLockKey(groupId, mealDate, mealPeriod);

    // 1. Take advisory xact lock first
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);

    // 2. Idempotency-key lookup (scoped to group; returns original result even after deadline)
    const existingDecisionRes = await client.query(
      `SELECT * FROM decisions WHERE idempotency_key = $1 AND group_id = $2`,
      [trimmedKey, groupId]
    );

    const groupMessRes = await client.query<{ mess_name: string }>(
      'SELECT mess_name FROM groups WHERE id = $1',
      [groupId]
    );
    const messName = groupMessRes.rows[0]?.mess_name || 'Mishra Tiffin Centre';

    if (existingDecisionRes.rows.length > 0) {
      const existingDec = mapDecisionRow(existingDecisionRes.rows[0]);
      const jobRes = await client.query(
        `SELECT * FROM call_jobs 
         WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3`,
        [groupId, mealDate, mealPeriod]
      );
      const existingJob = jobRes.rows.length > 0 ? mapCallJobRow(jobRes.rows[0]) : null;
      return {
        success: true,
        isDuplicateSubmission: true,
        decision: existingDec,
        callJob: existingJob!,
        statusLabel: mapStatusLabel(existingDec.decision, existingJob?.status || null, isBeforeDeadline(now, deadline), messName),
      };
    }

    // 3. Deadline check using the Clock (now >= deadline throws DecisionError 422)
    if (!isBeforeDeadline(now, deadline)) {
      throw new DecisionError(
        `Deadline of ${deadline.toFormat('hh:mm a')} IST has passed for ${mealPeriod} on ${mealDate}. Decisions are closed for this meal period.`,
        422
      );
    }

    // 4. Ensure a call_jobs row exists before SELECT ... FOR UPDATE
    const deadlineUtc = deadline.toJSDate();
    await client.query(
      `INSERT INTO call_jobs (group_id, meal_date, meal_period, status, scheduled_for, updated_at)
       VALUES ($1, $2, $3, 'PENDING', $4, NOW())
       ON CONFLICT (group_id, meal_date, meal_period) DO NOTHING`,
      [groupId, mealDate, mealPeriod, deadlineUtc]
    );

    // 5. Lock the call_jobs row FOR UPDATE
    const lockedJobRes = await client.query(
      `SELECT * FROM call_jobs 
       WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
       FOR UPDATE`,
      [groupId, mealDate, mealPeriod]
    );

    if (lockedJobRes.rows.length > 0) {
      const currentStatus = lockedJobRes.rows[0].status as CallJobStatus;
      if (currentStatus === 'ACTION_REQUIRED' || currentStatus === 'AUNTY_INFORMED') {
        throw new DecisionError(
          'Decisions are closed for this meal period because action was already initiated or Aunty was informed.',
          422
        );
      }
    }

    // 6. Append new row into decisions log
    const insertDecisionRes = await client.query(
      `INSERT INTO decisions (idempotency_key, group_id, meal_date, meal_period, decision, submitted_by_member_id, submitted_by_name, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        trimmedKey,
        groupId,
        mealDate,
        mealPeriod,
        decision,
        memberId,
        memberName,
        notes || null,
      ]
    );
    const savedDecision = mapDecisionRow(insertDecisionRes.rows[0]);

    // 7. Update call_jobs according to decision
    const targetStatus: CallJobStatus = decision === 'NAHI_JAAYENGE' ? 'PENDING' : 'CANCELLED';

    const updateJobRes = await client.query(
      `UPDATE call_jobs 
       SET status = $4, scheduled_for = $5, updated_at = NOW()
       WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3
       RETURNING *`,
      [groupId, mealDate, mealPeriod, targetStatus, deadlineUtc]
    );

    const savedJob = mapCallJobRow(updateJobRes.rows[0]);

    return {
      success: true,
      decision: savedDecision,
      callJob: savedJob,
      statusLabel: mapStatusLabel(savedDecision.decision, savedJob.status, true, messName),
    };
  });
}

/**
 * Returns current meal status, countdown, deadline, and latest decision for the group.
 */
export async function getCurrentMealStatus(groupId: string, clock: Clock = new SystemClock()) {
  const now = clock.now();
  const mealDate = getMealDate(now);
  const mealPeriod = getMealPeriod(now);
  const deadline = getDeadline(now);
  const reminderTime = getReminderTime(now);
  const beforeDeadline = isBeforeDeadline(now, deadline);

  // 1. Fetch group Aunty phone & mess name
  const groupRes = await query<{ aunty_phone: string; name: string; mess_name: string }>(
    'SELECT aunty_phone, name, mess_name FROM groups WHERE id = $1',
    [groupId]
  );
  const auntyPhone = groupRes.rows[0]?.aunty_phone || '';
  const messName = groupRes.rows[0]?.mess_name || 'Mishra Tiffin Centre';

  // 2. Query latest decision
  const decisionRes = await query(
    `SELECT * FROM decisions 
     WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
     ORDER BY seq DESC LIMIT 1`,
    [groupId, mealDate, mealPeriod]
  );
  const latestDecision = decisionRes.rows.length > 0 ? mapDecisionRow(decisionRes.rows[0]) : null;

  // 3. Query call_job
  const jobRes = await query(
    `SELECT * FROM call_jobs 
     WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3`,
    [groupId, mealDate, mealPeriod]
  );
  const callJob = jobRes.rows.length > 0 ? mapCallJobRow(jobRes.rows[0]) : null;

  // 4. Query scheduler heartbeat
  const heartbeatRes = await query<{ last_tick_at: Date }>(
    'SELECT last_tick_at FROM scheduler_heartbeat WHERE id = 1'
  );
  const lastTickAt = heartbeatRes.rows[0]?.last_tick_at ? new Date(heartbeatRes.rows[0].last_tick_at) : null;
  const isSchedulerStale = !lastTickAt || (now.toMillis() - lastTickAt.getTime() > 5 * 60 * 1000);

  // 5. Query group push subscriptions count
  const subCountRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM push_subscriptions WHERE group_id = $1`,
    [groupId]
  );
  const groupSubscriptionCount = Number(subCountRes.rows[0]?.count || 0);
  const hasGroupSubscriptions = groupSubscriptionCount > 0;

  // 6. Check if urgent push failed or was not configured when ACTION_REQUIRED
  let urgentPushFailed = false;
  if (callJob?.status === 'ACTION_REQUIRED') {
    const latestUrgentRes = await query<{ send_status: string }>(
      `SELECT send_status FROM reminder_log 
       WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
         AND reminder_type LIKE 'URGENT_%' 
       ORDER BY sent_at DESC LIMIT 1`,
      [groupId, mealDate, mealPeriod]
    );
    const latestUrgentStatus = latestUrgentRes.rows[0]?.send_status;
    if (latestUrgentStatus === 'FAILED' || latestUrgentStatus === 'NOT_CONFIGURED') {
      urgentPushFailed = true;
    }
  }

  const statusLabel = mapStatusLabel(
    latestDecision?.decision || null,
    callJob?.status || null,
    beforeDeadline,
    messName
  );

  const hindiMessage = 'Namaste aunty, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad.';
  const encodedMessage = encodeURIComponent(hindiMessage);
  const cleanPhone = auntyPhone.replace(/[^0-9+]/g, '');

  return {
    messName,
    mealDate,
    mealPeriod,
    serverTime: now.toISO()!,
    reminderTime: reminderTime.toISO()!,
    deadlineTime: deadline.toISO()!,
    isBeforeDeadline: beforeDeadline,
    decision: latestDecision?.decision || null,
    submittedBy: latestDecision?.submittedByName || null,
    submittedAt: latestDecision?.createdAt?.toISOString() || null,
    notes: latestDecision?.notes || null,
    callJobStatus: callJob?.status || null,
    statusLabel,
    auntyPhone,
    prefilledWhatsAppText: hindiMessage,
    whatsappUrl: `https://wa.me/${cleanPhone}?text=${encodedMessage}`,
    telUrl: `tel:${cleanPhone}`,
    actionRequiredAt: callJob?.actionRequiredAt ? callJob.actionRequiredAt.toISOString() : null,
    informedBy: callJob?.informedByName || null,
    informedAt: callJob?.informedAt ? callJob.informedAt.toISOString() : null,
    lastTickAt: lastTickAt?.toISOString() || null,
    isSchedulerStale,
    hasGroupSubscriptions,
    groupSubscriptionCount,
    urgentPushFailed,
  };
}

/**
 * Fetches recent decision history for the group.
 */
export async function getDecisionHistory(groupId: string, limit: number = 50): Promise<DecisionLogEntry[]> {
  const result = await query(
    `SELECT * FROM decisions 
     WHERE group_id = $1 
     ORDER BY seq DESC 
     LIMIT $2`,
    [groupId, limit]
  );

  return result.rows.map(mapDecisionRow);
}

function mapDecisionRow(row: Record<string, unknown>): DecisionLogEntry {
  return {
    seq: Number(row.seq),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    groupId: String(row.group_id),
    mealDate: String(row.meal_date instanceof Date ? row.meal_date.toISOString().split('T')[0] : row.meal_date),
    mealPeriod: row.meal_period as MealPeriod,
    decision: row.decision as DecisionType,
    submittedByMemberId: String(row.submitted_by_member_id),
    submittedByName: String(row.submitted_by_name),
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: new Date(row.created_at as string | Date),
  };
}

function mapCallJobRow(row: Record<string, unknown>): CallJob {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    mealDate: String(row.meal_date instanceof Date ? row.meal_date.toISOString().split('T')[0] : row.meal_date),
    mealPeriod: row.meal_period as MealPeriod,
    status: row.status as CallJobStatus,
    scheduledFor: new Date(row.scheduled_for as string | Date),
    actionRequiredAt: row.action_required_at ? new Date(row.action_required_at as string | Date) : undefined,
    informedByMemberId: row.informed_by_member_id ? String(row.informed_by_member_id) : undefined,
    informedByName: row.informed_by_name ? String(row.informed_by_name) : undefined,
    informedAt: row.informed_at ? new Date(row.informed_at as string | Date) : undefined,
    escalationCount: Number(row.escalation_count || 0),
    lastEscalatedAt: row.last_escalated_at ? new Date(row.last_escalated_at as string | Date) : undefined,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
  };
}
