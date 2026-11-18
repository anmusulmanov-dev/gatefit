import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env';
import { TlsService } from './tls.service';

describe('TlsService', () => {
  const queryRaw = jest.fn<Promise<{ id: string }[]>, unknown[]>();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const config = { get: () => 'staging.gatefit.uz' } as unknown as ConfigService<Env, true>;
  const service = new TlsService(prisma, config);

  beforeEach(() => {
    queryRaw.mockReset();
  });

  it.each(['staging.gatefit.uz', 'admin.staging.gatefit.uz', 'Admin.Staging.Gatefit.uz.'])(
    'allows %s without a database lookup',
    async (domain) => {
      await expect(service.isAllowed(domain)).resolves.toBe(true);
      expect(queryRaw).not.toHaveBeenCalled();
    },
  );

  it.each(['demo.staging.gatefit.uz', 'demo.my.staging.gatefit.uz'])(
    'allows %s when the organization exists',
    async (domain) => {
      queryRaw.mockResolvedValueOnce([{ id: 'org' }]);
      await expect(service.isAllowed(domain)).resolves.toBe(true);
    },
  );

  it('refuses an unknown organization', async () => {
    queryRaw.mockResolvedValueOnce([]);
    await expect(service.isAllowed('nobody.staging.gatefit.uz')).resolves.toBe(false);
  });

  it.each([
    'gatefit.uz',
    'demo.gatefit.uz',
    'example.com',
    'www.staging.gatefit.uz',
    'my.staging.gatefit.uz',
    'x.demo.staging.gatefit.uz',
    'demo.other.staging.gatefit.uz',
  ])('refuses %s without a database lookup', async (domain) => {
    await expect(service.isAllowed(domain)).resolves.toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
