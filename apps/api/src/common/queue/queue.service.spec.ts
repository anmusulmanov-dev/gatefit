import { connectionFromUrl } from './queue.service';

describe('connectionFromUrl', () => {
  it('reads host, port, credentials, database and TLS', () => {
    expect(connectionFromUrl('rediss://user:p%40ss@cache.internal:6380/2')).toEqual({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'p@ss',
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });
    expect(connectionFromUrl('redis://localhost')).toMatchObject({ port: 6379, db: 0 });
  });
});
