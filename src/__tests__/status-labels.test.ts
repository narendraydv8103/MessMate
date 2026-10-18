import { describe, it, expect } from 'vitest';
import { mapStatusLabel } from '@/lib/decisions';

describe('Decision Status Label Mapping', () => {
  it('should map to "Mishra Tiffin Centre Informed" when call_job status is MESS_INFORMED', () => {
    expect(mapStatusLabel('NAHI_JAAYENGE', 'MESS_INFORMED', false)).toBe('Mishra Tiffin Centre Informed');
    expect(mapStatusLabel(null, 'MESS_INFORMED', false)).toBe('Mishra Tiffin Centre Informed');
    expect(mapStatusLabel(null, 'MESS_INFORMED', false, 'Custom Mess')).toBe('Custom Mess Informed');
  });

  it('should map to "Action Required" when call_job status is ACTION_REQUIRED', () => {
    expect(mapStatusLabel('NAHI_JAAYENGE', 'ACTION_REQUIRED', false)).toBe('Action Required');
    expect(mapStatusLabel(null, 'ACTION_REQUIRED', false)).toBe('Action Required');
  });

  it('should map to "Mishra Tiffin Centre alert scheduled" when decision is NAHI_JAAYENGE and job is PENDING', () => {
    expect(mapStatusLabel('NAHI_JAAYENGE', 'PENDING', true)).toBe('Mishra Tiffin Centre alert scheduled');
    expect(mapStatusLabel('NAHI_JAAYENGE', 'PENDING', true, 'Custom Mess')).toBe('Custom Mess alert scheduled');
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
