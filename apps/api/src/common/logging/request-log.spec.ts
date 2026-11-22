import { requestForLog } from './request-log';

describe('requestForLog', () => {
  it('drops the query string and the parsed query', () => {
    const logged = requestForLog({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/members?q=%2B998901234567&limit=20',
      query: { q: '+998901234567' },
      params: { splat: ['v1', 'members'] },
      headers: { host: 'demo.localhost' },
    });
    expect(logged).toEqual({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/members?[redacted]',
      headers: { host: 'demo.localhost' },
      remoteAddress: undefined,
      remotePort: undefined,
    });
    expect(JSON.stringify(logged)).not.toContain('998901234567');
  });

  it('keeps a path without a query as it is', () => {
    expect(requestForLog({ method: 'POST', url: '/api/v1/access/verify' }).url).toBe(
      '/api/v1/access/verify',
    );
  });
});
