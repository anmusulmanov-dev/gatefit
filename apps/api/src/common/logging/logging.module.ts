import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfigService } from '../../config/config.module';
import { resolveRequestId } from './request-id';
import { requestForLog, type SerializedRequest } from './request-log';

// Never log credentials or personal data (CLAUDE.md rule 9).
const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.otp',
  '*.phone',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => {
        const nodeEnv = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: nodeEnv === 'test' ? 'silent' : config.get('LOG_LEVEL', { infer: true }),
            genReqId: resolveRequestId,
            redact: { paths: redactedPaths, censor: '[redacted]' },
            // Query strings carry search terms (phones) and must not reach the logs.
            serializers: { req: (req: SerializedRequest) => requestForLog(req) },
            // JSON lines everywhere except local development.
            transport:
              nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
