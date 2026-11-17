import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

/** Port for sending SMS. Real drivers (Eskiz, Play Mobile) are added in stage M7. */
export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * Development driver: prints the message instead of sending it. It writes straight to
 * stdout, not through the application logger, so sign-in codes never reach collected
 * logs. The configuration refuses this driver in production (src/config/env.ts).
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  send(to: string, text: string): Promise<void> {
    process.stdout.write(`[sms:console] to ${to}: ${text}\n`);
    return Promise.resolve();
  }
}

// A new driver is added here and to the SMS_DRIVER enum in src/config/env.ts.
const drivers: Record<Env['SMS_DRIVER'], () => SmsProvider> = {
  console: () => new ConsoleSmsProvider(),
};

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): SmsProvider =>
        drivers[config.get('SMS_DRIVER', { infer: true })](),
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
