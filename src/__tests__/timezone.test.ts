import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  MockClock,
  getMealPeriod,
  getMealDate,
  getReminderTime,
  getDeadline,
  isBeforeDeadline,
  KOLKATA_TIMEZONE,
} from '@/lib/scheduler/timezone';

describe('Timezone & Schedule Engine (Asia/Kolkata)', () => {
  describe('Weekday Schedule (Monday - Saturday -> Dinner)', () => {
    // 2026-10-19 is a Monday
    const mondayNoon = DateTime.fromISO('2026-10-19T12:00:00', { zone: KOLKATA_TIMEZONE });
    const clock = new MockClock(mondayNoon);

    it('should correctly identify DINNER period on weekdays', () => {
      expect(getMealPeriod(clock.now())).toBe('DINNER');
      expect(getMealDate(clock.now())).toBe('2026-10-19');
    });

    it('should compute Mon-Sat reminder at 8:00 PM (20:00) IST', () => {
      const reminder = getReminderTime(clock.now());
      expect(reminder.hour).toBe(20);
      expect(reminder.minute).toBe(0);
      expect(reminder.second).toBe(0);
    });

    it('should compute Mon-Sat deadline at 9:30 PM (21:30) IST', () => {
      const deadline = getDeadline(clock.now());
      expect(deadline.hour).toBe(21);
      expect(deadline.minute).toBe(30);
      expect(deadline.second).toBe(0);
    });

    it('should return true before deadline and false at/after deadline', () => {
      // 9:29:59 PM - Before deadline
      clock.setTime('2026-10-19T21:29:59');
      expect(isBeforeDeadline(clock.now())).toBe(true);

      // 9:30:00 PM - Exact deadline
      clock.setTime('2026-10-19T21:30:00');
      expect(isBeforeDeadline(clock.now())).toBe(false);

      // 9:30:01 PM - After deadline
      clock.setTime('2026-10-19T21:30:01');
      expect(isBeforeDeadline(clock.now())).toBe(false);
    });
  });

  describe('Sunday Schedule (Sunday -> Lunch)', () => {
    // 2026-10-25 is a Sunday
    const sundayMorning = DateTime.fromISO('2026-10-25T10:00:00', { zone: KOLKATA_TIMEZONE });
    const clock = new MockClock(sundayMorning);

    it('should correctly identify LUNCH period on Sunday', () => {
      expect(getMealPeriod(clock.now())).toBe('LUNCH');
      expect(getMealDate(clock.now())).toBe('2026-10-25');
    });

    it('should compute Sunday reminder at 12:30 PM IST', () => {
      const reminder = getReminderTime(clock.now());
      expect(reminder.hour).toBe(12);
      expect(reminder.minute).toBe(30);
      expect(reminder.second).toBe(0);
    });

    it('should compute Sunday deadline at 2:00 PM (14:00) IST', () => {
      const deadline = getDeadline(clock.now());
      expect(deadline.hour).toBe(14);
      expect(deadline.minute).toBe(0);
      expect(deadline.second).toBe(0);
    });

    it('should return true before Sunday deadline and false at/after Sunday deadline', () => {
      // 1:59:59 PM - Before deadline
      clock.setTime('2026-10-25T13:59:59');
      expect(isBeforeDeadline(clock.now())).toBe(true);

      // 2:00:00 PM - Exact deadline
      clock.setTime('2026-10-25T14:00:00');
      expect(isBeforeDeadline(clock.now())).toBe(false);

      // 2:00:05 PM - After deadline
      clock.setTime('2026-10-25T14:00:05');
      expect(isBeforeDeadline(clock.now())).toBe(false);
    });
  });

  describe('MockClock time manipulation', () => {
    it('should correctly advance time using advance()', () => {
      const clock = new MockClock('2026-10-19T20:00:00');
      expect(clock.now().minute).toBe(0);

      clock.advance({ minutes: 15 });
      expect(clock.now().minute).toBe(15);

      clock.advance({ hours: 1 });
      expect(clock.now().hour).toBe(21);
      expect(clock.now().minute).toBe(15);
    });
  });
});
