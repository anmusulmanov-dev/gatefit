import { Controller, Get, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { notFound } from '../../common/errors/domain-errors';
import { ZodPipe } from '../../common/validation/zod';
import { Public } from '../auth/auth.decorators';
import { TlsService } from './tls.service';

const tlsQuerySchema = z.object({ domain: z.string().min(1).max(253) });

@ApiTags('health')
@Controller('tls')
export class TlsController {
  constructor(private readonly tls: TlsService) {}

  // Public by design: Caddy's on-demand TLS "ask" hook calls it before requesting a
  // certificate. It reveals no more than the subdomain itself (an unknown one answers 404).
  @Get('allowed')
  @Public()
  @ApiQuery({ name: 'domain', required: true, example: 'demo.gatefit.uz' })
  @ApiOkResponse({ description: 'A certificate may be issued for this host' })
  @ApiNotFoundResponse({ description: 'Unknown host: no certificate' })
  async allowed(
    @Query(new ZodPipe(tlsQuerySchema)) query: z.infer<typeof tlsQuerySchema>,
  ): Promise<{ allowed: true }> {
    if (!(await this.tls.isAllowed(query.domain))) {
      throw notFound('Host');
    }
    return { allowed: true };
  }
}
