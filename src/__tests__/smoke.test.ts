import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';

describe('Scaffold & Environment Smoke Test', () => {
  it('should initialize and resolve Kolkata timezone correctly', () => {
    const kolkataTime = DateTime.now().setZone('Asia/Kolkata');
    expect(kolkataTime.isValid).toBe(true);
    expect(kolkataTime.zoneName).toBe('Asia/Kolkata');
  });
});
