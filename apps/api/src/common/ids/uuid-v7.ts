import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562): 48-bit millisecond timestamp followed by random bits, so ids sort by
 * creation time. Prisma generates these for ORM inserts; this is for rows created in SQL.
 */
export function uuidv7(now: Date): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now.getTime(), 0, 6);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
