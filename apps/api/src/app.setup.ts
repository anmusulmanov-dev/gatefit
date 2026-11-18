import { type INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { AppConfigService } from './config/config.module';

export const SWAGGER_PATH = 'api/docs';

/** HTTP-level setup shared by the real server and integration tests. */
export function configureApp(app: INestApplication): void {
  const config: AppConfigService = app.get(ConfigService);

  app.useLogger(app.get(Logger));

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
