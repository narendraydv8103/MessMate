import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';

describe('Passcode Hashing & Security', () => {
  const plainPasscode = 'mess1234';

  it('should hash passcode using bcrypt with salt rounds', async () => {
    const hash = await bcrypt.hash(plainPasscode, 10);

    expect(typeof hash).toBe('string');
    expect(hash).not.toBe(plainPasscode);
    expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
  });

  it('should successfully match correct passcode against hash', async () => {
    const hash = await bcrypt.hash(plainPasscode, 10);
    const matches = await bcrypt.compare(plainPasscode, hash);

    expect(matches).toBe(true);
  });

  it('should reject incorrect passcode against hash', async () => {
    const hash = await bcrypt.hash(plainPasscode, 10);
    const matches = await bcrypt.compare('wrong_passcode_99', hash);

    expect(matches).toBe(false);
  });
});
