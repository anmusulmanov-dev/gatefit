import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import type { AppConfigService } from './config/config.module';

export const SWAGGER_PATH = 'api/docs';

/** HTTP-level setup shared by the real server and integration tests. */
export function configureApp(app: NestExpressApplication): void {
  const config: AppConfigService = app.get(ConfigService);

  app.useLogger(app.get(Logger));

  // Decides whether X-Forwarded-Host / X-Forwarded-For are believed (tenant, client IP).
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');
  app.use(cookieParser());

  // Routes resolve to /api/v1/...
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Gatefit API').setVersion('1').build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document);
}
