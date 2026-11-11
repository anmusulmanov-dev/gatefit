import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { type Env, validateEnv } from './env';

/** Typed access to validated configuration. */
export type AppConfigService = ConfigService<Env, true>;

// One .env at the repo root; resolves the same from src/config and dist/config.
const rootEnvFile = resolve(__dirname, '../../../../.env');

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: rootEnvFile,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
