import { Global, Injectable, Module } from '@nestjs/common';

/**
 * The only source of "now" for business logic (CLAUDE.md rule 3), so tests can move time.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }

  /** Whole seconds since the Unix epoch, as used by JWT and TOTP. */
  nowSeconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
