import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Injectable,
  type MiddlewareConsumer,
  Module,
  type NestMiddleware,
  type NestModule,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TenantDb } from '../src/common/tenancy/tenant-db.service';
import type { TenantRequest } from '../src/common/tenancy/tenant-transaction.interceptor';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import { createAdminClient, createOrganization } from './support/db';

// Stand-in for authentication (stage 0.3): takes the organization from a header.
@Injectable()
class FakeAuthMiddleware implements NestMiddleware {
  use(req: TenantRequest, _res: Response, next: NextFunction): void {
    const header = req.headers['x-test-org'];
    if (typeof header === 'string') {
      req.organizationId = header;
    }
    next();
  }
}

@Controller('probe/locations')
class ProbeController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  async list(): Promise<string[]> {
    const rows = await this.tenantDb.tx.location.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => row.name);
  }

  @Post()
  async createThenFail(@Body() body: { organizationId: string; name: string }): Promise<never> {
    await this.tenantDb.tx.location.create({ data: { ...body, timezone: 'Asia/Tashkent' } });
    throw new Error('fails after writing');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(FakeAuthMiddleware).forRoutes(ProbeController);
  }
}

describe('Tenant request transaction (integration)', () => {
  let app: INestApplication<App>;
  let admin: PrismaClient;
  let orgA: Organization;
  let orgB: Organization;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    admin = createAdminClient();
    orgA = await createOrganization(admin, 'A');
    orgB = await createOrganization(admin, 'B');
    await admin.location.createMany({
      data: [
        { organizationId: orgA.id, name: 'A one', timezone: 'Asia/Tashkent' },
        { organizationId: orgA.id, name: 'A two', timezone: 'Asia/Tashkent' },
        { organizationId: orgB.id, name: 'B one', timezone: 'Asia/Tashkent' },
      ],
    });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await app.close();
  });

  it("serves each organization's request only its own rows", async () => {
    const [a, b] = await Promise.all([
      request(app.getHttpServer()).get('/api/v1/probe/locations').set('x-test-org', orgA.id),
      request(app.getHttpServer()).get('/api/v1/probe/locations').set('x-test-org', orgB.id),
    ]);
    expect(a.body).toEqual(['A one', 'A two']);
    expect(b.body).toEqual(['B one']);
  });

  it('gives a request without an organization no tenant access at all', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/locations').expect(500);
    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: null,
    });
  });

  it('rolls the whole request back when the handler fails', async () => {
    const name = `Request ${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/v1/probe/locations')
      .set('x-test-org', orgA.id)
      .send({ organizationId: orgA.id, name })
      .expect(500);

    await expect(admin.location.count({ where: { name } })).resolves.toBe(0);
  });
});
