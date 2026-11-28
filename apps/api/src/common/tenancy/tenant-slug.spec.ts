import { tenantSlugFromHost } from './tenant-slug';

describe('tenantSlugFromHost', () => {
  it.each([
    ['demo.gatefit.uz', 'gatefit.uz', 'demo'],
    ['Demo.GateFit.uz', 'gatefit.uz', 'demo'],
    ['demo.localhost', 'localhost', 'demo'],
    ['fit-club-2.gatefit.uz', 'gatefit.uz', 'fit-club-2'],
    // The member app: same level, with a suffix.
    ['demo-my.gatefit.uz', 'gatefit.uz', 'demo'],
    ['fit-club-2-my.gatefit.uz', 'gatefit.uz', 'fit-club-2'],
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
    // Only one level under the base domain.
    ['demo.my.gatefit.uz', 'gatefit.uz'],
    ['x.demo.gatefit.uz', 'gatefit.uz'],
    ['-my.gatefit.uz', 'gatefit.uz'],
    ['admin-my.gatefit.uz', 'gatefit.uz'],
  ])('%s on %s is not an organization', (host, base) => {
    expect(tenantSlugFromHost(host, base)).toBeNull();
  });
});
