import { tenantSlugFromHost } from './tenant-slug';

describe('tenantSlugFromHost', () => {
  it.each([
    ['demo.gatefit.uz', 'gatefit.uz', 'demo'],
    ['Demo.GateFit.uz', 'gatefit.uz', 'demo'],
    ['demo.localhost', 'localhost', 'demo'],
    ['fit-club-2.gatefit.uz', 'gatefit.uz', 'fit-club-2'],
    // The member app may live one level deeper.
    ['demo.my.gatefit.uz', 'gatefit.uz', 'demo'],
  ])('%s on %s -> %s', (host, base, expected) => {
    expect(tenantSlugFromHost(host, base)).toBe(expected);
  });

  it.each([
    ['gatefit.uz', 'gatefit.uz'],
    ['localhost', 'localhost'],
    ['127.0.0.1', 'localhost'],
    ['demo.evil.com', 'gatefit.uz'],
    ['demogatefit.uz', 'gatefit.uz'],
    ['www.gatefit.uz', 'gatefit.uz'],
    ['admin.gatefit.uz', 'gatefit.uz'],
    ['api.gatefit.uz', 'gatefit.uz'],
    ['-bad.gatefit.uz', 'gatefit.uz'],
    ['bad_.gatefit.uz', 'gatefit.uz'],
    [`${'a'.repeat(64)}.gatefit.uz`, 'gatefit.uz'],
  ])('%s on %s is not an organization', (host, base) => {
    expect(tenantSlugFromHost(host, base)).toBeNull();
  });
});
