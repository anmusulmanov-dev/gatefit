import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// OWASP minimum for Argon2id: 19 MiB memory, 2 iterations, 1 lane.
const ARGON2_OPTIONS = {
  // Algorithm.Argon2id; the library exports it as a const enum, unusable with isolatedModules.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  // Verified when the phone is unknown, so that answer takes as long as a wrong password.
  private readonly decoyHash = hash('decoy-password', ARGON2_OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /** False for a wrong password, a missing hash (user has no password) or a corrupt hash. */
  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    if (!passwordHash) {
      await verify(await this.decoyHash, password).catch(() => false);
      return false;
    }
    return verify(passwordHash, password).catch(() => false);
  }
}
