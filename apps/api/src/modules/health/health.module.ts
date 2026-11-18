import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TlsController } from './tls.controller';
import { TlsService } from './tls.service';

@Module({
  controllers: [HealthController, TlsController],
  providers: [HealthService, TlsService],
})
export class HealthModule {}
