import request from 'supertest';
import type { Organization, PrismaClient } from '../src/generated/prisma/client';
import { createTestApp, type TestApp } from './support/app';
import { createAdminClient, createOrganization } from './support/db';

// Tests run with APP_BASE_DOMAIN=localhost.
describe('TLS ask hook (integration)', () => {
  let t: TestApp;
  let admin: PrismaClient;
  let organization: Organization;
  let blocked: Organization;

  const ask = (domain: string) =>
    request(t.app.getHttpServer()).get('/api/v1/tls/allowed').query({ domain });

  beforeAll(async () => {
    t = await createTestApp();
    admin = createAdminClient();
    organization = await createOrganization(admin, 'Tls');
    blocked = await createOrganization(admin, 'TlsBlocked');
    await admin.organization.update({ where: { id: blocked.id }, data: { status: 'blocked' } });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await t.app.close();
  });

  it.each([
    ['the bare domain', 'localhost'],
    ['the platform host', 'admin.localhost'],
  ])('allows %s', async (_label, domain) => {
    await ask(domain).expect(200, { allowed: true });
  });

  it("allows an organization's staff and member hosts, in any case", async () => {
    await ask(`${organization.slug}.localhost`).expect(200);
    await ask(`${organization.slug}-my.localhost`).expect(200);
    await ask(`${organization.slug.toUpperCase()}.LOCALHOST.`).expect(200);
  });

  it('allows a blocked organization, so its users can see that it is blocked', async () => {
    await ask(`${blocked.slug}.localhost`).expect(200);
  });

  it.each([
    'nobody-here.localhost',
    'nobody-here-my.localhost',
    'www.localhost',
    'my.localhost',
    'example.com',
  ])('refuses %s', async (domain) => {
    const response = await ask(domain).expect(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses deeper names under an existing organization', async () => {
    await ask(`x.${organization.slug}.localhost`).expect(404);
    await ask(`${organization.slug}.other.localhost`).expect(404);
    await ask(`${organization.slug}.my.localhost`).expect(404);
  });

  it('rejects a request without a domain', async () => {
    const response = await request(t.app.getHttpServer()).get('/api/v1/tls/allowed').expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
