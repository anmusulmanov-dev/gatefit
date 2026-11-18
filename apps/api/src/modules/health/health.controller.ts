import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators';
import { type DependencyStatus, type HealthReport, HealthService } from './health.service';

class HealthChecksDto {
  @ApiProperty({ enum: ['up', 'down'] })
  database!: DependencyStatus;

  @ApiProperty({ enum: ['up', 'down'] })
  redis!: DependencyStatus;
}

class HealthResponseDto implements HealthReport {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Public by design: used by load balancers and uptime monitors.
  @Get()
  @Public()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: 'A dependency is down; see details.checks' })
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
