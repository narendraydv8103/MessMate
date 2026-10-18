import { describe, it, expect } from 'vitest';
import { mapStatusLabel } from '@/lib/decisions';

describe('Decision Status Label Mapping', () => {
  it('should map to "Aunty Informed" when call_job status is AUNTY_INFORMED', () => {
    expect(mapStatusLabel('NAHI_JAAYENGE', 'AUNTY_INFORMED', false)).toBe('Aunty Informed');
    expect(mapStatusLabel(null, 'AUNTY_INFORMED', false)).toBe('Aunty Informed');
  });

  it('should map to "Action Required" when call_job status is ACTION_REQUIRED', () => {
    expect(mapStatusLabel('NAHI_JAAYENGE', 'ACTION_REQUIRED', false)).toBe('Action Required');
    expect(mapStatusLabel(null, 'ACTION_REQUIRED', false)).toBe('Action Required');
  });

  it('should map to "Call Scheduled" when decision is NAHI_JAAYENGE and job is PENDING', () => {
    expect(mapStatusLabel('NAHI_JAAYENGE', 'PENDING', true)).toBe('Call Scheduled');
  });

  it('should map to "Decision Saved" when decision is JAAYENGE', () => {
    expect(mapStatusLabel('JAAYENGE', 'CANCELLED', true)).toBe('Decision Saved');
    expect(mapStatusLabel('JAAYENGE', null, true)).toBe('Decision Saved');
  });

  it('should map to "No Decision" when no decision has been entered', () => {
    expect(mapStatusLabel(null, null, true)).toBe('No Decision');
    expect(mapStatusLabel(null, 'PENDING', true)).toBe('No Decision');
  });
});
