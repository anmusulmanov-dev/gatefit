import { z } from 'zod';
import { uuidv7 } from './uuid-v7';

describe('uuidv7', () => {
  it('produces a valid version 7 UUID', () => {
    const id = uuidv7(new Date('2026-11-11T10:00:00Z'));
    expect(z.uuid({ version: 'v7' }).safeParse(id).success).toBe(true);
  });

  it('encodes the timestamp in the first 48 bits', () => {
    const now = new Date('2026-11-11T10:00:00.123Z');
    const id = uuidv7(now);
    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now.getTime());
  });

  it('sorts by creation time and does not repeat', () => {
    const earlier = uuidv7(new Date('2026-01-01T00:00:00Z'));
    const later = uuidv7(new Date('2026-01-01T00:00:01Z'));
    expect(earlier < later).toBe(true);
    expect(uuidv7(new Date(0))).not.toBe(uuidv7(new Date(0)));
  });
});
