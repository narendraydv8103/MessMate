import { DateTime } from 'luxon';
import { MealPeriod } from '@/types';

export const KOLKATA_TIMEZONE = 'Asia/Kolkata';

export interface Clock {
  now(): DateTime;
}

export class SystemClock implements Clock {
  now(): DateTime {
    return DateTime.now().setZone(KOLKATA_TIMEZONE);
  }
}

export class MockClock implements Clock {
  private currentTime: DateTime;

  constructor(initialTimeOrIso?: string | DateTime) {
    if (!initialTimeOrIso) {
      this.currentTime = DateTime.now().setZone(KOLKATA_TIMEZONE);
    } else if (typeof initialTimeOrIso === 'string') {
      this.currentTime = DateTime.fromISO(initialTimeOrIso, { zone: KOLKATA_TIMEZONE });
    } else {
      this.currentTime = initialTimeOrIso.setZone(KOLKATA_TIMEZONE);
    }
  }

  now(): DateTime {
    return this.currentTime;
  }

  advance(duration: { minutes?: number; hours?: number; seconds?: number; days?: number }): void {
    this.currentTime = this.currentTime.plus(duration);
  }

  setTime(timeOrIso: string | DateTime): void {
    if (typeof timeOrIso === 'string') {
      this.currentTime = DateTime.fromISO(timeOrIso, { zone: KOLKATA_TIMEZONE });
    } else {
      this.currentTime = timeOrIso.setZone(KOLKATA_TIMEZONE);
    }
  }
}

/**
 * Determines the target meal period based on day of week:
 * - Sunday (weekday 7): LUNCH
 * - Monday through Saturday (weekday 1-6): DINNER
 */
export function getMealPeriod(now: DateTime): MealPeriod {
  const kolkata = now.setZone(KOLKATA_TIMEZONE);
  // In Luxon, Sunday is 7
  return kolkata.weekday === 7 ? 'LUNCH' : 'DINNER';
}

/**
 * Returns the current meal date string (YYYY-MM-DD) anchored in Asia/Kolkata.
 */
export function getMealDate(now: DateTime): string {
  const kolkata = now.setZone(KOLKATA_TIMEZONE);
  return kolkata.toISODate()!;
}

/**
 * Calculates the reminder time for the meal of the given day:
 * - Mon-Sat (Dinner): 8:00 PM (20:00:00) IST
 * - Sunday (Lunch): 12:30 PM (12:30:00) IST
 */
export function getReminderTime(now: DateTime): DateTime {
  const kolkata = now.setZone(KOLKATA_TIMEZONE);
  if (kolkata.weekday === 7) {
    // Sunday: 12:30 PM
    return kolkata.set({ hour: 12, minute: 30, second: 0, millisecond: 0 });
  }
  // Mon-Sat: 8:00 PM
  return kolkata.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
}

/**
 * Calculates the deadline time for the meal of the given day:
 * - Mon-Sat (Dinner): 9:30 PM (21:30:00) IST
 * - Sunday (Lunch): 2:00 PM (14:00:00) IST
 */
export function getDeadline(now: DateTime): DateTime {
  const kolkata = now.setZone(KOLKATA_TIMEZONE);
  if (kolkata.weekday === 7) {
    // Sunday: 2:00 PM (14:00:00)
    return kolkata.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  }
  // Mon-Sat: 9:30 PM (21:30:00)
  return kolkata.set({ hour: 21, minute: 30, second: 0, millisecond: 0 });
}

/**
 * Checks whether the current time is strictly before the meal deadline.
 */
export function isBeforeDeadline(now: DateTime, deadline?: DateTime): boolean {
  const targetDeadline = deadline || getDeadline(now);
  return now.toMillis() < targetDeadline.toMillis();
}
